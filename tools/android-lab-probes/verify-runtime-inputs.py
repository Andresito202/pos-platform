"""Verify signed upstream metadata before extracting any binary. Not a package installer."""
import hashlib,json,pathlib,re,subprocess,sys
root=pathlib.Path(sys.argv[1]).resolve()
command=['gpgv','--output','-']
for key in sorted((root/'keys').glob('*.gpg')): command+=['--keyring',str(key)]
command+=[str(root/'InRelease')]
verified=subprocess.check_output(command)
(root/'verified-release').write_bytes(verified)
release=verified.decode()
match=re.search(r'^ ([a-f0-9]{64})\s+(\d+) main/binary-aarch64/Packages$',release,re.M)
assert match, 'SIGNED_PACKAGES_CHECKSUM_MISSING'
packages=(root/'Packages').read_bytes()
assert len(packages)==int(match[2]) and hashlib.sha256(packages).hexdigest()==match[1], 'SIGNED_PACKAGES_INDEX_MISMATCH'
rows={}
for raw in packages.decode().split('\n\n'):
    values=dict(line.split(': ',1) for line in raw.splitlines() if ': ' in line and not line.startswith(' '))
    if 'Package' in values: rows[values['Package']]=values
for item in json.loads((root/'packages.json').read_text()):
    signed=rows[item['Package']]
    assert signed==item and signed['Architecture'] in ('aarch64','all'), 'PACKAGE_METADATA_MISMATCH'
    data=(root/'debs'/(item['Package']+'.deb')).read_bytes()
    assert hashlib.sha256(data).hexdigest()==signed['SHA256'], 'PACKAGE_DIGEST_MISMATCH'
print('SIGNED_RUNTIME_INPUTS_VERIFIED; no package maintainer scripts executed')
