"""Cross compile the existing better-sqlite3 13.0.3 source for Android/Bionic, N-API 10."""
import ast,json,pathlib,subprocess,sys
project=pathlib.Path(sys.argv[1]).resolve(); ndk=pathlib.Path(sys.argv[2]).resolve()
assert '27.3.13750724' in (ndk/'source.properties').read_text(), 'NDK_REVISION_MISMATCH'
inputs=project/'build/runtime-inputs'; target=project/'build/runtime-root'
assert all((inputs/name).is_file() for name in ['runtime-probe.mjs','runtime-service.mjs']), 'BUNDLE_RUNTIME_INPUTS_BEFORE_COMPILATION'
compiler=ndk/'toolchains/llvm/prebuilt/linux-x86_64/bin'
cc=compiler/'aarch64-linux-android28-clang'; cxx=compiler/'aarch64-linux-android28-clang++'
assert cc.is_file() and cxx.is_file(), 'VERIFIED_ANDROID_NDK_R27D_REQUIRED'
source=inputs/'better-sqlite3'
assert json.loads((source/'package.json').read_text())['version']=='13.0.3', 'SQLITE_VERSION_MISMATCH'
defines=ast.literal_eval((source/'deps/defines.gypi').read_text())['defines']
obj=project/'build/android-sqlite3.o'
subprocess.run([str(cc),'-O2','-fPIC','-fvisibility=hidden','-D_GNU_SOURCE']+['-D'+define for define in defines]+['-c',str(source/'deps/sqlite3/sqlite3.c'),'-o',str(obj)],check=True)
module=target/'node_modules/better-sqlite3'
module.mkdir(parents=True,exist_ok=True)
import shutil
shutil.copytree(source/'lib',module/'lib',dirs_exist_ok=True)
shutil.copyfile(source/'package.json',module/'package.json')
shutil.copyfile(source/'LICENSE',module/'LICENSE')
destination=module/'build/Release/better_sqlite3.node'; destination.parent.mkdir(parents=True,exist_ok=True)
subprocess.run([str(cxx),'-O2','-fPIC','-shared','-std=c++20','-fvisibility=hidden','-fvisibility-inlines-hidden','-static-libstdc++',
    '-DNAPI_VERSION=10','-DNAPI_DISABLE_CPP_EXCEPTIONS','-DNODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS',
    '-I'+str(target/'include/node'),'-I'+str(inputs/'node-addon-api'),'-I'+str(source/'deps/sqlite3'),
    str(source/'src/better_sqlite3.cpp'),str(obj),'-Wl,-Bsymbolic','-Wl,--exclude-libs,ALL',
    '-Wl,-z,max-page-size=16384','-Wl,-z,common-page-size=16384','-ldl','-lm','-o',str(destination)],check=True)
shutil.copyfile(inputs/'runtime-probe.mjs',target/'runtime-probe.mjs')
shutil.copyfile(inputs/'runtime-service.mjs',target/'runtime-service.mjs')
notices=target/'share/doc/android-runtime-build'; notices.mkdir(parents=True,exist_ok=True)
for name in ['NOTICE','NOTICE.toolchain']:
    shutil.copyfile(ndk/name,notices/('NDK-'+name))
shutil.copyfile(inputs/'node-addon-api/LICENSE.md',notices/'node-addon-api-LICENSE.md')
print('ANDROID_BETTER_SQLITE3_COMPILED',destination)
