"""Download the San Francisco subset of Overture Maps (OSM-derived) into data/raw/*.parquet.
Uses the row-group index built by overture_index.py."""
import json
import os
import sys

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.fs as pafs
import pyarrow.parquet as pq

from overture_index import BBOX, s3

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
index = json.load(open(os.path.join(ROOT, "data/raw/overture_index.json")))

for tt, files in index.items():
    name = tt.split("type=")[1]
    out = os.path.join(ROOT, f"data/raw/{name}.parquet")
    if os.path.exists(out):
        print("skip", out)
        continue
    tables = []
    for path, rgs in files.items():
        with s3.open_input_file(path) as f:
            pf = pq.ParquetFile(f)
            for rg in rgs:
                t = pf.read_row_group(rg)
                b = t.column("bbox")
                xmin = pc.struct_field(b, "xmin"); xmax = pc.struct_field(b, "xmax")
                ymin = pc.struct_field(b, "ymin"); ymax = pc.struct_field(b, "ymax")
                m = pc.and_(pc.and_(pc.less_equal(xmin, BBOX[2]), pc.greater_equal(xmax, BBOX[0])),
                            pc.and_(pc.less_equal(ymin, BBOX[3]), pc.greater_equal(ymax, BBOX[1])))
                t = t.filter(m)
                if t.num_rows:
                    tables.append(t)
                print(name, path[-30:], rg, t.num_rows, file=sys.stderr)
    tab = pa.concat_tables(tables, promote_options="permissive")
    pq.write_table(tab, out, compression="zstd")
    print(name, tab.num_rows, "rows ->", out)
