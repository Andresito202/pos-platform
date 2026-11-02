import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { writeManifestPair } from './windows-scm-manifest-pair.mjs';

function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),'camacho-manifest-pair-unit-'));
 try{fn(join(dir,'desktop.json'),join(dir,'service.json'));}
 finally{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep)&&dir.includes('camacho-manifest-pair-unit-'));rmSync(dir,{recursive:true,force:true});}
}
test('manifest publisher writes both previously validated public outputs with exclusive creation',()=>fixture((desktop,service)=>{
 writeManifestPair(desktop,service,{role:'DESKTOP'},{role:'SERVICE'});
 assert.equal(JSON.parse(readFileSync(desktop,'utf8')).role,'DESKTOP');
 assert.equal(JSON.parse(readFileSync(service,'utf8')).role,'SERVICE');
}));
test('second-output failure preserves partial evidence and a concurrent SERVICE manifest',()=>fixture((desktop,service)=>{
 const existing='CONCURRENT_PUBLIC_SERVICE_FIXTURE';writeFileSync(service,existing,{flag:'wx'});
 assert.throws(()=>writeManifestPair(desktop,service,{role:'DESKTOP'},{role:'SERVICE'}),/PARTIAL_OUTPUT_PRESERVED_REQUIRES_REVIEW/);
 assert.equal(JSON.parse(readFileSync(desktop,'utf8')).role,'DESKTOP');
 assert.equal(readFileSync(service,'utf8'),existing);
}));
test('an existing DESKTOP output is preserved without creating or replacing SERVICE',()=>fixture((desktop,service)=>{
 writeFileSync(desktop,'EXISTING_PUBLIC_DESKTOP');writeFileSync(service,'EXISTING_PUBLIC_SERVICE');
 assert.throws(()=>writeManifestPair(desktop,service,{role:'DESKTOP'},{role:'SERVICE'}),/OUTPUT_EXISTS_OR_WRITE_FAILED/);
 assert.equal(readFileSync(desktop,'utf8'),'EXISTING_PUBLIC_DESKTOP');
 assert.equal(readFileSync(service,'utf8'),'EXISTING_PUBLIC_SERVICE');
}));
