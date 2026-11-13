#!/usr/bin/env python3
"""Pack the raw Poly Haven textures into the files the game loads.

 - terrain_{albedo,normal,arm}.jpg : 8 layers stacked vertically (1024 x 8192),
   uploaded as WebGL2 texture arrays.
 - road / structure / bark textures : resized copies.
 - twig + grass atlases : diffuse and alpha merged into RGBA WebP with colour
   dilation, so mip-mapping does not produce dark fringes around needles/blades.
 - foliage models : diffuse+alpha merged into RGBA PNG and a patched .gltf, which
   prep_models.mjs then decimates and packs.
Usage: python3 rzr/tools/prep_textures.py
"""
import json, os, shutil
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, '..', 'assets', '_raw')
OUT = os.path.join(HERE, '..', 'assets', 'textures')
os.makedirs(OUT, exist_ok=True)

TERRAIN_LAYERS = [
    ('grass', 'rocky_terrain_02'),
    ('tundra', 'aerial_grass_rock'),
    ('forest', 'forest_leaves_04'),
    ('rock', 'marble_cliff_05'),
    ('scree', 'rocks_ground_02'),
    ('mud', 'brown_mud_rocks_01'),
    ('snow', 'snow_02'),
    ('riverbed', 'river_small_rocks'),
]


def load(path, size=None, mode='RGB'):
    im = Image.open(path).convert(mode)
    if size and im.size != size:
        im = im.resize(size, Image.LANCZOS)
    return im


def push_pull(rgb, a):
    """Fill RGB under transparent pixels with the nearest opaque colours."""
    levels = []
    c = rgb * a[..., None]
    w = a.copy()
    while min(w.shape) > 1:
        levels.append((c, w))
        h2, w2 = c.shape[0] // 2, c.shape[1] // 2
        c = c[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2, 3).sum((1, 3))
        w = w[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2).sum((1, 3))
    fill = c / np.maximum(w, 1e-6)[..., None]
    for c, w in reversed(levels):
        up = np.repeat(np.repeat(fill, 2, 0), 2, 1)
        up = np.pad(up, ((0, c.shape[0] - up.shape[0]), (0, c.shape[1] - up.shape[1]), (0, 0)), mode='edge')
        own = c / np.maximum(w, 1e-6)[..., None]
        k = np.clip(w * 4, 0, 1)[..., None]
        fill = own * k + up * (1 - k)
    return fill


def rgba(diff_path, alpha_path, size=None, crop=None):
    d = Image.open(diff_path).convert('RGB')
    a = Image.open(alpha_path).convert('L')
    if crop:
        W, H = d.size
        box = (int(crop[0] * W), int(crop[1] * H), int(crop[2] * W), int(crop[3] * H))
        d, a = d.crop(box), a.crop(box)
    if size:
        d, a = d.resize(size, Image.LANCZOS), a.resize(size, Image.LANCZOS)
    rgb = np.asarray(d, np.float32) / 255
    al = np.asarray(a, np.float32) / 255
    fill = push_pull(rgb, (al > 0.5).astype(np.float32))
    out = np.where((al > 0.5)[..., None], rgb, fill)
    arr = np.concatenate([np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8), (al * 255 + 0.5).astype(np.uint8)[..., None]], -1)
    return Image.fromarray(arr, 'RGBA')


def main():
    t = os.path.join(RAW, 'textures')
    # --- terrain arrays
    S = 1024
    meta = {'layers': [], 'size': S}
    for kind, q in (('albedo', 92), ('normal', 92), ('arm', 88)):
        sheet = Image.new('RGB', (S, S * len(TERRAIN_LAYERS)))
        for i, (lname, src) in enumerate(TERRAIN_LAYERS):
            suffix = {'albedo': 'diff', 'normal': 'nor_gl', 'arm': 'arm'}[kind]
            im = load(os.path.join(t, f'{src}_{suffix}.jpg'), (S, S))
            sheet.paste(im, (0, i * S))
            if kind == 'albedo':
                avg = np.asarray(im.resize((1, 1), Image.BOX), np.float32).reshape(3) / 255
                meta['layers'].append({'name': lname, 'source': src, 'avg': [round(float(x), 4) for x in avg]})
        sheet.save(os.path.join(OUT, f'terrain_{kind}.jpg'), quality=q)
        print('terrain', kind)
    json.dump(meta, open(os.path.join(OUT, 'terrain_layers.json'), 'w'), indent=1)

    # --- road + structure materials
    copies = {
        'road_gravel': ('rocky_trail', 2048, 2048, 1024),
        'road_mud': ('muddy_tracks', 1024, 1024, 512),
        'wood_logs': ('wood_trunk_wall', 1024, 1024, 512),
        'roof_slate': ('roof_slates_02', 1024, 1024, 512),
        'stone_wall': ('rustic_stone_wall', 1024, 1024, 512),
        'planks': ('weathered_planks', 1024, 1024, 512),
    }
    for dst, (src, sd, sn, sa) in copies.items():
        load(os.path.join(t, f'{src}_diff.jpg'), (sd, sd)).save(os.path.join(OUT, f'{dst}_diff.jpg'), quality=88)
        load(os.path.join(t, f'{src}_nor_gl.jpg'), (sn, sn)).save(os.path.join(OUT, f'{dst}_nor.jpg'), quality=90)
        load(os.path.join(t, f'{src}_arm.jpg'), (sa, sa)).save(os.path.join(OUT, f'{dst}_arm.jpg'), quality=86)
        print('material', dst)

    # --- trees (scanned bark + twig atlases)
    tr = os.path.join(RAW, 'trees')
    for tree in ('fir_tree_01', 'pine_tree_01'):
        short = tree.split('_')[0]
        for m, s in (('bark_diff', 1024), ('bark_nor_gl', 1024), ('bark_arm', 512)):
            load(os.path.join(tr, f'{tree}_{m}.jpg'), (s, s)).save(os.path.join(OUT, f'{short}_{m.replace("_gl", "")}.jpg'), quality=88)
        rgba(os.path.join(tr, f'{tree}_twig_diff.jpg'), os.path.join(tr, f'{tree}_twig_alpha.png'), (1024, 1024)).save(
            os.path.join(OUT, f'{short}_twig.webp'), quality=88, method=6)
        load(os.path.join(tr, f'{tree}_twig_nor_gl.jpg'), (1024, 1024)).save(os.path.join(OUT, f'{short}_twig_nor.jpg'), quality=88)
        print('tree', short)
    # grass clumps live in the bottom quarter of the atlas
    rgba(os.path.join(tr, 'grass_medium_01_diffuse.jpg'), os.path.join(tr, 'grass_medium_01_alpha.png'),
         (1024, 256), crop=(0, 0.75, 1, 1)).save(os.path.join(OUT, 'grass_clumps.webp'), quality=88, method=6)
    print('grass atlas')

    # --- foliage models: merge alpha and patch a copy of the glTF
    md = os.path.join(RAW, 'models')
    for name in sorted(os.listdir(md)):
        ap = os.path.join(md, name, 'textures', f'{name}_alpha_1k.png')
        if not os.path.exists(ap):
            continue
        dp = os.path.join(md, name, 'textures', f'{name}_diff_1k.jpg')
        rgba(dp, ap).save(os.path.join(md, name, 'textures', f'{name}_diffa_1k.png'))
        g = json.load(open(os.path.join(md, name, f'{name}.gltf')))
        for im in g['images']:
            if im['uri'].endswith(f'{name}_diff_1k.jpg'):
                im['uri'] = f'textures/{name}_diffa_1k.png'
                im['mimeType'] = 'image/png'
        json.dump(g, open(os.path.join(md, name, f'{name}.alpha.gltf'), 'w'))
        print('foliage alpha', name)


if __name__ == '__main__':
    main()
