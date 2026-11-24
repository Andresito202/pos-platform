import importlib.util,json,pathlib,struct,tempfile,unittest
spec=importlib.util.spec_from_file_location('installed',pathlib.Path(__file__).with_name('prepare-installed-runtime.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
project=pathlib.Path(__file__).resolve().parent

class InstalledRuntimeTests(unittest.TestCase):
    def test_reject_4k_wrong_arch_and_truncated_binary(self):
        original=(project/'build/runtime-root/bin/node').read_bytes()
        binary=module.Elf(original)
        modified=bytearray(original);offset=struct.unpack_from('<Q',modified,32)[0]
        index=next(i for i,h in enumerate(binary.headers) if h[0]==1)
        struct.pack_into('<Q',modified,offset+index*56+48,4096)
        with self.assertRaisesRegex(AssertionError,'16K'):module.Elf(modified)
        modified=bytearray(original);struct.pack_into('<H',modified,18,62)
        with self.assertRaisesRegex(AssertionError,'ARM64'):module.Elf(modified)
        with self.assertRaises(AssertionError):module.Elf(original[:10])

    def test_prepare_immutable_closure_from_verified_assets(self):
        with tempfile.TemporaryDirectory(prefix='camacho-installed-runtime-') as directory:
            output=pathlib.Path(directory)/'candidate'
            result=module.prepare(project/'build/runtime-root',project/'build/runtime-assets',output)
            self.assertFalse(result['production'])
            manifest=json.loads((output/'assets/runtime/files.json').read_text())
            self.assertNotIn('bin/node',manifest['files'])
            self.assertFalse(any(name.endswith('.node') or name.startswith('lib/') for name in manifest['files']))
            self.assertIn('libcamacho_node.so',manifest['installed_native'])
            self.assertIn('libcamacho_sqlite.so',manifest['installed_native'])
            for name,digest in manifest['installed_native'].items():
                data=(output/'lib/arm64-v8a'/name).read_bytes()
                self.assertEqual(module.sha(data),digest)
                self.assertTrue(all(dep in module.SYSTEM or dep in manifest['installed_native'] for dep in module.Elf(data).needed()))
            # Never overwrite an existing candidate, even with correct inputs.
            with self.assertRaisesRegex(AssertionError,'NEW_OUTPUT'):module.prepare(project/'build/runtime-root',project/'build/runtime-assets',output)

if __name__=='__main__':unittest.main()
