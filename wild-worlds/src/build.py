import sys, os, json, importlib
sys.path.insert(0, os.path.dirname(__file__))
from lib import PARTS
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..")
mods=[m for m in sys.argv[1:] if not m.startswith("-")] or ["front","p1","p2","p3","p4","p5","back"]
allpages=[]
for m in mods:
    mod=importlib.import_module(m); allpages+=mod.pages()
from patches import PATCH
for p in allpages:
    if not p.get('raw') and p.get('toc') in PATCH: p['cols']+=PATCH[p['toc']]
# numbering: cover=1(unnumbered). content pages numbered by order of 'part' pages
html_pages=[]; toc=[]; n=0; lastpart=None; content_idx=0
for p in allpages:
    n+=1
    if p.get("raw"):
        pg=p["raw"].replace("@@PN@@",str(n)); html_pages.append(pg); continue
    run=f'<div class="run"><span>עולמות פראיים · אנציקלופדיה מאוירת</span><b>{PARTS.get(p["part"],p.get("band",""))}</b></div>'
    foot=f'<div class="foot"><span>מקורות הנתונים: ראו רשימת המקורות בסוף הספר</span><span class="pn">{n}</span></div>'
    t=f'<div class="ptitle"><div><div class="k">{p["kicker"]}</div><h1>{p["title"]}</h1></div><div class="en">{p["en"]}</div></div>'
    hero=f'<div class="hero">{p["hero"]}</div>' if p.get("hero") else ""
    body=f'<div class="body">{t}{hero}<div class="cols {p.get("cols_class","")}">{p["cols"]}</div></div>'
    html_pages.append(f'<section class="page" data-n="{n}">{run}{body}{foot}</section>')
    if p.get("notoc"): continue
    if p["part"]!=lastpart and p["part"] in PARTS: toc.append((1,PARTS[p["part"]],n)); lastpart=p["part"]
    toc.append((p["toc_level"],p["toc"],n))
# TOC substitution
rows=""
for lvl,title,pg in toc:
    rows+=f'<div class="tocrow l{lvl}"><span>{title}</span><span class="dots"></span><span class="pg">{pg}</span></div>'
doc='<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>עולמות פראיים</title><link rel="stylesheet" href="style.css"></head><body>'+"\n".join(html_pages).replace("@@TOC@@",rows)+'</body></html>'
open(os.path.join(ROOT,"src","book.html"),"w").write(doc)
json.dump(toc,open(os.path.join(ROOT,"out","toc.json"),"w"),ensure_ascii=False)
print("pages:",n)
