"""Derive APK-installed ARM64 binaries from the existing verified runtime.
No download, signer, provisioning, target-SDK change or production activation.
Dynamic strings are shortened in place; executable instructions are unchanged.
"""
import hashlib,json,pathlib,re,shutil,struct,sys

SYSTEM={'libc.so','libm.so','libdl.so','liblog.so','libandroid.so'}
def sha(data): return hashlib.sha256(data).hexdigest()

class Elf:
    def __init__(self,data):
        self.data=bytearray(data)
        assert data[:6]==b'\x7fELF\x02\x01' and len(data)>=64,'ARM64_ELF64_LE_REQUIRED'
        assert struct.unpack_from('<HH',data,16)==(3,183),'ARM64_ET_DYN_REQUIRED'
        offset=struct.unpack_from('<Q',data,32)[0]
        size,count=struct.unpack_from('<HH',data,54)
        assert size==56 and 0<count<256 and offset+count*size<=len(data),'ELF_HEADERS_REJECTED'
        self.headers=[struct.unpack_from('<IIQQQQQQ',data,offset+i*size) for i in range(count)]
        loads=[h for h in self.headers if h[0]==1]
        assert loads and all(h[7]>=16384 and h[2]%16384==h[3]%16384 and h[1]&3!=3 for h in loads),'ELF_16K_OR_WX_REJECTED'
        dynamic=next(h for h in self.headers if h[0]==2)
        assert dynamic[2]+dynamic[5]<=len(data) and dynamic[5]%16==0,'ELF_DYNAMIC_REJECTED'
        self.tags=[]
        for at in range(dynamic[2],dynamic[2]+dynamic[5],16):
            tag,value=struct.unpack_from('<qQ',data,at)
            if tag==0: break
            self.tags.append((tag,value))
        va=next(v for t,v in self.tags if t==5)
        table=next(h for h in loads if h[3]<=va<h[3]+h[5])
        self.strings=table[2]+va-table[3]
        self.string_size=next(v for t,v in self.tags if t==10)
        assert self.strings+self.string_size<=len(data),'ELF_STRING_TABLE_REJECTED'
    def text(self,index):
        assert index<self.string_size,'ELF_STRING_INDEX_REJECTED'
        start=self.strings+index;end=self.data.index(0,start,self.strings+self.string_size)
        return bytes(self.data[start:end]).decode('ascii')
    def needed(self): return [self.text(v) for t,v in self.tags if t==1]
    def rewrite(self,names):
        for tag,index in self.tags:
            if tag not in (1,14,15,29): continue
            old=self.text(index);new='$ORIGIN' if tag in (15,29) else names.get(old,old)
            assert len(new)<=len(old),'ELF_STRING_GROWTH_REJECTED'
            start=self.strings+index
            self.data[start:start+len(old)]=new.encode()+b'\0'*(len(old)-len(new))
        return bytes(self.data)

def prepare(root,assets,destination):
    root=root.resolve();assets=assets.resolve();destination=destination.absolute()
    assert root.is_dir() and assets.is_dir() and not destination.exists(),'NEW_OUTPUT_DIRECTORY_REQUIRED'
    manifest=json.loads((assets/'runtime/files.json').read_text())
    for name,digest in manifest['files'].items():
        path=(assets/'runtime'/name).resolve()
        assert path.is_relative_to(assets/'runtime') and path.is_file() and sha(path.read_bytes())==digest,'VERIFIED_ASSET_DIGEST_REQUIRED'
    sources={'libcamacho_node.so':root/'bin/node','libcamacho_sqlite.so':root/'node_modules/better-sqlite3/build/Release/better_sqlite3.node'}
    parsed={};names={};queue=list(sources)
    while queue:
        name=queue.pop();binary=sources[name]
        relative=str(binary.relative_to(root)).replace('\\','/')
        assert sha(binary.read_bytes())==manifest['files'].get(relative),'VERIFIED_NATIVE_SOURCE_REQUIRED'
        elf=Elf(binary.read_bytes());parsed[name]=elf
        for dep in elf.needed():
            if dep in SYSTEM: continue
            assert re.fullmatch(r'lib[A-Za-z0-9_+.-]+\.so(?:\.[0-9]+)*',dep),'ELF_DEPENDENCY_NAME_REJECTED'
            source=root/'lib'/dep;target=re.sub(r'\.so(?:\.[0-9]+)+$','.so',dep)
            assert source.is_file(),'ELF_DEPENDENCY_MISSING: '+dep
            names[dep]=target
            if target in sources: assert sources[target].read_bytes()==source.read_bytes(),'ELF_ALIAS_CONFLICT'
            else: sources[target]=source;queue.append(target)
    # Validate the entire closure before creating an output or copying assets.
    derived={name:elf.rewrite(names) for name,elf in parsed.items()}
    assert all(dep in SYSTEM or dep in derived for data in derived.values() for dep in Elf(data).needed()),'ELF_CLOSURE_REJECTED'
    out=destination/'assets/runtime';out.mkdir(parents=True)
    for name in manifest['files']:
        if name.startswith(('bin/','lib/')) or name.endswith('.node'):continue
        source=assets/'runtime'/name;target=out/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
    # Package-local binding adapter. No changes to canonical SQLite/domain code.
    (out/'node_modules/better-sqlite3/lib/binding.js').write_text("""'use strict';
const fs=require('node:fs'),path=require('node:path');let binding;
exports.getBinding=function(input){
 if(input!=null||process.platform!=='android')throw Error('INSTALLED_ANDROID_BINDING_REQUIRED');
 const directory=fs.realpathSync(process.env.CAMACHO_ANDROID_NATIVE_LIBRARY_DIRECTORY);
 if(!directory.startsWith('/data/app/')||path.dirname(fs.realpathSync(process.execPath))!==directory)throw Error('INSTALLED_NATIVE_BINDING_SCOPE_REJECTED');
 if(!binding){const module={exports:{}};process.dlopen(module,path.join(directory,'libcamacho_sqlite.so'));binding=module.exports;}
 return binding;
};
""")
    lib=destination/'lib/arm64-v8a';lib.mkdir(parents=True)
    native={}
    for name,data in derived.items():
        (lib/name).write_bytes(data);native[name]=sha(data)
    files={str(p.relative_to(out)).replace('\\','/'):sha(p.read_bytes()) for p in sorted(out.rglob('*')) if p.is_file()}
    new={'bundle_id':sha(json.dumps({'files':files,'installed_native':native},sort_keys=True).encode()),'files':files,'installed_native':native}
    (out/'files.json').write_text(json.dumps(new,indent=2))
    report={'profile':'ANDROID_INSTALLED_NATIVE_CANDIDATE_V1','production':False,'source_bundle':manifest['bundle_id'],
      'native':{name:{'source_sha256':sha(sources[name].read_bytes()),'installed_sha256':native[name],'needed':Elf(data).needed()} for name,data in derived.items()},
      'pending':['release identity and signer','target API and foreground service contract','AAB/Play review','Android 9 and modern 16K physical/runtime tests','trusted commercial provisioning']}
    (destination/'preparation.json').write_text(json.dumps(report,indent=2));return report

if __name__=='__main__':
    result=prepare(*(pathlib.Path(p) for p in sys.argv[1:4]));print(json.dumps({'prepared':True,'native_files':len(result['native']),'production':False}))
