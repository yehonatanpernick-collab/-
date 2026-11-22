"""Relief-map generator: NOAA ETOPO1 shaded relief (via basemap data) + vector overlays."""
import json, os, sys
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.basemap import Basemap
DATA="/usr/local/lib/python3.13/site-packages/mpl_toolkits/basemap_data"
HERE=os.path.dirname(os.path.abspath(__file__)); ASSETS=os.path.join(HERE,"..","assets")

def make_map(key, bbox=None, proj="merc", W=1400, lat0=None, lon0=None, wh=None, rivers=False, states=False, countries=True, relief="etopo", sharpen=True):
    """bbox=(lon_min,lat_min,lon_max,lat_max) or wh=(width_m,height_m) with lat0/lon0. Returns (px_func, H)."""
    kw=dict(resolution="i")
    if proj=="lcc":
        kw.update(projection="lcc",lat_0=lat0,lon_0=lon0,lat_1=lat0-6,lat_2=lat0+6)
        if wh: kw.update(width=wh[0],height=wh[1])
        else: kw.update(llcrnrlon=bbox[0],llcrnrlat=bbox[1],urcrnrlon=bbox[2],urcrnrlat=bbox[3])
    elif proj=="merc": kw.update(projection="merc",llcrnrlon=bbox[0],llcrnrlat=bbox[1],urcrnrlon=bbox[2],urcrnrlat=bbox[3],lat_ts=(bbox[1]+bbox[3])/2)
    else: kw.update(projection="cyl",llcrnrlon=bbox[0],llcrnrlat=bbox[1],urcrnrlon=bbox[2],urcrnrlat=bbox[3])
    fig0=plt.figure(); ax0=fig0.add_axes([0,0,1,1]); kw["ax"]=ax0
    m=Basemap(**kw); plt.close(fig0)
    H=int(round(W*(m.ymax-m.ymin)/(m.xmax-m.xmin)))
    fig=plt.figure(figsize=(W/200,H/200),dpi=200); ax=fig.add_axes([0,0,1,1]); ax.axis("off")
    kw["ax"]=ax; m=Basemap(**kw)
    # ETOPO1/BMNG are 5400x2700 images; warp to the projection
    if proj in ("merc","cyl"):
        import numpy as np
        from PIL import Image
        Image.MAX_IMAGE_PIXELS=None
        im=Image.open(os.path.join(DATA,"etopo1.jpg" if relief=="etopo" else "bmng.jpg")).convert("RGB")
        iw,ih=im.size; lo0,la0,lo1,la1=bbox
        x0=int((lo0+180)/360*iw); x1=int(np.ceil((lo1+180)/360*iw)); y0=int((90-la1)/180*ih); y1=int(np.ceil((90-la0)/180*ih))
        crop=im.crop((max(x0-1,0),max(y0-1,0),min(x1+1,iw),min(y1+1,ih)))
        # exact source window in degrees
        cx0=(max(x0-1,0))/iw*360-180; cx1=(min(x1+1,iw))/iw*360-180; cy1=90-(max(y0-1,0))/ih*180; cy0=90-(min(y1+1,ih))/ih*180
        SS=2; tw,th=W*SS,H*SS
        hi=crop.resize((tw*int(np.ceil((cx1-cx0)/(lo1-lo0))) if False else int(round(tw*(cx1-cx0)/(lo1-lo0))), 4*crop.size[1]),Image.BICUBIC)
        arr=np.asarray(hi); out=np.zeros((th,tw,3),dtype=np.uint8)
        # column mapping
        cols=((np.linspace(lo0,lo1,tw)-cx0)/(cx1-cx0)*(arr.shape[1]-1)).astype(int)
        # row mapping through projection y
        ys=np.linspace(m.ymax,m.ymin,th); lons=np.full(th,(lo0+lo1)/2); _,lats=m(lons,ys,inverse=True)
        rows=((cy1-lats)/(cy1-cy0)*(arr.shape[0]-1)).clip(0,arr.shape[0]-1).astype(int)
        out=arr[rows][:,cols]
        out=Image.fromarray(out).resize((W,H),Image.LANCZOS)
        mag=W/max(1,(x1-x0)); 
        if mag>3:
            from PIL import ImageFilter
            out=out.filter(ImageFilter.GaussianBlur(radius=min(9,mag*1.0)))
        ax.imshow(np.asarray(out),extent=(m.xmin,m.xmax,m.ymin,m.ymax),aspect="auto",zorder=0); ax.set_xlim(m.xmin,m.xmax); ax.set_ylim(m.ymin,m.ymax)
    else:
        m.warpimage(image=os.path.join(DATA,"etopo1.jpg" if relief=="etopo" else "bmng.jpg"), scale=None)
    m.drawcoastlines(linewidth=.6,color="#1b2a38")
    if countries: m.drawcountries(linewidth=.7,color="#3b3b3b")
    if states: m.drawstates(linewidth=.4,color="#4a4a4a")
    if rivers: m.drawrivers(linewidth=.5,color="#2a6fb0")
    out=os.path.join(ASSETS,f"map_{key}.jpg"); fig.savefig(out,dpi=200,pil_kwargs={"quality":84})
    plt.close(fig)
    def px(lon,lat):
        x,y=m(lon,lat); return (round((x-m.xmin)/(m.xmax-m.xmin)*100,3), round((1-(y-m.ymin)/(m.ymax-m.ymin))*100,3))
    return px,H

def svg_map(key, W, H, points=(), lines=(), texts=(), px=None, disp=182):
    """Compose an SVG with the jpg and Hebrew labels. points: (lon,lat,label,kind,dx,dy,anchor)."""
    unit=disp/W; fs=2.85/unit; k=fs/17; sw=fs*0.14
    SW={"start":"end","end":"start","middle":"middle"}
    s=[f'<svg class="map" viewBox="0 0 {W} {H}" style="--fs:{fs:.1f}px;--sw:{sw:.1f}px" xmlns="http://www.w3.org/2000/svg" direction="rtl"><image href="../assets/map_{key}.jpg" width="{W}" height="{H}" preserveAspectRatio="none"/>']
    for ln in lines:
        pts=" ".join(f"{px(lo,la)[0]/100*W:.1f},{px(lo,la)[1]/100*H:.1f}" for lo,la in ln["pts"])
        s.append(f'<polyline points="{pts}" fill="none" stroke="{ln.get("c","#fff")}" stroke-width="{ln.get("w",3)*k:.1f}" stroke-dasharray="{ln.get("d","")}"  stroke-linecap="round" stroke-linejoin="round" opacity=".95"/>')
        if ln.get("label"):
            lo,la=ln["pts"][len(ln["pts"])//2]; x,y=px(lo,la)
            s.append(f'<text x="{x/100*W+ln.get("dx",0)*k:.1f}" y="{y/100*H+ln.get("dy",-8)*k:.1f}" class="mlab zone" text-anchor="middle">{ln["label"]}</text>')
    for p in points:
        lo,la,lab,kind=p[:4]; dx=(p[4] if len(p)>4 else 0)*k; dy=(p[5] if len(p)>5 else -9)*k; an=SW[p[6] if len(p)>6 else "middle"]
        x,y=px(lo,la); x=x/100*W; y=y/100*H
        if kind=="peak": s.append(f'<path d="M{x-5*k:.1f},{y+4*k:.1f} L{x:.1f},{y-6*k:.1f} L{x+5*k:.1f},{y+4*k:.1f}Z" fill="#c8362d" stroke="#fff" stroke-width="1.2"/>')
        elif kind=="park": s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{6.5*k:.1f}" fill="#1f7a3d" stroke="#fff" stroke-width="{2*k:.1f}"/>')
        elif kind=="city": s.append(f'<rect x="{x-3.5*k:.1f}" y="{y-3.5*k:.1f}" width="{7*k:.1f}" height="{7*k:.1f}" fill="#222" stroke="#fff" stroke-width="1.2"/>')
        elif kind.startswith("dot"):
            col=kind.split(":")[1] if ":" in kind else "#fff"; s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{6*k:.1f}" fill="{col}" stroke="#fff" stroke-width="{2*k:.1f}"/>')
        elif kind=="lake": s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{4.5*k:.1f}" fill="#39a7d8" stroke="#fff" stroke-width="{1.5*k:.1f}"/>')
        elif kind=="volc": s.append(f'<path d="M{x-6:.1f},{y+5:.1f} L{x-2:.1f},{y-5:.1f} L{x+2:.1f},{y-5:.1f} L{x+6:.1f},{y+5:.1f}Z" fill="#e8741a" stroke="#fff" stroke-width="1.2"/>')
        cls="mlab park" if kind=="park" else "mlab"
        if lab: s.append(f'<text x="{x+dx:.1f}" y="{y+dy:.1f}" class="{cls}" text-anchor="{an}">{lab}</text>')
    for t in texts:
        lo,la,lab=t[:3]; rot=t[3] if len(t)>3 else 0; x,y=px(lo,la); x=x/100*W; y=y/100*H
        s.append(f'<text x="{x:.1f}" y="{y:.1f}" class="mlab zone" text-anchor="middle" transform="rotate({rot} {x:.1f} {y:.1f})">{lab}</text>')
    s.append("</svg>")
    return "\n".join(s)
