# מחבר לכל מין את התמונות (raw-img/<code>-N.jpg) לפס אחד img/<code>.jpg (מסגרות 4:3 זו לצד זו) ויוצר data/photos.js.
import json, os, glob
from PIL import Image, ImageOps

W, H = 640, 480
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
photos = json.load(open(os.path.join(root, 'data', 'photos.json'), encoding='utf-8'))
os.makedirs(os.path.join(root, 'img'), exist_ok=True)
for f in glob.glob(os.path.join(root, 'img', '*.jpg')):
    os.remove(f)
out, total = {}, 0
for code, meta in photos.items():
    frames, kept = [], []
    for i, m in enumerate(meta, 1):
        p = os.path.join(root, 'raw-img', f'{code.lower()}-{i}.jpg')
        if not os.path.exists(p):
            continue
        try:
            im = ImageOps.exif_transpose(Image.open(p)).convert('RGB')
            frames.append(ImageOps.fit(im, (W, H), Image.LANCZOS, centering=(0.5, 0.45)))
            kept.append(m)
        except Exception as e:
            print('bad image', code, i, e)
    if not frames:
        continue
    strip = Image.new('RGB', (W * len(frames), H))
    for i, fr in enumerate(frames):
        strip.paste(fr, (i * W, 0))
    dest = os.path.join(root, 'img', f'{code.lower()}.jpg')
    strip.save(dest, 'JPEG', quality=76, optimize=True, progressive=True)
    total += os.path.getsize(dest)
    out[code] = kept
open(os.path.join(root, 'data', 'photos.js'), 'w', encoding='utf-8').write(
    '// נוצר אוטומטית ע"י tools/build-strips.py\nexport const PHOTOS = ' + json.dumps(out, ensure_ascii=False) + ';\n')
from collections import Counter
print(len(out), 'species with photos;', total // 1024, 'KB;', dict(Counter(len(v) for v in out.values())))
