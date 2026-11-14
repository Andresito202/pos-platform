import { spawnSync } from "node:child_process";

/**
 * Resolve pnpm in a way that works on Windows (where .cmd files require a
 * command shell) and on POSIX systems (where direct process execution is safer).
 */
export function pnpmInvocation(args, platform = process.platform) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new TypeError("pnpm arguments must be an array of strings");
  }

  return {
    command: platform === "win32" ? "pnpm.cmd" : "pnpm",
    args: [...args],
    shell: platform === "win32",
  };
}

export function spawnPnpm(args, options = {}, platform = process.platform) {
  const invocation = pnpmInvocation(args, platform);
  return spawnSync(invocation.command, invocation.args, {
    ...options,
    shell: invocation.shell,
  });
}
