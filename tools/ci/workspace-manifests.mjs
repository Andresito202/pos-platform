import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const WORKSPACE_ROOTS = Object.freeze(["apps", "packages", "tools"]);

export function discoverWorkspaceManifestPaths(root) {
  const manifests = ["package.json"];

  for (const parent of WORKSPACE_ROOTS) {
    const absoluteParent = path.join(root, parent);
    if (!existsSync(absoluteParent)) continue;

    for (const entry of readdirSync(absoluteParent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relativePath = `${parent}/${entry.name}/package.json`;
      if (existsSync(path.join(root, relativePath))) manifests.push(relativePath);
    }
  }

  return [...new Set(manifests)].sort();
}

export function readWorkspaceManifest(root, relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

export function workspaceIdentity(relativePath, manifest) {
  if (relativePath === "package.json") return "root";
  if (typeof manifest.name === "string" && manifest.name.trim()) return manifest.name.trim();
  return relativePath.replace(/\/package\.json$/, "");
}
