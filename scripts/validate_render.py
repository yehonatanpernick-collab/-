"""Render a top-down validation map of the processed world (terrain, coastline, roads, buildings, landmarks)."""
import json, os, sys, numpy as np
from PIL import Image, ImageDraw
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..'); D=os.path.join(ROOT,'public/data')
w=json.load(open(f'{D}/world.json')); g=w['grid']
H=np.fromfile(f'{D}/height.bin',np.int16).reshape(g['h'],g['w'])/10; S=np.fromfile(f'{D}/surface.bin',np.uint8).reshape(g['h'],g['w'])
img=np.zeros((g['h'],g['w'],3),np.uint8)
hn=np.clip(H/250,0,1)
img[...,0]=(90+120*hn); img[...,1]=(95+110*hn); img[...,2]=(80+90*hn)
img[S==1]=(80,140,70); img[S==2]=(40,95,50); img[S==3]=(220,205,150); img[S==6]=(30,60,100); img[S==7]=(60,110,170)
sc=float(sys.argv[1]) if len(sys.argv)>1 else 1.0
im=Image.fromarray(img).resize((int(g['w']*sc),int(g['h']*sc)))
dr=ImageDraw.Draw(im)
def P(x,z): return ((x-g['x0'])/g['step']*sc,(z-g['z0'])/g['step']*sc)
r=json.load(open(f'{D}/roads.json')); N=r['nodes']
for e in r['e']:
    pts=e[9]; c=e[2]
    col=(255,200,60) if c<=2 else (235,235,235) if c<=5 else (170,170,170)
    if e[6]: col=(255,60,60)
    dr.line([P(pts[i],pts[i+1]) for i in range(0,len(pts),2)],fill=col,width=2 if c<=2 else 1)
for f in os.listdir(f'{D}/tiles'):
    t=json.load(open(f'{D}/tiles/{f}')); ox=t['i']*w['tile']; oz=t['j']*w['tile']
    for b in t['b']:
        ring=b['r'][0]; pts=[P(ox+ring[i]/10,oz+ring[i+1]/10) for i in range(0,len(ring),2)]
        if len(pts)>2: dr.polygon(pts,fill=(min(255,60+int(b['h'])),40,min(255,80+int(b['h']))))
for l in w['landmarks']:
    x,y=P(l['x'],l['z']); dr.ellipse([x-5,y-5,x+5,y+5],outline=(255,255,0),width=2); dr.text((x+6,y-6),l['n'],fill=(255,255,0))
im.save(sys.argv[2] if len(sys.argv)>2 else '/tmp/val.png')
