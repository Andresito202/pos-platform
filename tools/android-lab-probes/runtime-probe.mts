import { LocalDatabase } from "../../packages/database-sqlite/src/index.js";
import { join } from "node:path";
import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { createHash,randomUUID } from "node:crypto";

// Real commercial persistence implementation in a dedicated probe sandbox, never the POS DB.
const directory=process.env.CAMACHO_RUNTIME_PROBE_DIRECTORY;
if(!directory||!directory.endsWith("/commercial-engine-probe"))throw new Error("ISOLATED_PROBE_DIRECTORY_REQUIRED");
mkdirSync(directory,{recursive:true});
const marker=join(directory,"previous-success.json");
let previous:{passed?:boolean;persistedValue?:string}|null=null;
try{previous=JSON.parse(readFileSync(marker,"utf8"));}catch{/* first isolated launch */}
const at=performance.now();
let database=LocalDatabase.open({dataDirectory:directory});
let secondWriterRejected=false;
try { LocalDatabase.open({dataDirectory:directory}); } catch(error) { if(error instanceof Error&&error.message.includes("SQLite writer already active"))secondWriterRejected=true;else throw error; }
if(!secondWriterRejected)throw new Error("SECOND_WRITER_WAS_NOT_REJECTED");
const migrationRows=database.native.prepare("SELECT version,checksum FROM local_schema_migrations ORDER BY version").all();
const journal=database.native.pragma("journal_mode",{simple:true});
const integrity=database.native.pragma("integrity_check",{simple:true});
database.native.exec("CREATE TABLE IF NOT EXISTS android_runtime_probe(id INTEGER PRIMARY KEY,value TEXT NOT NULL) STRICT");
const existing=database.native.prepare("SELECT value FROM android_runtime_probe WHERE id=1").get() as {value:string}|undefined;
if(previous?.passed===true&&(!existing||(previous.persistedValue!==undefined&&existing.value!==previous.persistedValue)))throw new Error("PERSISTED_PROBE_ROW_LOST_OR_CHANGED");
const persistedValue=existing?.value??randomUUID();
database.native.transaction(()=>database.native.prepare("INSERT OR IGNORE INTO android_runtime_probe(id,value) VALUES (1,?)").run(persistedValue)).immediate();
try{database.native.transaction(()=>{database.native.prepare("INSERT INTO android_runtime_probe(id,value) VALUES (2,'must-rollback')").run();throw new Error("EXPECTED_ROLLBACK");}).immediate();}catch(error){if(!(error instanceof Error)||error.message!=="EXPECTED_ROLLBACK")throw error;}
if(database.native.prepare("SELECT id FROM android_runtime_probe WHERE id=2").get())throw new Error("ROLLBACK_FAILED");
const probeRow=database.native.prepare("SELECT value FROM android_runtime_probe WHERE id=1").get() as {value:string};
database.close();
database=LocalDatabase.open({dataDirectory:directory});
if((database.native.prepare("SELECT value FROM android_runtime_probe WHERE id=1").get() as {value:string}).value!==probeRow.value)throw new Error("REOPEN_FAILED");
const foreignKeys=database.native.pragma("foreign_keys",{simple:true});
database.close();
const result={purpose:"ISOLATED_COMMERCIAL_DATABASE_ENGINE_PROBE",passed:true,platform:process.platform,arch:process.arch,node:process.version,napi:process.versions.napi,
  sqliteJournal:journal,integrity,foreignKeys,migrations:migrationRows,secondWriterRejected,writeReadRollbackReopen:true,previousSuccessfulProcess:previous?.passed===true,persistedValue,
  migrationFingerprint:createHash("sha256").update(JSON.stringify(migrationRows)).digest("hex"),elapsedMs:Math.round(performance.now()-at),memory:process.memoryUsage(),businessSession:false,commercialSale:false,hardwareCommand:false};
writeFileSync(marker,JSON.stringify(result));
console.log(JSON.stringify(result));
