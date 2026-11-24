import hashlib,importlib.util,json,pathlib,sys,zipfile
apk=pathlib.Path(sys.argv[1]); assets=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(apk) as archive:
    manifest=json.loads(archive.read('assets/runtime/files.json'))
    assert manifest==json.loads((assets/'runtime/files.json').read_text()), 'APK_ASSET_MANIFEST_MISMATCH'
    for name,expected in manifest['files'].items():
        assert hashlib.sha256(archive.read('assets/runtime/'+name)).hexdigest()==expected, 'APK_ASSET_DIGEST_MISMATCH: '+name
    names=archive.namelist()
    assert not any(name.endswith(('.pem','.p12','apk.env')) for name in names), 'PRIVATE_SIGNING_MATERIAL_MUST_NOT_BE_PACKAGED'
    if 'installed_native' in manifest:
        spec=importlib.util.spec_from_file_location('installed',pathlib.Path(__file__).with_name('prepare-installed-runtime.py'))
        installed=importlib.util.module_from_spec(spec);spec.loader.exec_module(installed)
        for name,digest in manifest['installed_native'].items():
            data=archive.read('lib/arm64-v8a/'+name)
            assert hashlib.sha256(data).hexdigest()==digest,'INSTALLED_NATIVE_DIGEST_MISMATCH'
            assert all(dep in installed.SYSTEM or dep in manifest['installed_native'] for dep in installed.Elf(data).needed()),'INSTALLED_NATIVE_DEPENDENCY_REJECTED'
        assert not any(name.startswith(('assets/runtime/bin/','assets/runtime/lib/')) or name.endswith('.node') for name in names),'WRITABLE_NATIVE_ASSETS_FORBIDDEN'
        assert b'INSTALLED_NATIVE_DIGEST_MISMATCH' in archive.read('classes.dex'),'INSTALLED_NATIVE_LOADER_MISSING'
    assert any(name.startswith('assets/runtime/share/doc/nodejs-lts/') for name in names), 'NODE_LICENSE_MISSING'
    assert 'assets/runtime/share/doc/android-runtime-build/NDK-NOTICE.toolchain' in names, 'STATIC_RUNTIME_NOTICES_MISSING'
    assert b'BUNDLED_RUNTIME_COPY_MISMATCH' in archive.read('classes.dex'), 'ATOMIC_RUNTIME_COPY_CODE_MISSING'
    assert b'PERSISTED_PROBE_ROW_LOST_OR_CHANGED' in archive.read('assets/runtime/runtime-probe.mjs'), 'PROCESS_PERSISTENCE_ASSERTION_MISSING'
    assert b'BLOCKED_PENDING_TRUSTED_PROVISIONING' in archive.read('assets/runtime/runtime-service.mjs'), 'UNPROVISIONED_SERVICE_BOUNDARY_MISSING'
    assert b'INHERITED_NATIVE_PARENT_PIPE_REQUIRED' in archive.read('assets/runtime/runtime-service.mjs'), 'NATIVE_CUSTODY_PIPE_GUARD_MISSING'
    assert b'ANDROID_CUSTODY_INCOMPLETE_NO_AUTOMATIC_REPLACEMENT' in archive.read('classes.dex'), 'KEYSTORE_NO_REPLACEMENT_GUARD_MISSING'
print(json.dumps({'apk_sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'bundle_id':manifest['bundle_id'],'verified_assets':len(manifest['files']),'private_signing_material':False,'artifact_validation':'PASS'}))
