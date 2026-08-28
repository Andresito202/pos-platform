import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);

function extension(path) {
  const match = /(?:^|\/)[^/]+(\.[^.\/]+)$/.exec(path);
  return match?.[1] ?? "";
}

function normalizePath(path) {
  return normalize(path).split(sep).join("/");
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function walkSourceFiles(root) {
  if (!(await pathExists(root))) return [];
  const output = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".nx" || entry.name === "dist") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(extension(entry.name))) output.push(path);
    }
  };
  await visit(root);
  return output.sort();
}

function importsFrom(source, file) {
  const imports = new Set();
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      imports.add(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamicImport) imports.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...imports];
}

function projectForPath(absolutePath, projects) {
  return projects.find((project) => {
    const path = normalizePath(absolutePath);
    const root = `${normalizePath(project.absoluteRoot)}/`;
    return path === normalizePath(project.absoluteRoot) || path.startsWith(root);
  });
}

function internalProjectForSpecifier(specifier, projects) {
  return projects.find((project) => specifier === project.name || specifier.startsWith(`${project.name}/`));
}

function declaredDependencies(packageJson) {
  const declarations = new Map();
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, specifier] of Object.entries(packageJson[section] ?? {})) {
      const existing = declarations.get(name) ?? [];
      existing.push({ section, specifier });
      declarations.set(name, existing);
    }
  }
  return declarations;
}

function expectedTags(project) {
  const tags = [`layer:${project.layer}`, `type:${project.type}`, `scope:${project.scope}`];
  if (project.dialect) tags.push(`dialect:${project.dialect}`);
  return tags.sort();
}

function describeImport(source, target, specifier) {
  return `${source.name} -> ${target.name} via ${specifier}`;
}

export async function validateWorkspace(workspaceRoot, policyOverride) {
  const root = resolve(workspaceRoot);
  const policy = policyOverride ?? await readJson(join(root, "tools/architecture/module-boundaries.json"));
  const errors = [];
  if (policy.$schemaVersion !== 1) errors.push("module-boundaries schema version must be 1");

  const projectEntries = Object.entries(policy.projects ?? {});
  const projects = projectEntries.map(([name, definition]) => ({
    name,
    ...definition,
    absoluteRoot: resolve(root, definition.root),
  }));
  const names = new Set(projects.map((project) => project.name));
  const roots = new Set(projects.map((project) => normalizePath(project.absoluteRoot)));
  if (names.size !== projects.length) errors.push("project names must be unique");
  if (roots.size !== projects.length) errors.push("project roots must be unique");

  for (const forbidden of policy.forbiddenProjectNames ?? []) {
    if (names.has(forbidden)) errors.push(`forbidden sub-capability project declared: ${forbidden}`);
  }

  for (const project of projects) {
    if (!project.root || isAbsolute(project.root) || normalizePath(project.root).startsWith("../")) {
      errors.push(`${project.name} has an invalid project root`);
      continue;
    }
    if (!(await pathExists(project.absoluteRoot))) {
      errors.push(`${project.name} root is missing: ${project.root}`);
      continue;
    }
    const packagePath = join(project.absoluteRoot, "package.json");
    const projectPath = join(project.absoluteRoot, "project.json");
    if (!(await pathExists(packagePath))) errors.push(`${project.name} package.json is missing`);
    if (!(await pathExists(projectPath))) errors.push(`${project.name} project.json is missing`);
    if (!(await pathExists(packagePath)) || !(await pathExists(projectPath))) continue;

    const packageJson = await readJson(packagePath);
    const projectJson = await readJson(projectPath);
    if (packageJson.name !== project.name) errors.push(`${project.root}/package.json name must be ${project.name}`);
    if (packageJson.private !== true) errors.push(`${project.name} must remain private during the architecture skeleton phase`);
    if (projectJson.name !== project.name) errors.push(`${project.root}/project.json name must be ${project.name}`);
    if (projectJson.root !== project.root) errors.push(`${project.name} Nx root must be ${project.root}`);
    if (projectJson.projectType !== "library") errors.push(`${project.name} must be an Nx library`);
    const actualTags = [...(projectJson.tags ?? [])].sort();
    const requiredTags = expectedTags(project);
    if (JSON.stringify(actualTags) !== JSON.stringify(requiredTags)) {
      errors.push(`${project.name} tags must be exactly ${requiredTags.join(", ")}`);
    }

    const allowedLayers = new Set(policy.allowedLayerDependencies?.[project.layer] ?? []);
    const dependencies = declaredDependencies(packageJson);
    const files = await walkSourceFiles(project.absoluteRoot);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const specifier of importsFrom(source, file)) {
        let target = internalProjectForSpecifier(specifier, projects);
        if (specifier.startsWith(".")) {
          const resolvedImport = resolve(dirname(file), specifier);
          target = projectForPath(resolvedImport, projects);
          if (!target && normalizePath(resolvedImport).includes(`${normalizePath(root)}/packages/`)) {
            errors.push(`${project.name} has an unresolved cross-package relative import ${specifier}`);
            continue;
          }
        } else if (specifier.startsWith("@pos-platform/") && !target) {
          errors.push(`${project.name} imports undeclared workspace project ${specifier}`);
          continue;
        }

        if (target && target.name !== project.name) {
          if (!allowedLayers.has(target.layer)) {
            errors.push(`forbidden layer dependency: ${describeImport(project, target, specifier)}`);
          }
          if (!dependencies.has(target.name)) {
            errors.push(`${describeImport(project, target, specifier)} is not declared in package.json`);
          } else {
            for (const declaration of dependencies.get(target.name)) {
              if (!String(declaration.specifier).startsWith("workspace:")) {
                errors.push(`${describeImport(project, target, specifier)} must use the workspace: protocol in ${declaration.section}`);
              }
            }
          }
          continue;
        }

        if (!target && !specifier.startsWith(".") && !specifier.startsWith("node:")) {
          const forbidden = policy.forbiddenExternalImportsByLayer?.[project.layer] ?? [];
          if (forbidden.some((prefix) => specifier === prefix || specifier.startsWith(prefix))) {
            errors.push(`${project.name} layer ${project.layer} cannot import ${specifier}`);
          }
        }
      }
    }
  }

  const workspacePackages = [];
  for (const parent of ["packages", "apps"]) {
    const directory = join(root, parent);
    if (!(await pathExists(directory))) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packagePath = join(directory, entry.name, "package.json");
      if (!(await pathExists(packagePath))) continue;
      const packageJson = await readJson(packagePath);
      workspacePackages.push({ name: packageJson.name, root: normalizePath(relative(root, join(directory, entry.name))) });
    }
  }
  for (const workspaceProject of workspacePackages) {
    const declared = projects.find((project) => project.name === workspaceProject.name && project.root === workspaceProject.root);
    if (!declared) errors.push(`workspace project is not governed by module-boundaries.json: ${workspaceProject.name ?? workspaceProject.root}`);
  }

  return errors.sort();
}

async function main() {
  const workspaceRoot = process.argv[2] ?? process.cwd();
  const errors = await validateWorkspace(workspaceRoot);
  if (errors.length > 0) {
    console.error(["ARCH-003 boundary validation failed:", ...errors.map((error) => `- ${error}`)].join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("ARCH-003 boundary validation PASS");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) await main();
