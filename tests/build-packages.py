"""Reproducible allow-list packaging. Run from any directory; no profile data."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib, json, sys
root = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root.parent
out.mkdir(parents=True, exist_ok=True)
runtime = [root / f for f in ['manifest.json', 'background.js', 'content.js', 'page-reader.js']]
for folder, suffixes in [('lib', {'.js'}), ('icons', {'.png'}), ('overlay', {'.js', '.css'}),
                         ('popup', {'.js', '.css', '.html'}), ('ui', {'.js', '.css', '.html'}),
                         ('offscreen', {'.js', '.html'})]:
    runtime += [f for f in (root / folder).iterdir() if f.is_file() and f.suffix in suffixes]
install = runtime + [root / 'README.md', root / 'CHANGELOG.md', root / 'SECURITY.md']
source = install + [root / 'TESTING.md', root / 'package.json', root / '.gitignore']
source += [f for f in (root / 'tests').iterdir() if f.is_file() and f.suffix in {'.js', '.cjs', '.py', '.html'}]
source += [root / 'docs' / f for f in ['node-test-results.txt', 'browser-test-results.txt', 'display-test-results.txt', 'small-binding-test-results.txt', 'self-lookup-test-results.txt', 'request-cache-test-results.txt', '交付报告.md', '安全审核报告-2026-10-16.md']]
manifest = json.loads((root / 'manifest.json').read_text())
assert manifest['version'] == '1.0.1'
checksums = []
for name, files in [('TeamsGroupSentry-1.0.1-install.zip', install), ('TeamsGroupSentry-1.0.1-source.zip', source)]:
    target = out / name
    with ZipFile(target, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
        for f in sorted(set(files)):
            # Never package a symlink that can resolve to secrets outside the repo.
            relative = f.relative_to(root)
            if not f.is_file() or f.is_symlink() or not f.resolve().is_relative_to(root.resolve()):
                raise ValueError(f'Unsafe package input: {relative}')
            assert not any(part in {'node_modules', 'sources', '.git', 'profiles', 'IndexedDB'} for part in relative.parts)
            info = ZipInfo('TeamsGroupSentry/' + relative.as_posix(), (2026, 10, 16, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, f.read_bytes(), compresslevel=9)
    with ZipFile(target) as archive:
        assert archive.testzip() is None
        assert 'TeamsGroupSentry/manifest.json' in archive.namelist()
        if 'install' in name:
            assert all('/tests/' not in p and '/docs/' not in p for p in archive.namelist())
    checksums.append(hashlib.sha256(target.read_bytes()).hexdigest() + '  ' + name)
    print(f'{name}: {len(set(files))} files, {target.stat().st_size} bytes, verified')
(out / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')
