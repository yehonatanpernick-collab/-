#!/bin/bash
# Download Midtown Manhattan open data (NYC Open Data, Socrata) as GeoJSON into raw/.
# Bbox: 34th St -> Central Park South, Hudson -> 1st Ave.
set -e
cd "$(dirname "$0")"
N=40.7860; S=40.7440; W=-74.0080; E=-73.9550
get() { # id geomcol out [extra where]
  local where="within_box($2,$N,$W,$S,$E)"; [ -n "$4" ] && where="$where AND $4"
  curl -sS --fail --retry 4 --retry-delay 5 --max-time 300 -G "https://data.cityofnewyork.us/resource/$1.geojson" \
    --data-urlencode "\$where=$where" --data-urlencode "\$limit=200000" -o "raw/$3.geojson"
  python3 -c "import json;d=json.load(open('raw/$3.geojson'));print('$3', len(d['features']))"
}
get 5zhs-2jue the_geom buildings
get inkn-q76z the_geom centerline
get 52n9-sdep the_geom sidewalks
get vs44-rznx the_geom pavement_edge
# large shapes that cross the box (Central Park, rivers): intersects instead of within_box
POLY="POLYGON(($W $S, $E $S, $E $N, $W $N, $W $S))"
geti() { curl -sS --fail --retry 4 --retry-delay 5 --max-time 300 -G "https://data.cityofnewyork.us/resource/$1.geojson" \
  --data-urlencode "\$where=intersects($2,'$POLY')" --data-urlencode "\$limit=50000" -o "raw/$3.geojson"
  python3 -c "import json;d=json.load(open('raw/$3.geojson'));print('$3', len(d['features']))"; }
geti enfh-gkve multipolygon parks
geti pjs3-c3z5 the_geom hydro
curl -sS --fail --max-time 300 -G "https://data.cityofnewyork.us/resource/uvpi-gqnh.json" \
  --data-urlencode "\$select=latitude,longitude,tree_dbh,spc_common" \
  --data-urlencode "\$where=latitude between $S and $N AND longitude between $W and $E AND status='Alive'" \
  --data-urlencode "\$limit=100000" -o raw/trees.json
