import { mat003PreflightExitCode, runMat003Preflight } from "./postgres-003-preflight.js";

const result = await runMat003Preflight(process.env.POSTGRES_PREFLIGHT_URL);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = mat003PreflightExitCode(result);
