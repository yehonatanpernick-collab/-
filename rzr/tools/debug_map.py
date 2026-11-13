#!/usr/bin/env python3
"""Render a labelled debug map of the baked world (roads, rivers, lakes, nodes, contours)."""
import json, os, sys, gzip
import numpy as np
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__)); W = os.path.join(HERE, '..', 'assets', 'world')
out = sys.argv[1] if len(sys.argv) > 1 else 'debug_map.png'
w = json.load(open(os.path.join(W, 'world.json')))
N = 2049; S = 2048; half = 4096
raw = np.frombuffer(gzip.open(os.path.join(W, 'height.bin.gz')).read(), np.uint16).reshape(N, N)
H = np.cumsum(raw.astype(np.uint32), axis=1).astype(np.uint16).astype(np.float32) * 0.1
im = Image.open(os.path.join(W, 'overview.jpg')).resize((S, S)).convert('RGB')
d = ImageDraw.Draw(im)
P = lambda x, z: ((x + half) / 8192 * S, (z + half) / 8192 * S)
# contours every 100 m
Hs = H[::2, ::2][:1024, :1024]
lv = np.floor(Hs / 100)
edge = (lv != np.roll(lv, 1, 0)) | (lv != np.roll(lv, 1, 1))
arr = np.array(im); e = np.kron(edge, np.ones((2, 2), bool))[:S, :S]
arr[e] = (arr[e] * 0.55).astype(np.uint8); im = Image.fromarray(arr); d = ImageDraw.Draw(im)
cols = {'valley': (255, 240, 120), 'trail': (255, 160, 60), 'mountain': (255, 90, 200), 'forest': (170, 110, 60), 'extreme': (255, 40, 40)}
for r in w['rivers']:
    d.line([P(p[0], p[2]) for p in r['pts']], fill=(40, 120, 255), width=3)
    for f in r['falls']:
        x, y = P(f['top'][0], f['top'][2]); d.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 255, 255), width=2); d.text((x + 8, y), f"fall {f['drop']:.0f}m", fill=(255, 255, 255))
for L in w['lakes']:
    d.polygon([P(*p) for p in L['shape']], outline=(0, 255, 255)); x, y = P(L['x'], L['z']); d.text((x, y), f"{L['name']} {L['level']:.0f}", fill=(255, 255, 255))
for r in w['roads']:
    d.line([P(p[0], p[2]) for p in r['pts']], fill=cols[r['cls']], width=3)
for b in w['bridges']:
    d.line([P(b['a'][0], b['a'][2]), P(b['b'][0], b['b'][2])], fill=(255, 255, 255), width=7)
for k, (x, z) in w['nodes'].items():
    px, py = P(x, z); d.rectangle([px - 4, py - 4, px + 4, py + 4], fill=(0, 0, 0)); d.text((px + 6, py - 6), k, fill=(0, 0, 0))
for p in w['peaks']:
    px, py = P(p['x'], p['z']); d.text((px, py), f"^{p['name']} {p['h']:.0f}", fill=(80, 0, 120))
for b in w['buildings']:
    px, py = P(b['x'], b['z']); d.rectangle([px - 2, py - 2, px + 2, py + 2], fill=(255, 0, 255))
d.line([P(*w['drift']['pts'][i]) for i in range(len(w['drift']['pts']))] + [P(*w['drift']['pts'][0])], fill=(255, 255, 255), width=2)
for gx in range(-4000, 4001, 1000):
    d.text(P(gx, -4080), str(gx), fill=(0, 0, 0)); d.text(P(-4090, gx), str(gx), fill=(0, 0, 0))
im.save(out)
