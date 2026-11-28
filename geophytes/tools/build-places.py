# מיזוג קבצי data/places-raw*.json ל-data/places.json: [שם, lon, lat, דרגה]. מסנן יישובים מחוץ לישראל לפי התיאור.
import json, glob, re
seen = {}
for f in sorted(glob.glob('data/places-raw*.json')):
    for n, lon, lat, tier, kind, desc in json.load(open(f)):
        if re.search(r'Egypt|Jordan|Lebanon|Syria|Sinai|Aqaba|Governorate|Gaza', desc) and not re.search(r'Israel', desc): continue
        if re.search(r'Egypt|Jordan|Lebanon|Syria|Sinai|Aqaba', desc): continue
        if not re.search(r'(city|town|kibbutz|moshav|village|council|settlement|community|neighbou?rhood|locality)', desc[:70], re.I): continue
        if re.search(r'Roman|ancient|archaeolog|Biblical|Crusader|Ottoman|depopulated|abandoned|former|destroyed|ruin', desc, re.I): continue
        if not re.match(r'(City|Town|Local council|Municipality|Kibbutz|Moshav|Village|Community|Human settlement|Arab|Palestinian|Bedouin|Druze|Circassian|Neighbo|Israeli|Moshava|Cooperative|Regional|Urban|Religious|Jewish|Educational|Youth|Locality|Suburb|Hamlet|Settlement|Christian|Mixed|Muslim|Largest|Capital|Holy|Historic|Residential|Coastal|Mountain|Development|Kibutz|Agricultural|Collective)', desc): continue
        if re.search(r'Bible|Biblical|Canaanite|Hellenistic|Part of|Governorate|Gaza', desc): continue
        if lon < 34.6 and 31.2 < lat < 31.62: continue  # רצועת עזה
        k = (n, round(lon, 1), round(lat, 1))
        if k not in seen or tier < seen[k][3]: seen[k] = [n, lon, lat, tier]
out = sorted(seen.values(), key=lambda x: (x[3], x[0]))
json.dump(out, open('data/places.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(out), [sum(1 for x in out if x[3] == t) for t in (1, 2, 3)])
