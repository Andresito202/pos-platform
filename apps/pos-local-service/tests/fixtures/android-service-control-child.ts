// Laboratory harness on a desktop OS, not an Android identity or emulator.
import { AndroidServiceFoundation } from "../../src/android/android-service-foundation.js";
import { AndroidPrivateServiceControl } from "../../src/android/android-private-service-control.js";
const service=new AndroidServiceFoundation(process.argv[2]!);
await service.start();
const control=new AndroidPrivateServiceControl(()=>service.licenseInformation(),
  value=>process.stdout.write(JSON.stringify(value)+"\n"),code=>{
    process.stdin.pause();void service.stop().then(()=>{process.exitCode=code;});
  });
process.stdin.on("data",chunk=>control.accept(Buffer.from(chunk)));
process.stdin.on("end",()=>control.end());
