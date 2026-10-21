import hashlib,json,pathlib,sys,zipfile
apk=pathlib.Path(sys.argv[1]); assets=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(apk) as archive:
    manifest=json.loads(archive.read('assets/runtime/files.json'))
    assert manifest==json.loads((assets/'runtime/files.json').read_text()), 'APK_ASSET_MANIFEST_MISMATCH'
    for name,expected in manifest['files'].items():
        assert hashlib.sha256(archive.read('assets/runtime/'+name)).hexdigest()==expected, 'APK_ASSET_DIGEST_MISMATCH: '+name
    names=archive.namelist()
    assert not any(name.endswith(('.pem','.p12','apk.env')) for name in names), 'PRIVATE_SIGNING_MATERIAL_MUST_NOT_BE_PACKAGED'
    assert any(name.startswith('assets/runtime/share/doc/nodejs-lts/') for name in names), 'NODE_LICENSE_MISSING'
    assert 'assets/runtime/share/doc/android-runtime-build/NDK-NOTICE.toolchain' in names, 'STATIC_RUNTIME_NOTICES_MISSING'
    assert b'BUNDLED_RUNTIME_COPY_MISMATCH' in archive.read('classes.dex'), 'ATOMIC_RUNTIME_COPY_CODE_MISSING'
    assert b'PERSISTED_PROBE_ROW_LOST_OR_CHANGED' in archive.read('assets/runtime/runtime-probe.mjs'), 'PROCESS_PERSISTENCE_ASSERTION_MISSING'
print(json.dumps({'apk_sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'bundle_id':manifest['bundle_id'],'verified_assets':len(manifest['files']),'private_signing_material':False,'artifact_validation':'PASS'}))
