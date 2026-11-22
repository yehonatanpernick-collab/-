import html
PARTS={1:"חלק א׳ · הפארקים הלאומיים של ארצות הברית",2:"חלק ב׳ · מערכות ההרים בעולם",3:"חלק ג׳ · הרי צפון אמריקה",4:"חלק ד׳ · המערכות האקולוגיות של כדור הארץ",5:"חלק ה׳ · קרחונים ותהליכים קרחוניים"}
def fig(content, cap, cls=""):
    return f'<figure class="fig {cls}">{content}<figcaption>{cap}</figcaption></figure>'
def box(kind, title, body, tag=None):
    tags={"journey":"מסע גאוגרפי","compare":"השוואה","nature":"מדור טבע","data":"נתונים","":""}
    t=tag if tag is not None else tags.get(kind,"")
    tg=f'<span class="tag">{t}</span>' if t else ""
    return f'<div class="box {kind}"><div class="bt">{tg}<span>{title}</span></div>{body}</div>'
def table(rows, head=None):
    h=f'<tr>{"".join(f"<th>{c}</th>" for c in head)}</tr>' if head else ""
    r="".join("<tr>"+"".join(f"<td>{c}</td>" for c in row)+"</tr>" for row in rows)
    return f'<table class="dt">{h}{r}</table>'
def idcard(title, rows):
    r="".join(f"<tr><td>{a}</td><td>{b}</td></tr>" for a,b in rows)
    return f'<div class="id"><div class="ih">{title}</div><table>{r}</table></div>'
def L(s): return f'<span class="lat">{s}</span>'
def N(s): return f'<span class="num">{s}</span>'
def page(part, kicker, title, en, cols, hero="", toc=None, toc_level=2, cols_class="", tune=True, notoc=False, band=""):
    """toc: string title for table of contents (level given by toc_level)"""
    return dict(part=part, kicker=kicker, title=title, en=en, cols=cols, hero=hero, toc=toc or title, toc_level=toc_level, cols_class=cols_class, notoc=notoc, band=band)

import os
_A=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","assets")
def sf(name,cap,cls=""):
    return fig(open(os.path.join(_A,f"svg_{name}.svg")).read(),cap,cls)
