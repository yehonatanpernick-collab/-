#!/usr/bin/env python3
"""Download the curated CC0 asset set from Poly Haven into rzr/assets/_raw.

Every asset here is CC0 (public domain) per https://polyhaven.com/license.
The raw downloads are git-ignored; tools/prep_assets.mjs turns them into the
compact files the game actually loads (rzr/assets/textures, rzr/assets/models).

Usage:  python3 rzr/tools/fetch_assets.py
"""
import json, os, subprocess, sys, urllib.parse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', '_raw')
API = 'https://api.polyhaven.com/files/'

# Terrain / surface materials (1k: they are packed into 1024 texture arrays)
TEXTURES = {
    'rocky_terrain_02': '1k',     # alpine meadow grass
    'aerial_grass_rock': '1k',    # high tundra grass + gravel
    'forest_leaves_04': '1k',     # conifer forest floor (pine_forest collection)
    'marble_cliff_05': '1k',      # grey fractured limestone: cliffs / bedrock
    'rocks_ground_02': '1k',      # scree / talus
    'brown_mud_rocks_01': '1k',   # wet soil / mud
    'snow_02': '1k',              # snow
    'river_small_rocks': '1k',    # river / lake bed, shore gravel
    'rocky_trail': '2k',          # gravel road surface
    'muddy_tracks': '1k',         # muddy forest track
    'wood_trunk_wall': '1k',      # log cabin walls
    'roof_slates_02': '1k',       # alpine slate roofs
    'rustic_stone_wall': '1k',    # stone foundations / stone bridge
    'weathered_planks': '1k',     # bridge decks, sheds
}
MAPS = {'diff': 'Diffuse', 'nor_gl': 'nor_gl', 'arm': 'arm'}

# Scanned tree materials: geometry is generated in-game, materials are real scans
TREE_TEX = {
    'fir_tree_01': ['bark_diff', 'bark_nor_gl', 'bark_arm', 'twig_diff', 'twig_alpha', 'twig_nor_gl', 'twig_arm'],
    'pine_tree_01': ['bark_diff', 'bark_nor_gl', 'bark_arm', 'twig_diff', 'twig_alpha', 'twig_nor_gl', 'twig_arm'],
    'grass_medium_01': ['Diffuse', 'Alpha'],
}

# Scanned models (1k glTF), decimated later
MODELS = ['rock_moss_set_01', 'rock_moss_set_02', 'boulder_01', 'rock_09', 'rock_07', 'stone_01',
          'mountainside', 'rock_face_01', 'dead_tree_trunk', 'dead_tree_trunk_02', 'tree_stump_01',
          'tree_stump_02', 'fern_02', 'shrub_03', 'shrub_04', 'pine_roots', 'dry_branches_medium_01',
          'celandine_01', 'dandelion_01', 'rock_face_02', 'coastal_cliff_01', 'namaqualand_cliff_02']


def curl(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    subprocess.run(['curl', '-sSfL', '--retry', '3', '-o', dest, url], check=True)


def files(asset):
    out = subprocess.run(['curl', '-sSf', API + asset], check=True, capture_output=True).stdout
    return json.loads(out)


def main():
    for name, res in TEXTURES.items():
        f = files(name)
        for short, key in MAPS.items():
            if key not in f:
                key = {'nor_gl': 'nor_gl', 'arm': 'arm'}.get(short, key)
            e = f[key][res]['jpg']
            curl(e['url'], os.path.join(ROOT, 'textures', f'{name}_{short}.jpg'))
        print('texture', name)
    for name, keys in TREE_TEX.items():
        f = files(name)
        for k in keys:
            fmt = 'png' if 'alpha' in k.lower() else 'jpg'
            e = f[k]['2k'][fmt]
            curl(e['url'], os.path.join(ROOT, 'trees', f'{name}_{k.lower()}.{fmt}'))
        print('tree textures', name)
    for name in MODELS:
        f = files(name)
        g = f['gltf']['1k']['gltf']
        d = os.path.join(ROOT, 'models', name)
        curl(g['url'], os.path.join(d, name + '.gltf'))
        for rel, e in g['include'].items():
            curl(e['url'], os.path.join(d, rel))
        # Poly Haven's glTF ships JPG albedo; cut-out foliage needs the separate alpha map
        if 'Alpha' in f:
            curl(f['Alpha']['1k']['png']['url'], os.path.join(d, 'textures', f'{name}_alpha_1k.png'))
        print('model', name)


if __name__ == '__main__':
    sys.exit(main())
