import io,json,os,pathlib,subprocess,sys,tarfile
root=pathlib.Path(sys.argv[1]).resolve(); out=pathlib.Path(sys.argv[2]).resolve()
out.mkdir(parents=True,exist_ok=True)
prefix='data/data/com.termux/files/usr/'
aliases={}
for package in json.loads((root/'packages.json').read_text()):
    deb=root/'debs'/(package['Package']+'.deb')
    members=subprocess.check_output(['ar','t',str(deb)],text=True).splitlines()
    data=next(item for item in members if item.startswith('data.tar'))
    archive=subprocess.check_output(['ar','p',str(deb),data])
    with tarfile.open(fileobj=io.BytesIO(archive),mode='r:*') as tar:
        for member in tar.getmembers():
            name=member.name.removeprefix('./')
            if not name.startswith(prefix): continue
            relative=name[len(prefix):]
            wanted=(relative=='bin/node' or relative.startswith('include/node/') or
                (relative.startswith('lib/') and '.so' in pathlib.PurePosixPath(relative).name) or
                relative.startswith('share/doc/') or relative.startswith('share/licenses/') or relative.startswith('share/LICENSES/'))
            if not wanted or member.isdir(): continue
            target=pathlib.Path(os.path.abspath(out/relative))
            assert target.is_relative_to(out) and target.parent.resolve().is_relative_to(out), 'ARCHIVE_PATH_REJECTED'
            target.parent.mkdir(parents=True,exist_ok=True)
            if member.isfile():
                if target.is_symlink(): target.unlink()
                with tar.extractfile(member) as stream: target.write_bytes(stream.read())
            elif member.issym():
                link=pathlib.Path(os.path.abspath(target.parent/member.linkname))
                assert link.is_relative_to(out), 'ARCHIVE_LINK_REJECTED'
                aliases[target]=link
            else: raise RuntimeError('ARCHIVE_MEMBER_REJECTED')
(out/'bin/node').chmod(0o755)
def alias_bytes(path,visited):
    assert path not in visited, 'ARCHIVE_LINK_CYCLE'
    return alias_bytes(aliases[path],visited|{path}) if path in aliases else path.read_bytes()
for path,link in aliases.items():
    data=alias_bytes(link,{path})
    if path.is_symlink(): path.unlink()
    path.write_bytes(data)
print('RUNTIME_EXTRACTED_WITHOUT_INSTALLATION_OR_PACKAGE_SCRIPTS')
