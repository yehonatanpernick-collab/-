"""Find which Overture parquet files / row groups intersect the San Francisco bbox,
using only parquet footer statistics (no full download)."""
import json
import sys
from concurrent.futures import ThreadPoolExecutor

import pyarrow.fs as pafs
import pyarrow.parquet as pq

RELEASE = "2026-10-21.0"
BBOX = (-122.535, 37.700, -122.345, 37.845)  # lon_min, lat_min, lon_max, lat_max

s3 = pafs.S3FileSystem(anonymous=True, region="us-west-2", connect_timeout=20, request_timeout=60)


def col_index(schema, path):
    for i in range(len(schema)):
        if schema.column(i).path == path:
            return i
    return None


def scan(path):
    with s3.open_input_file(path) as f:
        md = pq.ParquetFile(f).metadata
    s = md.schema
    ix = {k: col_index(s, "bbox." + k) for k in ("xmin", "xmax", "ymin", "ymax")}
    hits = []
    for rg in range(md.num_row_groups):
        r = md.row_group(rg)
        st = {k: r.column(i).statistics for k, i in ix.items()}
        if any(v is None or not v.has_min_max for v in st.values()):
            hits.append(rg)
            continue
        if st["xmin"].min > BBOX[2] or st["xmax"].max < BBOX[0] or st["ymin"].min > BBOX[3] or st["ymax"].max < BBOX[1]:
            continue
        hits.append(rg)
    return path, hits, md.num_row_groups


def main(theme_type):
    base = f"overturemaps-us-west-2/release/{RELEASE}/{theme_type}"
    files = [i.path for i in s3.get_file_info(pafs.FileSelector(base)) if i.path.endswith(".parquet")]
    out = {}
    with ThreadPoolExecutor(32) as ex:
        for path, hits, n in ex.map(scan, files):
            if hits:
                out[path] = hits
    print(theme_type, len(files), "files;", sum(len(v) for v in out.values()), "row groups hit in", len(out), "files", file=sys.stderr)
    return out


if __name__ == "__main__":
    res = {}
    for tt in sys.argv[1:]:
        res[tt] = main(tt)
    json.dump(res, open(sys.argv[0].replace("overture_index.py", "../data/raw/overture_index.json"), "w"), indent=1)
