"""Scientific diagrams as inline SVG (viewBox units ~0.15 mm at full width 1200 / 0.15 at half 600)."""
import math
AN={"l":"start","r":"end","m":"middle"}   # l: text extends left of x; r: extends right of x   # physical anchors in an RTL svg
def svg(W,H,body,defs=""):
    return f'<svg class="d" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" direction="rtl"><defs>{defs}</defs>{body}</svg>'
def tx(x,y,s,a="m",c="",fs=None,fill=None,rot=0,w=None):
    st=""
    if fs: st+=f"font-size:{fs}px;"
    if fill: st+=f"fill:{fill};"
    if w: st+=f"font-weight:{w};"
    r=f' transform="rotate({rot} {x} {y})"' if rot else ""
    return f'<text x="{x}" y="{y}" text-anchor="{AN[a]}" class="{c}" style="{st}"{r}>{s}</text>'
def poly(pts,fill,stroke="none",sw=1.5,op=1,extra=""):
    return f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x,y in pts)}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" opacity="{op}" {extra}/>'
def line(pts,stroke,sw=2,dash="",op=1,fill="none"):
    return f'<polyline points="{" ".join(f"{x:.1f},{y:.1f}" for x,y in pts)}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-dasharray="{dash}" stroke-linejoin="round" stroke-linecap="round" opacity="{op}"/>'
def rect(x,y,w,h,fill,stroke="none",sw=1,rx=0,op=1):
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" opacity="{op}"/>'
def circ(x,y,r,fill,stroke="none",sw=1):
    return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'
def arrow(x1,y1,x2,y2,col="#1c2428",sw=2.2):
    a=math.atan2(y2-y1,x2-x1); h=9
    p=[(x2,y2),(x2-h*math.cos(a-0.45),y2-h*math.sin(a-0.45)),(x2-h*math.cos(a+0.45),y2-h*math.sin(a+0.45))]
    return line([(x1,y1),(x2,y2)],col,sw)+poly(p,col)

def profile(uid,W,H,pts,ymin,ymax,bands=(),marks=(),overlay=None,step=1000,sil="#7b7466",sky1="#bfe0f0",sky2="#f4fafc",pad=(70,16,34,52),xlabels=(),notes="",unit="מ'"):
    pl,pr,pt,pb=pad[0],pad[1],pad[2],pad[3]
    X=lambda x:pl+x/100*(W-pl-pr); Y=lambda e:pt+(ymax-e)/(ymax-ymin)*(H-pt-pb)
    d=f'<linearGradient id="sk{uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{sky1}"/><stop offset="1" stop-color="{sky2}"/></linearGradient>'
    sp=[(X(x),Y(e)) for x,e in pts]; base=H-pb
    full=[(sp[0][0],base)]+sp+[(sp[-1][0],base)]
    d+=f'<clipPath id="cl{uid}"><polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x,y in full)}"/></clipPath>'
    b=rect(pl,pt,W-pl-pr,H-pt-pb,f"url(#sk{uid})")
    # gridlines
    e=math.ceil(ymin/step)*step
    while e<=ymax:
        b+=line([(pl,Y(e)),(W-pr,Y(e))],"#9fb3bd",1,"3 5",.7)+tx(pl-8,Y(e)+5,f"{e:,}","l","s")
        e+=step
    b+=tx(16,(pt+H-pb)/2,"גובה ("+unit+")","m","s",rot=-90)
    b+=f'<g clip-path="url(#cl{uid})">'+rect(pl,pt,W-pl-pr,H-pt-pb,sil)
    for lo,hi,col,lab in bands:
        y1,y2=Y(min(hi,ymax)),Y(max(lo,ymin)); b+=rect(pl,y1,W-pl-pr,y2-y1,col)
    b+='</g>'
    b+=line(sp,"#2b2f2a",2.2)
    for lo,hi,col,lab in bands:
        if lab:
            yc=(Y(min(hi,ymax))+Y(max(lo,ymin)))/2
            b+=rect(W-pr-4,Y(min(hi,ymax)),6,Y(max(lo,ymin))-Y(min(hi,ymax)),col,"#555",.8)
    if overlay:
        ov=overlay; vmax=ov["vmax"]; ys=lambda v:H-pb-(v/vmax)*(H-pt-pb)*0.92
        op=[(X(x),ys(v)) for x,v in ov["pts"]]
        b+=line(op,ov.get("color","#0b5fa5"),3.4)+"".join(circ(x,y,4.2,ov.get("color","#0b5fa5"),"#fff",1.4) for x,y in op[::max(1,len(op)//8)])
        for (x,v),(px_,py_) in zip(ov["pts"],op): b+=tx(px_,py_-10,f"{v:,}","m","s",fs=14.5,fill=ov.get("color","#0b5fa5"),w=800)
        b+=rect(pl+6,H-pb-30,W-pl-pr-12,24,"#fff",op=.78)+tx(X(50),H-pb-12,ov["label"],"m","t",fill=ov.get("color","#0b5fa5"),fs=15.5)
    for m in marks:
        x,e,lab=m[:3]; dy=m[3] if len(m)>3 else -12; a=m[4] if len(m)>4 else ("l" if x>86 else ("r" if x<12 else "m"))
        xo=X(x)+(10 if a=="r" else (-10 if a=="l" else 0))
        b+=poly([(X(x)-6,Y(e)+0),(X(x),Y(e)-10),(X(x)+6,Y(e)+0)],"#c8362d","#fff",1)+tx(xo,Y(e)+dy-8 if dy<0 else Y(e)+dy,lab,a,"s",fs=16.5,w=700)
    # legend bands
    ly=pt+8
    for lo,hi,col,lab in bands:
        if lab:
            b+=rect(W-pr-170-0,ly-9,16,12,col,"#555",.6)+tx(W-pr-176,ly+1,lab,"l","s",fs=15)  # at right side inside? placed physical right
            ly+=19
    for xl,s in xlabels:
        b+=tx(X(xl),H-pb+22,s,"m","s",fs=15.5)
    b+=notes
    return svg(W,H,b,d)

def hbars(W,items,title="",unit="",color="#2f6b4f",colors=None,labw=190,maxv=None,rowh=34,fmt="{:,.0f}"):
    mv=maxv or max(v for _,v in items)*1.0; H=36+rowh*len(items)+8; b=tx(W/2,22,title,"m","t") if title else ""
    for i,(lab,v) in enumerate(items):
        y=34+i*rowh; w=(W-labw-90)*v/mv; c=(colors[i] if colors else color)
        b+=tx(W-12,y+rowh*0.62,lab,"l","s",fs=16)+rect(W-12-labw-w+0,y+4,w,rowh-10,c,rx=2)+tx(W-12-labw-w-6,y+rowh*0.62,fmt.format(v)+(" "+unit if unit else ""),"l","s",fs=15.5,w=700)
    return svg(W,H,b)
def vbars(W,H,items,title="",unit="",color="#2a7fa8",colors=None,maxv=None,fmt="{:,.0f}",ytitle=""):
    mv=maxv or max(v for _,v in items)*1.12; n=len(items); pl,pr,pt,pb=50,14,38,58
    bw=(W-pl-pr)/n; b=tx(W/2,22,title,"m","t") if title else ""
    b+=line([(pl,pt),(pl,H-pb),(W-pr,H-pb)],"#445",1.6)
    for i,(lab,v) in enumerate(items):
        h=(H-pt-pb)*v/mv; x=pl+i*bw+bw*0.15
        c=colors[i] if colors else color
        b+=rect(x,H-pb-h,bw*0.7,h,c,rx=2)+tx(x+bw*0.35,H-pb-h-6,fmt.format(v),"m","s",fs=15,w=700)+tx(x+bw*0.35,H-pb+19,lab,"m","s",fs=14.5)
    if ytitle: b+=tx(14,(pt+H-pb)/2,ytitle,"m","s",rot=-90,fs=14)
    return svg(W,H,b)
def milestones(W,H,events,title=""):
    """events: (time label, text, color). Horizontal line with markers; time flows right->left (old at right)."""
    n=len(events); b=tx(W/2,22,title,"m","t") if title else ""
    y0=H*0.42; b+=line([(30,y0),(W-30,y0)],"#445",3)
    for i,(t,s,c) in enumerate(events):
        x=W-60-i*(W-120)/(n-1); b+=circ(x,y0,10,c,"#fff",2.5)+tx(x,y0-20,t,"m","t",fs=16.5)
        words=s.split("|")
        for j,wd in enumerate(words): b+=tx(x,y0+30+j*19,wd,"m","s",fs=14.8)
    return svg(W,H,b)
