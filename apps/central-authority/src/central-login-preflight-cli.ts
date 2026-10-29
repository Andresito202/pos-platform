import {inspectCentralLoginPreflight} from "./central-login-preflight.js";
process.stdout.write(JSON.stringify(inspectCentralLoginPreflight(process.env),null,2)+"\n");
