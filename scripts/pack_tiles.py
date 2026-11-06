"""Pack the 500 m tile files into 2 km region bundles (4x4 tiles) to cut the number of HTTP requests/files."""
import json, os, shutil
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
src = os.path.join(ROOT, "public/data/tiles"); dst = os.path.join(ROOT, "public/data/packs")
if not os.path.isdir(src):
    src = os.path.join(ROOT, "data/tiles_unpacked")
os.makedirs(dst, exist_ok=True)
packs = {}
for f in os.listdir(src):
    i, j = map(int, f[2:-5].split("_"))
    packs.setdefault((i // 4, j // 4), {})[f"{i}_{j}"] = json.load(open(os.path.join(src, f)))
for (a, b), d in packs.items():
    with open(os.path.join(dst, f"P_{a}_{b}.json"), "w") as fh:
        json.dump(d, fh, separators=(",", ":"))
if src.endswith("public/data/tiles"):
    shutil.rmtree(os.path.join(ROOT, "data/tiles_unpacked"), ignore_errors=True)
    shutil.move(src, os.path.join(ROOT, "data/tiles_unpacked"))
print(len(packs), "packs")
