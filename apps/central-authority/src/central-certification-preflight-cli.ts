import {inspectCentralCertification} from "./central-certification-preflight.js";
process.stdout.write(JSON.stringify(inspectCentralCertification(process.env),null,2)+"\n");
