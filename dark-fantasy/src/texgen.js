// ============================================================
//  GPU texture baker — renders tileable PBR texture sets
//  (albedo / normal / AO-roughness-metal / emissive) with shaders.
// ============================================================
import * as THREE from 'three';

const LIB = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uSeed;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031 + uSeed*0.0173); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973) + uSeed*0.0119); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec2 wrap(vec2 i, vec2 rep){ return mod(i, rep); }
float vnoise(vec2 p, vec2 rep){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  float a = hash12(wrap(i,rep)), b = hash12(wrap(i+vec2(1,0),rep)), c = hash12(wrap(i+vec2(0,1),rep)), d = hash12(wrap(i+vec2(1,1),rep));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float gnoise(vec2 p, vec2 rep){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*f*(f*(f*6.-15.)+10.);
  vec2 ga = hash22(wrap(i,rep))*2.-1., gb = hash22(wrap(i+vec2(1,0),rep))*2.-1.;
  vec2 gc = hash22(wrap(i+vec2(0,1),rep))*2.-1., gd = hash22(wrap(i+vec2(1,1),rep))*2.-1.;
  float a = dot(ga, f), b = dot(gb, f-vec2(1,0)), c = dot(gc, f-vec2(0,1)), d = dot(gd, f-vec2(1,1));
  return 0.5 + 0.75*mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p, vec2 rep, int oct){
  float s = 0., a = .5, n = 0.;
  for(int k=0;k<8;k++){ if(k>=oct) break; s += a*gnoise(p,rep); n += a; p *= 2.; rep *= 2.; a *= .5; }
  return s/n;
}
float ridged(vec2 p, vec2 rep, int oct){
  float s = 0., a = .5, n = 0.;
  for(int k=0;k<8;k++){ if(k>=oct) break; float v = 1. - abs(gnoise(p,rep)*2.-1.); s += a*v*v; n += a; p *= 2.; rep *= 2.; a *= .5; }
  return s/n;
}
// x: F1, y: F2, z: cell id
vec3 worley(vec2 p, vec2 rep){
  vec2 i = floor(p), f = fract(p); float f1 = 8., f2 = 8., id = 0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g = vec2(float(x),float(y)); vec2 c = wrap(i+g, rep); vec2 o = hash22(c);
    vec2 r = g + o - f; float d = dot(r,r);
    if(d < f1){ f2 = f1; f1 = d; id = hash12(c+7.31); } else if(d < f2) f2 = d;
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
float sat(float x){ return clamp(x,0.,1.); }
`;

// Each material implements:
//   void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e)
export const SURF = {
  steel: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    vec3 w = worley(uv*7., vec2(7.));
    float dent = smoothstep(0.0, 0.85, w.x);
    float big = fbm(uv*3., vec2(3.), 5);
    float s1 = gnoise(vec2(uv.x*140., uv.y*5.), vec2(140.,5.));
    float s2 = gnoise(vec2((uv.x+uv.y)*110., (uv.x-uv.y)*4.), vec2(110.,4.));
    float s3 = gnoise(vec2((uv.x-uv.y)*90., (uv.x+uv.y)*3.), vec2(90.,3.));
    float sc = (smoothstep(0.9, 0.94, s1)*0.4 + smoothstep(0.91, 0.95, s2)*0.7 + smoothstep(0.92, 0.96, s3)*0.5) * smoothstep(0.35,0.7,fbm(uv*5.+1.3, vec2(5.), 3));
    float grime = smoothstep(0.5, 0.78, fbm(uv*4.+3.1, vec2(4.), 6));
    float pits = smoothstep(0.78, 0.86, vnoise(uv*160., vec2(160.)));
    h = dent*0.08 + big*0.3 - sc*0.05 - pits*0.05;
    a = vec3(0.6,0.61,0.64)*(0.8+0.35*big);
    a = mix(a, vec3(0.16,0.14,0.12), grime*0.6 + pits*0.4);
    a += sc*0.06;
    r = 0.3 + big*0.25 + grime*0.35 + pits*0.2 - sc*0.08 + (1.-dent)*0.04;
    m = 1.0 - grime*0.35;
    e = vec3(0);
  }`,
  gold: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    vec2 p = uv*vec2(8.,4.); vec2 cid = floor(p); vec2 c = fract(p)-0.5;
    if (mod(cid.x+cid.y,2.)>0.5) c.x = -c.x;
    float ang = atan(c.y,c.x); float rad = length(c);
    float scroll = sin(ang*2.0 + rad*26.0);
    float eng = smoothstep(0.82, 0.96, abs(scroll)) * smoothstep(0.48, 0.3, rad);
    float leaf = smoothstep(0.06, 0.0, abs(rad-0.38)) ;
    float n = fbm(uv*6., vec2(6.), 5);
    float wear = smoothstep(0.55, 0.8, fbm(uv*3.+9., vec2(3.), 4));
    h = 0.6 - eng*0.5 - leaf*0.3 + n*0.1;
    a = vec3(1.0,0.72,0.34)*(0.75+0.35*n);
    a = mix(a, vec3(0.25,0.15,0.06), (eng+leaf)*0.7);
    a = mix(a, a*0.55, wear*0.4);
    r = 0.22 + (eng+leaf)*0.4 + n*0.12 + wear*0.15;
    m = 1.0;
    e = vec3(0);
  }`,
  leather: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    vec3 w = worley(uv*48., vec2(48.));
    float grain = smoothstep(0.0, 0.5, w.y - w.x);
    float wr = ridged(uv*5., vec2(5.), 5);
    float n = fbm(uv*8., vec2(8.), 5);
    float scuff = smoothstep(0.62, 0.8, fbm(uv*6.+2., vec2(6.), 5));
    h = grain*0.25 - wr*0.35 + n*0.2;
    a = vec3(0.16,0.09,0.05)*(0.7+0.6*n);
    a = mix(a, vec3(0.32,0.22,0.15), scuff*0.6);
    a *= 0.85 + 0.15*grain;
    r = 0.62 + (1.-grain)*0.1 + scuff*0.15 - wr*0.1;
    m = 0.;
    e = vec3(0);
  }`,
  cloth: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    float N = 150.;
    vec2 g = uv*N;
    float cell = mod(floor(g.x)+floor(g.y), 2.);
    float wx = sin(fract(g.x)*3.14159), wy = sin(fract(g.y)*3.14159);
    float thread = mix(wy*0.8+0.2*wx, wx*0.8+0.2*wy, cell);
    float n = fbm(uv*6., vec2(6.), 6);
    float wear = smoothstep(0.6, 0.85, fbm(uv*4.+5., vec2(4.), 6));
    float stain = smoothstep(0.55, 0.8, fbm(uv*2.+11., vec2(2.), 5));
    h = thread*0.5 + n*0.3 - wear*0.2;
    a = vec3(0.85)*(0.75+0.3*n)*(0.8+0.2*thread);
    a = mix(a, a*0.45, stain*0.7);
    a = mix(a, vec3(0.5,0.45,0.4), wear*0.35);
    r = 0.85 - thread*0.08;
    m = 0.;
    e = vec3(0);
  }`,
  chain: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    float N = 36.;
    vec2 g = uv*vec2(N, N*1.2);
    float row = floor(g.y);
    g.x += mod(row,2.)*0.5;
    vec2 c = fract(g)-0.5; c.y *= 1.2;
    float d = abs(length(c)-0.33);
    float ring = smoothstep(0.12, 0.03, d);
    vec2 c2 = fract(g+vec2(0.5,0.5))-0.5; c2.y*=1.2;
    float ring2 = smoothstep(0.12, 0.03, abs(length(c2)-0.33));
    float rr = max(ring, ring2*0.8);
    float n = fbm(uv*5., vec2(5.), 4);
    h = rr;
    a = mix(vec3(0.03), vec3(0.5,0.5,0.52)*(0.7+0.4*n), rr);
    r = mix(0.9, 0.3+n*0.25, rr);
    m = rr;
    e = vec3(0);
  }`,
  bone: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    vec3 w = worley(uv*10., vec2(10.));
    float crack = smoothstep(0.035, 0.0, w.y - w.x) * smoothstep(0.45,0.65, fbm(uv*3., vec2(3.), 4));
    float pores = smoothstep(0.75, 0.9, vnoise(uv*120., vec2(120.)));
    float n = fbm(uv*5., vec2(5.), 6);
    float stain = smoothstep(0.45, 0.85, fbm(uv*3.+4., vec2(3.), 6));
    float streak = gnoise(vec2(uv.x*30., uv.y*2.), vec2(30.,2.));
    h = n*0.5 - crack*0.6 - pores*0.2 + streak*0.1;
    a = vec3(0.78,0.72,0.6)*(0.75+0.35*n);
    a = mix(a, vec3(0.33,0.25,0.16), stain*0.75);
    a = mix(a, vec3(0.1,0.07,0.05), crack*0.9 + pores*0.4);
    r = 0.55 + stain*0.2 + crack*0.2;
    m = 0.;
    e = vec3(0);
  }`,
  rust: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    float n = fbm(uv*4., vec2(4.), 6);
    float rust = smoothstep(0.38, 0.62, n + 0.2*fbm(uv*20., vec2(20.), 3));
    float flake = smoothstep(0.6, 0.8, vnoise(uv*80., vec2(80.)));
    float pits = smoothstep(0.7, 0.9, worley(uv*30., vec2(30.)).x);
    h = rust*0.4 + flake*rust*0.2 - pits*0.2;
    vec3 steel = vec3(0.42,0.42,0.44)*(0.8+0.3*n);
    vec3 ru = mix(vec3(0.32,0.12,0.04), vec3(0.55,0.28,0.1), flake)*(0.7+0.5*fbm(uv*9., vec2(9.),4));
    a = mix(steel, ru, rust);
    r = mix(0.35, 0.92, rust);
    m = mix(0.95, 0.15, rust);
    e = vec3(0);
  }`,
  ashlar: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    float rows = 5., cols = 2.5;
    float ry = floor(uv.y*rows);
    float off = mod(ry,2.)*0.5 + hash12(vec2(ry, 3.))*0.3;
    float bx = uv.x*cols + off;
    vec2 f = vec2(fract(bx), fract(uv.y*rows));
    vec2 id = vec2(floor(bx), ry);
    float ed = min(min(f.x, 1.-f.x)*cols/rows*1.0, min(f.y, 1.-f.y));
    float bevel = smoothstep(0.0, 0.08, ed);
    float n = fbm(uv*8., vec2(8.), 6);
    float chip = smoothstep(0.62, 0.75, fbm(uv*14.+id*3.1, vec2(14.), 4)) * (1.-smoothstep(0.0,0.1,ed))*1.5;
    float tone = hash12(mod(id, vec2(cols*2., rows)));
    vec3 w = worley(uv*16., vec2(16.));
    float crack = smoothstep(0.03, 0.0, w.y-w.x) * smoothstep(0.55,0.7, fbm(uv*4.+id, vec2(4.), 3));
    float moss = smoothstep(0.55, 0.75, fbm(uv*3.+1.7, vec2(3.), 5)) * (1.-bevel*0.5);
    h = bevel*0.6 + n*0.3 - chip*0.3 - crack*0.3;
    a = vec3(0.44,0.41,0.4)*(0.65+0.4*tone)*(0.8+0.35*n);
    a = mix(a, vec3(0.08,0.07,0.07), (1.-bevel)*0.85 + crack*0.6);
    a = mix(a, vec3(0.13,0.16,0.09), moss*0.6);
    r = 0.82 + (1.-bevel)*0.1 - n*0.1;
    m = 0.;
    e = vec3(0);
  }`,
  rock: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    float rd = ridged(uv*3., vec2(3.), 7);
    float n = fbm(uv*5., vec2(5.), 6);
    float strata = sin((uv.y*12. + n*1.5)*6.2831)*0.5+0.5;
    vec3 w = worley(uv*9., vec2(9.));
    float crack = smoothstep(0.04,0.0, w.y-w.x);
    float lichen = smoothstep(0.62, 0.78, fbm(uv*7.+3., vec2(7.), 5));
    h = rd*0.6 + strata*0.15 + n*0.25 - crack*0.25;
    a = vec3(0.36,0.34,0.34)*(0.6+0.5*n)*(0.85+0.2*strata);
    a = mix(a, vec3(0.06), crack*0.7);
    a = mix(a, vec3(0.42,0.43,0.33), lichen*0.35);
    r = 0.78 + crack*0.1 - rd*0.08;
    m = 0.;
    e = vec3(0);
  }`,
  bark: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    vec3 w = worley(vec2(uv.x*10., uv.y*2.5), vec2(10.,2.5));
    float plates = smoothstep(0.0, 0.25, w.y-w.x);
    float fib = gnoise(vec2(uv.x*60., uv.y*4.), vec2(60.,4.));
    float n = fbm(uv*4., vec2(4.), 5);
    h = plates*0.6 + fib*0.25 + n*0.15;
    a = vec3(0.17,0.13,0.11)*(0.55+0.6*plates)*(0.8+0.3*fib);
    a = mix(a, vec3(0.2,0.22,0.16), smoothstep(0.6,0.8,fbm(uv*3.+2., vec2(3.),4))*0.4);
    r = 0.9;
    m = 0.;
    e = vec3(0);
  }`,
  soil: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    float n = fbm(uv*6., vec2(6.), 7);
    vec3 w = worley(uv*24., vec2(24.));
    float peb = smoothstep(0.3, 0.1, w.x) * step(0.7, w.z);
    vec3 w2 = worley(uv*60., vec2(60.));
    float grit = smoothstep(0.3, 0.1, w2.x) * step(0.6, w2.z);
    float leaf = smoothstep(0.7, 0.85, fbm(uv*10.+4., vec2(10.), 4));
    float cr = smoothstep(0.03, 0.0, abs(fbm(uv*3.+7., vec2(3.), 5)-0.5));
    h = n*0.4 + peb*0.5 + grit*0.15 - cr*0.4;
    a = vec3(0.15,0.12,0.1)*(0.6+0.6*n);
    a = mix(a, vec3(0.2,0.19,0.18)*(0.7+0.5*w.z), peb*0.8);
    a = mix(a, vec3(0.22,0.14,0.07), leaf*0.6);
    a *= 1.-cr*0.5;
    r = 0.92 - peb*0.15;
    m = 0.;
    e = vec3(0);
  }`,
  moss: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    float n = fbm(uv*8., vec2(8.), 7);
    float tufts = vnoise(uv*90., vec2(90.));
    float dry = smoothstep(0.4, 0.7, fbm(uv*3.+2., vec2(3.), 5));
    h = n*0.5 + tufts*0.4;
    a = mix(vec3(0.09,0.11,0.06), vec3(0.24,0.21,0.13), dry)*(0.6+0.6*n)*(0.8+0.3*tufts);
    r = 0.95;
    m = 0.;
    e = vec3(0);
  }`,
  snow: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    float n = fbm(uv*4., vec2(4.), 7);
    float drift = gnoise(vec2(uv.x*3., uv.y*14.), vec2(3.,14.));
    float sparkle = step(0.985, hash12(floor(uv*512.)));
    vec3 w = worley(uv*20., vec2(20.));
    float crust = smoothstep(0.0,0.3,w.y-w.x);
    h = n*0.6 + drift*0.25 + crust*0.1;
    a = vec3(0.86,0.9,0.98)*(0.85+0.15*n);
    a = mix(a, vec3(0.62,0.7,0.85), (1.-n)*0.35);
    r = 0.72 - sparkle*0.6 - crust*0.08;
    m = 0.;
    e = vec3(0);
  }`,
  ice: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    vec3 w = worley(uv*6., vec2(6.));
    vec3 w2 = worley(uv*17., vec2(17.));
    float crack = smoothstep(0.025,0.0, w.y-w.x) + smoothstep(0.02,0.0, w2.y-w2.x)*0.6;
    float bub = smoothstep(0.08, 0.0, worley(uv*50., vec2(50.)).x) * step(0.7, worley(uv*50., vec2(50.)).z);
    float n = fbm(uv*3., vec2(3.), 6);
    float frost = smoothstep(0.55, 0.8, fbm(uv*9.+5., vec2(9.), 5));
    h = n*0.3 - crack*0.3 + frost*0.2;
    a = mix(vec3(0.22,0.3,0.38), vec3(0.55,0.68,0.78), n);
    a = mix(a, vec3(0.85,0.95,1.0), crack*0.8 + frost*0.6 + bub*0.5);
    r = 0.06 + frost*0.5 + crack*0.2;
    m = 0.;
    e = vec3(0.0,0.03,0.06)*n;
  }`,
  basalt: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    vec3 w = worley(uv*5., vec2(5.));
    float edge = w.y - w.x;
    float crack = smoothstep(0.07, 0.0, edge);
    float glow = smoothstep(0.045, 0.0, edge) * smoothstep(0.35, 0.65, fbm(uv*2.+1., vec2(2.), 4));
    float n = fbm(uv*7., vec2(7.), 6);
    float vesic = smoothstep(0.75, 0.9, vnoise(uv*90., vec2(90.)));
    h = smoothstep(0.0,0.2,edge)*0.6 + n*0.3 - vesic*0.2;
    a = vec3(0.06,0.055,0.055)*(0.7+0.6*n);
    a = mix(a, vec3(0.02), crack);
    r = 0.62 + n*0.2 + vesic*0.2 - (1.-crack)*0.1;
    m = 0.;
    e = vec3(5.0,1.2,0.15)*glow*(0.6+0.6*n);
  }`,
  ash: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    float n = fbm(uv*5., vec2(5.), 7);
    float dune = gnoise(vec2(uv.x*2., uv.y*9.), vec2(2.,9.));
    vec3 w = worley(uv*30., vec2(30.));
    float cinder = smoothstep(0.3,0.1,w.x)*step(0.6,w.z);
    float ember = step(0.996, hash12(floor(uv*400.)));
    h = n*0.5 + dune*0.2 + cinder*0.4;
    a = vec3(0.16,0.15,0.15)*(0.55+0.7*n);
    a = mix(a, vec3(0.04), cinder*0.8);
    r = 0.95;
    m = 0.;
    e = vec3(4.,1.,0.2)*ember;
  }`,
  voidstone: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    vec3 w = worley(uv*4., vec2(4.));
    float vein = smoothstep(0.014, 0.0, abs(fbm(uv*3., vec2(3.), 6)-0.5));
    float tiles = smoothstep(0.0, 0.06, w.y - w.x);
    float n = fbm(uv*8., vec2(8.), 6);
    h = tiles*0.5 + n*0.3 - vein*0.3;
    a = vec3(0.07,0.06,0.09)*(0.6+0.6*n);
    a = mix(a, vec3(0.01), 1.-tiles);
    r = 0.35 + n*0.3;
    m = 0.2;
    e = vec3(1.6,0.5,4.0)*vein*(0.5+n);
  }`,
  emblem: /* glsl */`
  void surf(vec2 uv, out vec3 a, out float h, out float r, out float m, out vec3 e){
    // heraldic tabard: dark crimson field, faded bone-white emblem (a crowned flame)
    vec2 p = uv - vec2(0.5, 0.56);
    float flame = smoothstep(0.02,0.0, length(vec2(p.x*(1.6+p.y*3.), p.y*0.9+0.03)) - 0.16 + 0.05*sin(p.y*40.));
    float tip = smoothstep(0.015,0.0, abs(p.x) - (0.02 - p.y*0.12)) * step(0.0,p.y) * step(p.y,0.28);
    float ring = smoothstep(0.012,0.0, abs(length(p)-0.27));
    float border = smoothstep(0.03, 0.0, min(min(uv.x, 1.-uv.x), 1.-uv.y)-0.03);
    float sym = max(max(flame, tip), max(ring, border));
    float n = fbm(uv*5., vec2(5.), 6);
    float N = 150.; vec2 g = uv*N; float cell = mod(floor(g.x)+floor(g.y), 2.);
    float thread = mix(sin(fract(g.y)*3.14), sin(fract(g.x)*3.14), cell);
    float wear = smoothstep(0.55, 0.8, fbm(uv*4.+5., vec2(4.), 6));
    h = thread*0.5 + n*0.3 + sym*0.15;
    a = mix(vec3(0.22,0.025,0.03), vec3(0.75,0.68,0.55), sym*(1.-wear*0.6));
    a *= (0.75+0.35*n)*(0.85+0.15*thread);
    a = mix(a, vec3(0.1,0.08,0.07), smoothstep(0.6,0.9,fbm(uv*2.+8., vec2(2.), 5))*0.5);
    r = 0.88;
    m = 0.;
    e = vec3(0);
  }`,
};

export class TexBaker {
  constructor(renderer, size = 1024) {
    this.renderer = renderer;
    this.size = size;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.cache = {};
  }
  _rt(size) {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: false, depthBuffer: false,
    });
    return rt;
  }
  bake(name, opts = {}) {
    if (this.cache[name]) return this.cache[name];
    const size = opts.size || this.size;
    const code = SURF[name];
    const out = {};
    const modes = opts.emissive ? [0, 1, 2, 3] : [0, 1, 2];
    const prevTarget = this.renderer.getRenderTarget();
    const prevXR = this.renderer.xr.enabled;
    const prevTM = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.NoToneMapping;
    for (const mode of modes) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uSeed: { value: opts.seed ?? 1 } },
        defines: { MODE: mode, RES: size.toFixed(1), NSTR: (opts.normal ?? 6).toFixed(2), AOSTR: (opts.ao ?? 2.5).toFixed(2) },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: LIB + code + /* glsl */`
        void main(){
          vec3 a; float h, r, m; vec3 e;
          surf(vUv, a, h, r, m, e);
        #if MODE == 0
          gl_FragColor = vec4(clamp(a,0.,1.), 1.0);
        #elif MODE == 1
          float px = 1.5 / RES; vec3 t3, t4; float t1, t2, hl, hr, hd, hu;
          surf(vUv - vec2(px,0.), t3, hl, t1, t2, t4);
          surf(vUv + vec2(px,0.), t3, hr, t1, t2, t4);
          surf(vUv - vec2(0.,px), t3, hd, t1, t2, t4);
          surf(vUv + vec2(0.,px), t3, hu, t1, t2, t4);
          vec3 n = normalize(vec3((hl - hr) * NSTR, (hd - hu) * NSTR, 1.0));
          gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
        #elif MODE == 2
          float px = 6.0 / RES; vec3 t3, t4; float t1, t2, s = 0., hh;
          for (int k = 0; k < 6; k++) {
            float ang = float(k) * 1.0472;
            surf(vUv + vec2(cos(ang), sin(ang)) * px, t3, hh, t1, t2, t4);
            s += hh;
          }
          float ao = clamp(1.0 - max(0.0, s / 6.0 - h) * AOSTR, 0.15, 1.0);
          gl_FragColor = vec4(ao, clamp(r, 0.04, 1.0), clamp(m, 0.0, 1.0), 1.0);
        #else
          gl_FragColor = vec4(e / 6.0, 1.0);
        #endif
        }`,
      });
      const rt = this._rt(size);
      this.quad.material = mat;
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.scene, this.cam);
      mat.dispose();
      const buf = new Uint8Array(size * size * 4);
      this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
      rt.dispose();
      const tex = new THREE.DataTexture(buf, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true; tex.anisotropy = 8; tex.flipY = false;
      tex.needsUpdate = true;
      if (mode === 0) { tex.colorSpace = THREE.LinearSRGBColorSpace; out.map = tex; }
      if (mode === 1) out.normalMap = tex;
      if (mode === 2) out.orm = tex;
      if (mode === 3) out.emissiveMap = tex;
    }
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.toneMapping = prevTM;
    this.renderer.xr.enabled = prevXR;
    this.cache[name] = out;
    return out;
  }
}

// Build a PBR material from a baked set. `repeat` scales the texture.
export function pbr(set, o = {}) {
  const P = o.physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const clone = (t) => {
    if (!t) return null;
    if (!o.repeat) return t;
    const c = t.clone();
    c.repeat.set(o.repeat[0], o.repeat[1] ?? o.repeat[0]);
    c.needsUpdate = true;
    return c;
  };
  const params = {
    map: clone(set.map), normalMap: clone(set.normalMap),
    roughnessMap: clone(set.orm), metalnessMap: clone(set.orm), aoMap: clone(set.orm),
    roughness: o.roughness ?? 1, metalness: o.metalness ?? 1,
    color: o.color ?? 0xffffff,
    normalScale: new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1),
    aoMapIntensity: o.ao ?? 1,
    envMapIntensity: o.env ?? 1,
  };
  if (set.emissiveMap) { params.emissiveMap = clone(set.emissiveMap); params.emissive = new THREE.Color(o.emissive ?? 0xffffff); params.emissiveIntensity = o.emissiveIntensity ?? 6; }
  for (const k of ['side', 'transparent', 'opacity', 'clearcoat', 'clearcoatRoughness', 'sheen', 'sheenRoughness', 'sheenColor', 'flatShading', 'alphaTest', 'depthWrite']) if (o[k] !== undefined) params[k] = o[k];
  return new P(params);
}
