import assert from "node:assert/strict";
import { createServer } from "node:net";
import { RawTcpTransport,discoverSystemPrinters } from "../../apps/pos-local-service/src/hardware/adapters.ts";
import { formatReceiptAmount,encodePrinterText } from "../../apps/pos-local-service/src/hardware/receipt-printer.ts";

// Node 22 --experimental-strip-types, no native Node module or physical printer.
const start=performance.now(),cpu=process.cpuUsage();
assert.equal(formatReceiptAmount("99999999999999.000001"),"99.999.999.999.999,000001");
const bytes=encodePrinterText("Café, piñón, ¿sí?\n",{protocol:"ESC_POS",code_page:16});
assert.ok(bytes.includes(241));
let count=0;
const server=createServer(socket=>socket.on("data",chunk=>{count+=chunk.length;}));
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const transport=new RawTcpTransport("loopback-lab","127.0.0.1",server.address().port,2000);
for(let i=0;i<10;i++)assert.equal((await transport.send(bytes)).state,"TRANSPORT_ACCEPTED");
await new Promise(resolve=>setTimeout(resolve,30));
assert.equal(count,bytes.length*10);
await new Promise(resolve=>server.close(resolve));
let discovery;
try{discovery={queues:await discoverSystemPrinters()};}catch(error){discovery={unavailable:error.message};}
console.log(JSON.stringify({level:"LINUX_NODE_LOOPBACK_ONLY",platform:process.platform,arch:process.arch,
  operations:10,elapsedMs:Math.round(performance.now()-start),rssBytes:process.memoryUsage().rss,cpu:process.cpuUsage(cpu),discovery,
  physicalPrinter:"NOT_TESTED",android:"NOT_TESTED",businessRuntime:"NOT_TESTED"}));
