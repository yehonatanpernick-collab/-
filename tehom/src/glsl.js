// Shared GLSL chunks. Simplex noise after Ashima Arts / Stefan Gustavson (MIT).
export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){float a=0.5,s=0.0;for(int i=0;i<6;i++){s+=a*snoise(p);p=p*2.02+vec3(1.7,9.2,3.1);a*=0.5;}return s;}
float fbm3(vec3 p){float a=0.5,s=0.0;for(int i=0;i<3;i++){s+=a*snoise(p);p=p*2.03+vec3(4.1,1.3,7.7);a*=0.5;}return s;}
float ridged(vec3 p){float a=0.5,s=0.0;for(int i=0;i<5;i++){float n=1.0-abs(snoise(p));s+=a*n*n;p=p*2.1+vec3(3.3,1.1,5.5);a*=0.5;}return s;}
float hash13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
`;

// ---------------------------------------------------------------- planet surface
export const PLANET_VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
void main(){
  vObj = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position,1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const PLANET_FRAG = /* glsl */ `
uniform int uType; uniform float uSeed; uniform float uTime; uniform mat3 uRot;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec3 uD;
uniform vec3 uAtmo; uniform vec3 uCity; uniform float uCityAmt; uniform float uSea; uniform float uCloud; uniform float uBump;
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
${NOISE}
float terrain(vec3 p){
  vec3 sp = p + vec3(uSeed);
  if (uType == 0) return fbm(sp*1.8) + 0.25*ridged(sp*3.0) - 0.12;
  if (uType == 1) return fbm(sp*1.5) + 0.35*ridged(sp*2.4);
  if (uType == 2) return fbm(sp*2.0) - 0.3*smoothstep(0.82, 0.98, ridged(sp*3.5));
  if (uType == 3) return fbm(sp*2.2) - 0.5*smoothstep(0.72, 0.95, ridged(sp*2.8));
  return 0.0;
}
void main(){
  vec3 p = normalize(vObj);
  vec3 N = normalize(vN);
  vec3 L = normalize(-vW);
  vec3 V = normalize(cameraPosition - vW);
  vec3 sp = p + vec3(uSeed);
  vec3 base; float spec = 0.0; float land = 1.0; float emissive = 0.0; vec3 emiss = vec3(0.0);
  float lat = abs(p.y);
  float h = terrain(p);

  if (uType == 0) {
    land = smoothstep(uSea, uSea+0.02, h);
    vec3 ocean = mix(uA*0.55, uA, smoothstep(uSea-0.35, uSea, h));
    float hh = smoothstep(uSea, uSea+0.55, h);
    vec3 ground = mix(uB, uC, hh);
    ground = mix(ground, uD, smoothstep(0.35, 0.6, h + 0.08*snoise(sp*12.0)));
    base = mix(ocean, ground, land);
    float cap = smoothstep(0.78, 0.86, lat + 0.06*fbm3(sp*4.0));
    base = mix(base, vec3(0.85,0.88,0.9), cap);
    spec = (1.0-land)*(1.0-cap);
  } else if (uType == 1) {
    float dunes = 0.5+0.5*sin((p.y*24.0 + fbm3(sp*3.0)*6.0));
    base = mix(uA, uB, smoothstep(-0.4,0.5,h));
    base = mix(base, uC, smoothstep(0.35,0.9, h)*0.8);
    base *= 0.86 + 0.14*dunes;
    base = mix(base, uD, smoothstep(0.65,0.85, h));
  } else if (uType == 2) {
    float cracks = smoothstep(0.82, 0.98, ridged(sp*3.5));
    base = mix(uA, uB, smoothstep(-0.5,0.5,h));
    base = mix(base, uC, cracks*0.9);
    base = mix(base, uD, smoothstep(0.4,0.8, fbm3(sp*6.0))*0.35);
    spec = 0.25;
  } else if (uType == 3) {
    float r = ridged(sp*2.8 + vec3(0.0, uTime*0.004, 0.0));
    float lava = smoothstep(0.72, 0.95, r);
    base = mix(uA, uB, smoothstep(-0.4,0.6,h));
    emissive = lava;
    emiss = mix(uC, uD, lava) * (2.2 + 1.2*snoise(sp*8.0 + uTime*0.05));
  } else {
    float w = fbm(vec3(p.x*2.0, p.y*1.2, p.z*2.0) + vec3(uSeed) + vec3(uTime*0.002,0.0,0.0));
    float b = p.y*7.0 + w*1.6;
    float bands = 0.5+0.5*sin(b*3.1);
    float fine = 0.5+0.5*sin(b*11.0 + w*4.0);
    base = mix(uA, uB, bands);
    base = mix(base, uC, fine*0.35);
    vec3 sc = normalize(vec3(0.6,-0.25,0.75));
    float storm = smoothstep(0.26, 0.05, distance(p, sc) + 0.04*snoise(p*20.0));
    base = mix(base, uD, storm*0.85);
    base *= 0.92 + 0.08*snoise(p*30.0);
    land = 0.0; spec = 0.0;
  }

#ifdef BUMP
  if (uType < 4 && uBump > 0.0) {
    // relief: perturb the normal with the terrain gradient (land only on wet worlds)
    vec3 t1 = normalize(cross(p, abs(p.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));
    vec3 t2 = cross(p, t1);
    float e = 0.01;
    float h1 = terrain(normalize(p + t1*e));
    float h2 = terrain(normalize(p + t2*e));
    float k = uBump * (uType == 0 ? land : 1.0);
    vec3 nObj = normalize(p - (t1*(h1-h) + t2*(h2-h)) * k / e * 0.06);
    N = normalize(uRot * nObj);
  }
#endif

  float NdL = dot(N,L);
  float cloud = 0.0;
  if (uCloud > 0.0) {
    vec3 cp = p*2.4 + vec3(uSeed*1.3) + vec3(uTime*0.006, 0.0, uTime*0.003);
    float c = fbm(cp + 0.5*vec3(fbm3(cp*1.5)));
    cloud = smoothstep(0.05, 0.55, c) * uCloud;
    // cloud shadow on the ground
    base *= 1.0 - 0.35*smoothstep(0.05, 0.55, fbm3(cp + vec3(0.03))) * uCloud;
  }

  float NdLg = dot(normalize(vN), L);   // geometric terminator, so relief does not light the night side
  float diff = smoothstep(-0.12, 0.9, NdL) * smoothstep(-0.2, 0.05, NdLg);
  float wrap = clamp((NdLg + 0.25)/1.25, 0.0, 1.0);
  vec3 H = normalize(L+V);
  float sp1 = pow(max(dot(N,H),0.0), 60.0) * spec * step(0.0,NdL);
  // sunlight reddens as it grazes the terminator
  vec3 sun = mix(vec3(1.0,0.42,0.18), vec3(1.0,0.95,0.86), smoothstep(-0.05, 0.4, NdLg)) * 1.6;
  vec3 col = base * sun * diff + sp1 * vec3(1.0,0.86,0.68) * 1.6;
  col = mix(col, vec3(0.95)*sun*wrap, cloud);
  col += base * 0.016;

  float night = smoothstep(0.08, -0.25, NdLg);
  float cells = hash13(floor(p*60.0 + uSeed*7.0));
  float clusters = smoothstep(0.1, 0.6, snoise(sp*5.0));
  float city = step(0.7, cells) * clusters * land * (1.0-cloud*0.8);
  col += uCity * city * night * uCityAmt * 2.4;
  col += emiss * emissive * (0.35 + 0.65*(1.0-diff*0.5));

  float fres = pow(1.0 - max(dot(normalize(vN),V),0.0), 3.0);
  vec3 rimCol = mix(vec3(1.0,0.45,0.2)*length(uAtmo), uAtmo, smoothstep(-0.1, 0.45, NdLg));
  col += rimCol * fres * smoothstep(-0.35, 0.6, NdLg) * 1.3;
  gl_FragColor = vec4(col, 1.0);
}`;

export const ATMO_FRAG = /* glsl */ `
uniform vec3 uAtmo; uniform float uPow;
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  vec3 L = normalize(-vW);
  float rim = 1.0 - abs(dot(N, V));
  float a = pow(rim, uPow);
  float lit = smoothstep(-0.45, 0.55, dot(N, L));
  // forward scattering when backlit
  float fwd = pow(max(dot(-V, L), 0.0), 6.0) * 0.8;
  float k = a * (lit + fwd) * smoothstep(1.0, 0.82, rim);
  float dusk = smoothstep(0.35, -0.05, dot(N, L)) * smoothstep(-0.45, -0.1, dot(N, L));
  vec3 c = mix(uAtmo, vec3(1.0,0.48,0.22)*length(uAtmo)*0.9, dusk*0.75);
  gl_FragColor = vec4(c * k * 1.6, k);
}`;

// ---------------------------------------------------------------- rings
export const RING_VERT = /* glsl */ `
varying vec3 vW; varying vec2 vUv2; varying vec3 vL;
void main(){ vUv2 = position.xy; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
export const RING_FRAG = /* glsl */ `
uniform float uIn; uniform float uOut; uniform vec3 uCol; uniform vec3 uPlanet; uniform float uPR;
varying vec3 vW; varying vec2 vUv2;
${NOISE}
void main(){
  float r = length(vUv2);
  float t = (r-uIn)/(uOut-uIn);
  float bands = 0.55 + 0.45*sin(t*90.0 + snoise(vec3(t*12.0,0.0,0.0))*3.0);
  bands *= smoothstep(0.0,0.06,t)*smoothstep(1.0,0.9,t);
  bands *= 1.0 - 0.85*smoothstep(0.58,0.6,t)*smoothstep(0.66,0.64,t);   // a gap
  // planet shadow: is the segment from this point to the star blocked by the planet?
  vec3 toStar = normalize(-vW);
  vec3 oc = vW - uPlanet;
  float b = dot(oc, toStar);
  float c = dot(oc,oc) - uPR*uPR;
  float h = b*b - c;
  float shadow = (h > 0.0 && -b > 0.0) ? 0.12 : 1.0;
  vec3 col = uCol * (0.4 + 0.9*bands) * shadow;
  gl_FragColor = vec4(col*1.1, bands*0.75);
}`;

// ---------------------------------------------------------------- star
export const STAR_FRAG = /* glsl */ `
uniform float uTime; uniform float uGain;
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
${NOISE}
void main(){
  vec3 p = normalize(vObj);
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float mu = max(dot(N,V),0.0);
  float g = fbm(p*4.0 + vec3(0.0, uTime*0.03, uTime*0.02));
  float cells = 1.0 - abs(snoise(p*22.0 + uTime*0.08));
  float spots = smoothstep(0.55, 0.75, fbm3(p*2.0 + 11.0)) ;
  vec3 hot = vec3(1.0, 0.86, 0.62);
  vec3 warm = vec3(1.0, 0.52, 0.18);
  vec3 col = mix(warm, hot, 0.5 + 0.5*g) * (0.8 + 0.35*cells);
  col *= 1.0 - spots*0.55;
  float limb = pow(mu, 0.45);
  col *= mix(0.35, 1.0, limb);
  col = mix(vec3(1.0,0.32,0.08)*1.2, col, limb);
  gl_FragColor = vec4(col * uGain, 1.0);
}`;

export const CORONA_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv*2.0-1.0; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
export const CORONA_FRAG = /* glsl */ `
uniform float uTime; uniform float uR; uniform float uGain;
varying vec2 vUv;
${NOISE}
void main(){
  float d = length(vUv);
  float ang = atan(vUv.y, vUv.x);
  float r = d / uR;                    // 1.0 == photosphere edge
  if (r < 0.98) discard;
  float n = fbm3(vec3(cos(ang)*2.2, sin(ang)*2.2, uTime*0.05 - r*0.6));
  float streak = pow(max(0.0, 0.5 + 0.5*n), 3.0);
  float glow = 0.75 / pow(r, 3.2);
  float halo = 0.035 / pow(r, 1.7);
  float k = (glow * (0.6 + 1.4*streak) + halo) * smoothstep(1.0, 0.55, d);
  vec3 col = mix(vec3(1.0,0.38,0.12), vec3(1.0,0.82,0.6), clamp(glow,0.0,1.0));
  gl_FragColor = vec4(col * k * uGain, k * uGain);
}`;

// ---------------------------------------------------------------- sky (rendered once into a cubemap)
export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
export const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
${NOISE}
void main(){
  vec3 d = normalize(vDir);
  // a tilted galactic plane
  vec3 gN = normalize(vec3(0.25, 1.0, 0.35));
  float gl = dot(d, gN);
  float band = exp(-gl*gl*9.0);
  float core = exp(-pow(distance(d, normalize(vec3(-0.75,-0.05,0.65))),2.0)*3.0);
  vec3 q = d*1.6;
  vec3 w = vec3(fbm3(q+1.0), fbm3(q+5.2), fbm3(q+9.7));
  float dust = fbm(q*1.4 + w*1.5);
  float lanes = smoothstep(0.0, 0.5, fbm(q*3.2 + w*2.0 + 4.0));
  float clouds = smoothstep(-0.25, 0.75, dust);
  vec3 cold = vec3(0.020, 0.032, 0.046);
  vec3 rust = vec3(0.105, 0.055, 0.032);
  vec3 sand = vec3(0.16, 0.13, 0.10);
  vec3 col = vec3(0.0035,0.004,0.0055);
  col += cold * clouds * (0.35 + 0.9*band);
  col += rust * smoothstep(0.2,0.9,dust) * band * 1.3;
  col += sand * band * core * (1.0-lanes*0.85) * 0.9;
  col *= 1.0 - lanes*band*0.7;
  // faint unresolved stars in the band
  float grain = pow(hash13(floor(d*900.0)), 40.0);
  col += vec3(0.6,0.55,0.5) * grain * band * 0.5;
  gl_FragColor = vec4(col, 1.0);
}`;

export const STARS_VERT = /* glsl */ `
attribute float aSize; attribute vec3 aColor; attribute float aPhase;
uniform float uTime; uniform float uPR;
varying vec3 vColor;
void main(){
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  gl_Position = projectionMatrix*mv;
  float tw = 0.75 + 0.25*sin(uTime*(0.6+aPhase*2.0) + aPhase*40.0);
  gl_PointSize = aSize * uPR;
  vColor = aColor * tw;
}`;
export const STARS_FRAG = /* glsl */ `
varying vec3 vColor;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0;
  float d = dot(c,c);
  float a = exp(-d*5.0) + 0.25*exp(-abs(c.x)*24.0)*exp(-abs(c.y)*2.0)*step(0.9, length(vColor));
  gl_FragColor = vec4(vColor*a, 1.0);
}`;

// ---------------------------------------------------------------- particles
export const PART_VERT = /* glsl */ `
attribute vec3 aVel; attribute vec4 aData; attribute vec4 aColor;
uniform float uTime; uniform float uScale;
varying vec3 vColor; varying float vT; varying float vKind; varying float vFade;
void main(){
  float age = uTime - aData.x;
  float t = age / aData.y;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; return; }
  float k = aData.w;
  float f = k > 0.0 ? (1.0 - exp(-k*age))/k : age;
  vec3 p = position + aVel * f;
  vec4 mv = modelViewMatrix*vec4(p,1.0);
  gl_Position = projectionMatrix*mv;
  float kind = aColor.w;
  float grow = kind > 1.5 ? (0.5 + t*1.5) : (kind > 0.5 ? (0.6 + t*2.2) : (1.0 - t*0.7));
  float sz = aData.z * grow * uScale / max(-mv.z, 0.1);
  vFade = clamp(sz/1.6, 0.0, 1.0);
  gl_PointSize = clamp(sz, 1.6, 512.0);
  vColor = aColor.rgb; vT = t; vKind = kind;
}`;
export const PART_FRAG = /* glsl */ `
varying vec3 vColor; varying float vT; varying float vKind; varying float vFade;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0;
  float d = dot(c,c);
  if (d > 1.0) discard;
  float a;
  if (vKind > 1.5)      a = exp(-d*3.5) * pow(1.0-vT, 2.5);          // flash
  else if (vKind > 0.5) a = exp(-d*2.0) * (1.0-vT) * 0.35;           // smoke / dust
  else                  a = exp(-d*5.0) * (1.0-vT);                  // spark / trail
  gl_FragColor = vec4(vColor * a * vFade, 1.0);
}`;

// ---------------------------------------------------------------- shockwave
export const SHOCK_FRAG = /* glsl */ `
uniform float uT; uniform vec3 uCol;
varying vec2 vUv;
void main(){
  float d = length(vUv);
  float edge = smoothstep(0.75, 0.97, d) * smoothstep(1.0, 0.97, d);
  float inner = smoothstep(0.0, 0.95, d) * 0.15;
  float a = (edge + inner) * pow(1.0-uT, 1.6);
  gl_FragColor = vec4(uCol * a, a);
}`;

// ---------------------------------------------------------------- orbit line
export const ORBIT_VERT = /* glsl */ `
attribute float aT; varying float vT; varying vec3 vW;
void main(){ vT = aT; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
export const ORBIT_FRAG = /* glsl */ `
uniform vec3 uCol; uniform float uOp; uniform float uPhase;
varying float vT; varying vec3 vW;
void main(){
  float dash = step(0.5, fract(vT*180.0));
  // brighten near the body, fade behind it
  float dphi = fract(vT - uPhase + 1.0);
  float trail = mix(0.25, 1.0, pow(1.0 - dphi, 3.0));
  float camd = length(cameraPosition - vW);
  float a = uOp * mix(0.5, 1.0, dash) * trail * clamp(camd/300.0, 0.25, 1.0);
  gl_FragColor = vec4(uCol*a, a);
}`;

// ---------------------------------------------------------------- tactical icons
export const ICON_VERT = /* glsl */ `
attribute vec3 aColor; attribute vec2 aInfo; // class, selected
uniform float uPR; uniform float uFar;
varying vec3 vColor; varying vec2 vInfo; varying float vA; varying float vFar;
void main(){
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  gl_Position = projectionMatrix*mv;
  float d = -mv.z;
  float far = smoothstep(uFar*0.35, uFar, d);
  vFar = far;
  vA = max(far, aInfo.y*0.9);
  float s = aInfo.x < 0.5 ? 7.0 : (aInfo.x < 1.5 ? 10.0 : 15.0);
  gl_PointSize = (s + aInfo.y*8.0) * uPR;
  vColor = aColor; vInfo = aInfo;
}`;
export const ICON_FRAG = /* glsl */ `
varying vec3 vColor; varying vec2 vInfo; varying float vA; varying float vFar;
void main(){
  if (vA < 0.01) discard;
  vec2 c = gl_PointCoord*2.0-1.0; c.y = -c.y;
  float sel = vInfo.y;
  float scale = sel > 0.5 ? 1.55 : 1.0;
  vec2 q = c*scale;
  float shape;
  if (vInfo.x < 0.5) {          // corvette: solid wedge
    shape = step(-0.55, q.y) * step(abs(q.x), (0.7 - q.y)*0.5);
  } else if (vInfo.x < 1.5) {   // frigate: diamond outline
    float m = abs(q.x)+abs(q.y);
    shape = step(m, 0.8) * step(0.42, m) + step(m, 0.18);
  } else {                      // dreadnought: square with bar
    vec2 a = abs(q);
    float m = max(a.x, a.y);
    shape = step(m, 0.7)*step(0.45, m) + step(m,0.22);
  }
  float ring = 0.0;
  if (sel > 0.5) {
    vec2 a = abs(c);
    // corner brackets
    float br = step(0.82, max(a.x,a.y)) * step(max(a.x,a.y), 0.98) * step(0.55, min(a.x,a.y));
    ring = br;
  }
  float a = max(shape * vFar, ring * 0.9);
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor * (1.2 + sel*0.8), a);
}`;

// ---------------------------------------------------------------- final grade
export const GRADE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uFlash; uniform vec3 uSun;
varying vec2 vUv;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  float r2 = dot(cc,cc);
  // lateral chromatic aberration, stronger toward the frame edge
  vec2 off = cc * r2 * 0.012;
  vec3 col;
  col.r = texture2D(tDiffuse, uv - off).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv + off).b;
  // split tone: cool shadows, warm highlights
  float l = dot(col, vec3(0.299,0.587,0.114));
  col = mix(col, col*vec3(0.92,1.0,1.08), smoothstep(0.35,0.0,l)*0.35);
  col = mix(col, col*vec3(1.05,1.0,0.94), smoothstep(0.5,1.0,l)*0.25);
  col += vec3(0.010,0.012,0.016) * (1.0 - l);
  // vignette
  float vig = smoothstep(0.95, 0.25, r2*1.9);
  col *= mix(0.62, 1.0, vig);
  col += uFlash * vec3(1.0,0.85,0.7) * 0.25;
  vec2 sd = uv - uSun.xy; sd.x *= uRes.x / uRes.y;
  float streak = exp(-abs(sd.y)*420.0) * exp(-abs(sd.x)*1.6) + exp(-abs(sd.y)*90.0) * exp(-abs(sd.x)*4.0) * 0.3;
  col += vec3(1.0,0.66,0.4) * streak * uSun.z * 0.45;
  // grain
  float g = h12(uv*uRes + fract(uTime*7.31)*917.0) - 0.5;
  col += g * 0.035 * (1.0 - l*0.6);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- fireball billboard
export const FIRE_FRAG = /* glsl */ `
uniform float uT; uniform float uSeed;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 p = vUv;
  float d = length(p);
  if (d > 1.0) discard;
  float n = fbm3(vec3(p*1.9, uSeed + uT*1.3));
  float n2 = snoise(vec3(p*5.0, uSeed*2.0 - uT*2.5));
  float r = d + n*0.38 + n2*0.07;
  float body = smoothstep(0.92, 0.35, r);
  float heat = clamp(1.05 - r*1.25 - uT*1.05 + n*0.35, 0.0, 1.0);
  vec3 smoke = vec3(0.07,0.06,0.055);
  vec3 col = mix(smoke, vec3(1.0,0.32,0.06)*2.2, smoothstep(0.02,0.35,heat));
  col = mix(col, vec3(1.0,0.78,0.42)*4.0, smoothstep(0.45,0.85,heat));
  col = mix(col, vec3(1.0,0.95,0.85)*7.0, smoothstep(0.85,1.0,heat));
  float fade = 1.0 - smoothstep(0.55, 1.0, uT);
  float a = body * fade;
  float cover = a * mix(0.75, 0.25, smoothstep(0.0,0.4,heat));   // smoke occludes, fire adds
  gl_FragColor = vec4(col * a, cover);
}`;

// ---------------------------------------------------------------- shield bubble
export const SHIELD_VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vNv; varying vec3 vVv;
void main(){
  vObj = normalize(position);
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  vNv = normalize(normalMatrix*normal);
  vVv = normalize(-mv.xyz);
  gl_Position = projectionMatrix*mv;
}`;
export const SHIELD_FRAG = /* glsl */ `
uniform float uT; uniform vec3 uCol; uniform vec3 uHit;
varying vec3 vObj; varying vec3 vNv; varying vec3 vVv;
void main(){
  float fres = pow(1.0 - abs(dot(vNv, vVv)), 2.2);
  vec3 p = vObj * 9.0;
  vec3 a = vec3(1.0,0.0,0.0), b = vec3(-0.5,0.0,0.866), c = vec3(-0.5,0.0,-0.866);
  float g = max(max(abs(sin(dot(p.xz,a.xz)*3.14159 + p.y)), abs(sin(dot(p.xz,b.xz)*3.14159 + p.y))), abs(sin(dot(p.xz,c.xz)*3.14159 + p.y)));
  float lines = smoothstep(0.9, 1.0, g);
  float dh = distance(vObj, uHit);
  float hit = exp(-dh*3.5);
  float wave = smoothstep(0.12, 0.0, abs(dh - uT*2.2)) * (1.0 - uT);
  float k = (fres*hit*0.25 + lines*hit*0.55 + wave*0.5 + hit*hit*0.3) * pow(1.0 - uT, 2.0);
  gl_FragColor = vec4(uCol * k, k);
}`;
