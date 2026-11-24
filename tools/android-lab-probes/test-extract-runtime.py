"""Exercise archive boundaries without downloading or executing runtime binaries."""
import io,json,pathlib,subprocess,sys,tarfile,tempfile,unittest
SCRIPT=pathlib.Path(__file__).with_name('extract-runtime.py')
PREFIX='data/data/com.termux/files/usr/'
class Extraction(unittest.TestCase):
    def extract(self,members,repeat=False):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary); (root/'debs').mkdir()
            (root/'packages.json').write_text(json.dumps([{'Package':'fixture'}]))
            data=io.BytesIO()
            with tarfile.open(fileobj=data,mode='w:gz') as archive:
                for name,value,link in [('bin/node',b'fixture-never-executed',None)]+members:
                    entry=tarfile.TarInfo(PREFIX+name)
                    if link is None:
                        entry.size=len(value);archive.addfile(entry,io.BytesIO(value))
                    else:
                        entry.type=tarfile.SYMTYPE;entry.linkname=link;archive.addfile(entry)
            blob=data.getvalue()
            header=(f'{"data.tar.gz/":<16}{0:<12}{0:<6}{0:<6}{100644:<8}{len(blob):<10}`\n').encode()
            (root/'debs/fixture.deb').write_bytes(b'!<arch>\n'+header+blob+(b'\n' if len(blob)%2 else b''))
            result=subprocess.run([sys.executable,str(SCRIPT),str(root),str(root/'out')],capture_output=True,text=True)
            if repeat and result.returncode==0:
                result=subprocess.run([sys.executable,str(SCRIPT),str(root),str(root/'out')],capture_output=True,text=True)
                self.assertEqual((root/'out/lib/libalias.so').read_bytes(),b'content')
            return result
    def test_materialized_alias_and_repeat(self):
        self.assertEqual(self.extract([('lib/libreal.so',b'content',None),('lib/libalias.so',b'', 'libreal.so')],True).returncode,0)
    def test_escape_link(self):
        self.assertIn('ARCHIVE_LINK_REJECTED',self.extract([('lib/alias.so',b'','../../outside')]).stderr)
    def test_escape_file(self):
        self.assertIn('ARCHIVE_PATH_REJECTED',self.extract([('share/doc/../../../../outside',b'bad',None)]).stderr)
    def test_link_cycle(self):
        self.assertIn('ARCHIVE_LINK_CYCLE',self.extract([('lib/a.so',b'','b.so'),('lib/b.so',b'','a.so')]).stderr)
if __name__=='__main__': unittest.main()
