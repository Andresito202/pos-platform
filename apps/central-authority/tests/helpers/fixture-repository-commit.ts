import { execFileSync } from "node:child_process";
/** Source archives lack .git; callers must supply the real inspected commit. */
export function fixtureRepositoryCommit(cwd: string): string {
  const commit = process.env.FIXTURE_REPOSITORY_COMMIT ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", windowsHide: true }).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw Error("FIXTURE_REPOSITORY_COMMIT_INVALID");
  return commit;
}
