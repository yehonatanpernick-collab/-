"""שלב 2+3: בוחר לכל מין את התמונות החדות והיפות ביותר מתוך המועמדות, מוריד אותן באיכות גבוהה ובונה:
   img/<code>.jpg    פס של 3–5 מסגרות 4:3 (הראשונה = הטובה ביותר)
   img/t/<code>.jpg  תמונה קטנה לרשימה
   data/photos.js    קרדיטים

בחירה: חדות (שונות לפלסיאן), צבעוניות, מיקום במיון של iNaturalist (תמונות נבחרות/מועדפות קודם),
הסרת כפילויות דומות (dhash), וסינון תמונות כהות/בהירות מדי או מטושטשות.
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAND = os.path.join(ROOT, 'cand')
EXTRA_DIR = os.path.join(ROOT, 'extra-img')
IMG = os.path.join(ROOT, 'img')
os.makedirs(os.path.join(IMG, 't'), exist_ok=True)
W, H = 720, 540
TW, TH = 360, 270


def feats(path):
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    im.thumbnail((500, 500))
    a = np.asarray(im, dtype=np.float32)
    g = a.mean(axis=2)
    lap = g[1:-1, 1:-1] * 4 - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    sharp = float(lap.var())
    lum = float(g.mean())
    sat = float((a.max(axis=2) - a.min(axis=2)).mean())
    # פריחה: פיקסלים צבעוניים שאינם ירוקים (עלי כותרת) או לבנים, באזור המרכזי של התמונה
    hsv = np.asarray(im.convert('HSV'), dtype=np.float32)
    h_, s_, v_ = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    hh, ww = h_.shape
    cy, cx = slice(int(hh * .2), int(hh * .8)), slice(int(ww * .2), int(ww * .8))
    colored = (s_ > 80) & (v_ > 70) & ~((h_ > 40) & (h_ < 125))
    white = (v_ > 215) & (s_ < 40)
    bloom = float(colored[cy, cx].mean() + 0.5 * white[cy, cx].mean())
    # dhash
    s = np.asarray(ImageOps.grayscale(im).resize((9, 8)), dtype=np.int16)
    dh = (s[:, 1:] > s[:, :-1]).flatten()
    return sharp, lum, sat, dh, bloom


def choose(code):
    d = os.path.join(CAND, code)
    mp = os.path.join(d, 'meta.json')
    if not os.path.exists(mp):
        return []
    meta = json.load(open(mp))
    rows = []
    for i, m in enumerate(meta):
        p = os.path.join(d, f'{i:02d}.jpg')
        if not os.path.exists(p):
            continue
        try:
            sharp, lum, sat, dh, bloom = feats(p)
        except Exception:
            continue
        if sharp < 40 or lum < 35 or lum > 225:
            continue
        rows.append(dict(m=m, sharp=sharp, sat=sat, dh=dh, pos=i, bloom=bloom))
    if not rows:
        return []
    sh = np.array([np.log1p(r['sharp']) for r in rows]); sa = np.array([r['sat'] for r in rows])
    z = lambda v: (v - v.mean()) / (v.std() + 1e-6) if len(v) > 1 else np.zeros_like(v)
    bl = np.array([r['bloom'] for r in rows])
    for k, r in enumerate(rows):
        prior = 1 - r['pos'] / max(len(meta), 1)
        r['score'] = 0.3 * prior + 0.3 * z(sh)[k] + 0.15 * z(sa)[k] + 0.35 * z(bl)[k] - (1.5 if r['bloom'] < 0.03 else 0)
    rows.sort(key=lambda r: -r['score'])
    picked = []
    for r in rows:
        if all(int((r['dh'] != q['dh']).sum()) > 9 for q in picked):
            picked.append(r)
    for r in picked:
        r['want'] = 3 if len(picked) < 4 else 4 if len(picked) < 7 else 5
    return picked[:7]


def dl(url, dest):
    r = subprocess.run(['curl', '-sS', '-L', '-m', '60', '-o', dest, '-w', '%{http_code}', url], capture_output=True, text=True)
    return r.stdout.strip() == '200' and os.path.exists(dest) and os.path.getsize(dest) > 8000


def fit(im, w, h):
    return ImageOps.fit(ImageOps.exif_transpose(im).convert('RGB'), (w, h), Image.LANCZOS, centering=(0.5, 0.5))


def build_one(args):
    code, sel = args
    frames, credits = [], []
    tmp = os.path.join(CAND, code, 'sel')
    os.makedirs(tmp, exist_ok=True)
    for k, r in enumerate(sel):
        dest = os.path.join(tmp, f'{k}.jpg')
        ok = dl(r['m']['large'], dest) or dl(r['m']['medium'], dest)
        if not ok:
            continue
        try:
            frames.append(fit(Image.open(dest), W, H))
            credits.append(dict(credit=r['m']['credit'], license=r['m']['license'], source='iNaturalist', page=r['m']['page']))
        except Exception:
            pass
    return code, frames, credits


def main():
    extra = json.load(open(os.path.join(ROOT, 'data', 'extra-photos.json')))
    codes = sorted(d for d in os.listdir(CAND) if os.path.isdir(os.path.join(CAND, d)))
    # בחירה + סינון תמונות שמופיעות אצל יותר ממין אחד (אותו מין ב-iNaturalist תחת שמות נרדפים): התמונה נשארת רק אצל המין הראשון
    import re as _re
    latin = {m.group(1).lower(): m.group(2) for m in _re.finditer(r'"c":"([^"]+)","he":"[^"]*","la":"([^"]*)"', open(os.path.join(ROOT, 'data', 'species.js'), encoding='utf-8').read())}
    codes = sorted(codes, key=lambda c: ('aff.' in latin.get(c, ''), c))  # מינים "aff." אחרונים: אם חולקים תמונות עם מין מוגדר – הן נשארות אצל המוגדר
    used, selections, dropped = {}, [], {}
    for c in codes:
        sel = choose(c)
        want = sel[0]['want'] if sel else 3
        keep = []
        for r in sel:
            pid = r['m']['id']
            if pid in used and used[pid] != c:
                dropped[c] = dropped.get(c, 0) + 1
                continue
            used[pid] = c
            keep.append(r)
        selections.append((c, keep[:want]))
    print('species with cross-species duplicate photos removed:', {k: v for k, v in dropped.items()})
    species = {c.lower(): c for c in json.load(open(os.path.join(ROOT, 'data', 'photos.json'))).keys()}
    out = {}
    with ThreadPoolExecutor(4) as ex:
        results = list(ex.map(build_one, selections))
    # שמות הקודים המקוריים (רישיות) לפי species.js
    names = {}
    import re
    txt = open(os.path.join(ROOT, 'data', 'species.js'), encoding='utf-8').read()
    for m in re.finditer(r'"c":"([^"]+)"', txt):
        names[m.group(1).lower()] = m.group(1)
    for f in os.listdir(IMG):
        p = os.path.join(IMG, f)
        if os.path.isfile(p):
            os.remove(p)
    for f in os.listdir(os.path.join(IMG, 't')):
        os.remove(os.path.join(IMG, 't', f))
    for lc, frames, credits in results:
        code = names.get(lc, lc)
        # תמונות נוספות ממקור שאינו CC (רק למינים שאין להם תמונות חופשיות) – עם קרדיט לצלם
        if lc in extra and len(frames) < 3:
            for k, it in enumerate(extra[lc], 1):
                p = os.path.join(EXTRA_DIR, f'{lc}-{k}.jpg')
                if os.path.exists(p):
                    frames.append(fit(Image.open(p), W, H))
                    credits.append(dict(credit=it['credit'], license='credited', source='צמחיית ישראל וסביבתה', page=f'https://flora.org.il/plants/{code}/'))
        if not frames:
            continue
        strip = Image.new('RGB', (W * len(frames), H))
        for i, fr in enumerate(frames):
            strip.paste(fr, (i * W, 0))
        strip.save(os.path.join(IMG, f'{lc}.jpg'), 'JPEG', quality=78, optimize=True, progressive=True)
        frames[0].resize((TW, TH), Image.LANCZOS).save(os.path.join(IMG, 't', f'{lc}.jpg'), 'JPEG', quality=76, optimize=True)
        out[code] = credits
    open(os.path.join(ROOT, 'data', 'photos.js'), 'w', encoding='utf-8').write(
        '// נוצר אוטומטית ע"י tools/photos-build.py\nexport const PHOTOS = ' + json.dumps(out, ensure_ascii=False) + ';\n')
    from collections import Counter
    print(len(out), 'species;', dict(Counter(len(v) for v in out.values())))
    total = sum(os.path.getsize(os.path.join(IMG, f)) for f in os.listdir(IMG) if os.path.isfile(os.path.join(IMG, f)))
    print('strips', total // 1024, 'KB')


if __name__ == '__main__':
    main()
