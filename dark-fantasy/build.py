#!/usr/bin/env python3
"""Concatenate src/ into a single self-contained index.html."""
import pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
parts = [(src / 'head.html').read_text()]
for f in sorted(src.glob('*.js')):
    parts.append(f'\n// ---- {f.name} ----\n' + f.read_text())
parts.append('\n</script>\n</body>\n</html>\n')
(root / 'index.html').write_text(''.join(parts))
print('built index.html', sum(len(p) for p in parts) // 1024, 'KB')
