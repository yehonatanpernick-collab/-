// Building facade material: photo wall texture at real scale + procedural window grid evaluated per cell in the shader.
import * as THREE from 'three';

export const FACADE_STYLES = {
  brick:   { wall: 'brick', tile: 3.0, colW: 3.0, floorH: 3.2, winW: 1.25, winH: 1.85, sill: 0.95, frame: 0.09, frameColor: 0xe9e3d6, glass: 0x1b2630, shutters: 0, curtain: 0.45 },
  brick2:  { wall: 'brick2', tile: 3.4, colW: 3.4, floorH: 3.5, winW: 1.4, winH: 2.1, sill: 0.9, frame: 0.1, frameColor: 0x2f3b33, glass: 0x18222a, shutters: 0, curtain: 0.5 },
  plaster: { wall: 'plaster', tile: 4.0, colW: 3.2, floorH: 3.2, winW: 1.15, winH: 1.65, sill: 1.0, frame: 0.07, frameColor: 0xf3efe6, glass: 0x1d2933, shutters: 1, curtain: 0.55 },
  plaster2:{ wall: 'plaster2', tile: 4.0, colW: 3.0, floorH: 3.1, winW: 1.1, winH: 1.55, sill: 1.0, frame: 0.07, frameColor: 0xd9d2c4, glass: 0x1b252e, shutters: 0.6, curtain: 0.5 },
  conc:    { wall: 'conc', tile: 4.0, colW: 1.6, floorH: 3.8, winW: 1.48, winH: 1.9, sill: 0.95, frame: 0.05, frameColor: 0x3a4148, glass: 0x22313d, shutters: 0, curtain: 0.2 },
  glass:   { wall: null, wallColor: 0x2b3640, tile: 4, colW: 1.8, floorH: 3.9, winW: 1.72, winH: 3.15, sill: 0.62, frame: 0.04, frameColor: 0x8c959e, glass: 0x2d4250, shutters: 0, curtain: 0.12, curtainWall: 1 },
  dark:    { wall: null, wallColor: 0x101418, tile: 4, colW: 1.6, floorH: 3.9, winW: 1.54, winH: 3.2, sill: 0.6, frame: 0.03, frameColor: 0x30363c, glass: 0x0d141a, shutters: 0, curtain: 0.1, curtainWall: 1 },
};

const SHUTTERS = [new THREE.Color(0x2f6b4f), new THREE.Color(0x2c4f7a), new THREE.Color(0x7a4a2c), new THREE.Color(0x8a8f96), new THREE.Color(0x355e6b)];

export const facadeUniforms = { uNight: { value: 0 } };

export function makeFacadeMaterial(styleName, T) {
  const S = FACADE_STYLES[styleName];
  const wall = S.wall ? T[S.wall] : null;
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0,
    map: wall ? wall.c : null, normalMap: wall ? wall.n : null, roughnessMap: wall ? wall.r : null,
    envMapIntensity: 1.0,
  });
  if (!wall) m.color.set(S.wallColor);
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = facadeUniforms.uNight;
    sh.uniforms.uCell = { value: new THREE.Vector2(S.colW, S.floorH) };
    sh.uniforms.uWin = { value: new THREE.Vector4(S.winW, S.winH, S.sill, S.frame) };
    sh.uniforms.uTile = { value: S.tile };
    sh.uniforms.uFrame = { value: new THREE.Color(S.frameColor) };
    sh.uniforms.uGlass = { value: new THREE.Color(S.glass) };
    sh.uniforms.uMisc = { value: new THREE.Vector4(S.shutters, S.curtain, S.curtainWall ? 1 : 0, 0) };
    sh.uniforms.uShut = { value: SHUTTERS };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFac; varying vec3 vFac; varying vec2 vWallUV;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = aFac; vWallUV = uv;');
    // use world-meter uv for the photo map: scale by tile size
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight, uTile; uniform vec2 uCell; uniform vec4 uWin; uniform vec3 uFrame, uGlass; uniform vec4 uMisc; uniform vec3 uShut[5];
        varying vec3 vFac; varying vec2 vWallUV;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float fLod = 0.0, fWin = 0.0, fFrame = 0.0, fShut = 0.0, fSill = 0.0, fCurt = 0.0, fLit = 0.0, fEdge = 0.0; vec3 cLit = vec3(0.0); vec3 cShut = vec3(0.0);
      `)
      .replace('#include <map_fragment>', `
        // vFac.x = local x offset (meters), vFac.y = building seed, vFac.z = window band start height
        vec2 wm = vWallUV;                 // meters along wall / height above ground
        vec2 q = vec2(wm.x, wm.y - vFac.z);
        vec2 cid = floor(q / uCell); vec2 cu = q - cid * uCell; // position inside the cell (meters)
        float seed = floor(vFac.y + 0.5);
        float hs = h21(cid + seed * 17.0), hs2 = h21(cid.yx * 1.7 + seed * 5.3), hb = h21(vec2(seed * 31.0, 7.0));
        float x0 = (uCell.x - uWin.x) * 0.5, x1 = x0 + uWin.x, y0 = uWin.z, y1 = y0 + uWin.y, fr = uWin.w;
        bool rowOK = q.y > 0.0;
        if (rowOK) {
          float inX = step(x0, cu.x) * step(cu.x, x1), inY = step(y0, cu.y) * step(cu.y, y1);
          fWin = inX * inY;
          float gx = step(x0 + fr, cu.x) * step(cu.x, x1 - fr), gy = step(y0 + fr, cu.y) * step(cu.y, y1 - fr);
          fFrame = fWin * (1.0 - gx * gy);
          // vertical mullion for wide windows
          if (uWin.x > 1.2 && uMisc.z < 0.5) fFrame = max(fFrame, fWin * step(abs(cu.x - uCell.x * 0.5), fr * 0.6));
          fSill = (1.0 - fWin) * step(x0 - 0.06, cu.x) * step(cu.x, x1 + 0.06) * step(y0 - 0.09, cu.y) * step(cu.y, y0);
          if (uMisc.x > 0.0 && hb < uMisc.x) { float sw = uWin.x * 0.42; fShut = (1.0 - fWin) * inY * (step(x0 - sw, cu.x) * step(cu.x, x0) + step(x1, cu.x) * step(cu.x, x1 + sw)); cShut = uShut[int(mod(floor(hb * 50.0), 5.0))]; }
          fEdge = fWin * (1.0 - fFrame) * (smoothstep(y1 - fr - 0.18, y1 - fr, cu.y) + smoothstep(x0 + fr + 0.12, x0 + fr, cu.x) * 0.6);
          fCurt = fWin * (1.0 - fFrame) * step(hs2, uMisc.y) * step(cu.y, mix(y1, y0, fract(hs2 * 7.0) * 0.8 + 0.2));
          float litP = mix(0.1, 0.38, uNight);
          fLit = fWin * (1.0 - fFrame) * step(hs, litP) * uNight;
          cLit = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.92, 1.0), step(0.75, fract(hs * 13.0))) * (0.6 + 0.8 * fract(hs * 37.0));
          if (uMisc.z > 0.5) fSill = 0.0;
        }
        vec4 sampledDiffuseColor = vec4(1.0);
        #ifdef USE_MAP
          sampledDiffuseColor = texture2D(map, wm / uTile);
        #endif
        vec3 wallCol = diffuseColor.rgb * sampledDiffuseColor.rgb * vColor.rgb;
        vec3 glassCol = uGlass * (0.8 + 0.4 * hs2);
        vec3 curtCol = mix(vec3(0.78, 0.72, 0.62), vec3(0.52, 0.56, 0.62), fract(hs2 * 3.0)) * 0.42;
        vec3 col = wallCol;
        col = mix(col, cShut * (0.85 + 0.15 * sampledDiffuseColor.r), fShut);
        col = mix(col, uFrame * 0.92, fSill);
        col = mix(col, glassCol, fWin);
        col = mix(col, curtCol, fCurt);
        col = mix(col, uFrame, fFrame);
        col *= 1.0 - fEdge * 0.45;
        float fwq = max(fwidth(q.x), fwidth(q.y));
        fLod = smoothstep(0.05, 0.22, fwq / uCell.y);
        float winRatio = (uWin.x * uWin.y) / (uCell.x * uCell.y);
        vec3 avg = mix(wallCol, glassCol * 1.1, winRatio);
        col = mix(col, avg, fLod);
        diffuseColor.rgb = col;
      `)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= texture2D(roughnessMap, wm / uTile).g;
        #endif
        float glassMask = fWin * (1.0 - fFrame) * (1.0 - fCurt);
        glassMask = mix(glassMask, (uWin.x * uWin.y) / (uCell.x * uCell.y) * 0.8, fLod);
        roughnessFactor = mix(roughnessFactor, 0.06, glassMask);
        roughnessFactor = mix(roughnessFactor, 0.5, fFrame + fShut);
      `)
      .replace('#include <metalnessmap_fragment>', `
        float metalnessFactor = metalness;
        metalnessFactor = mix(metalnessFactor, 0.85, glassMask);
        metalnessFactor = mix(metalnessFactor, uMisc.z > 0.5 ? 0.6 : 0.0, fFrame);
      `)
      .replace('#include <normal_fragment_maps>', `
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 mapN = texture2D(normalMap, wm / uTile).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale * (1.0 - fWin) * (1.0 - fShut);
          normal = normalize(tbn * mapN);
        #endif
      `)
      .replace('#include <emissivemap_fragment>', `
        totalEmissiveRadiance += cLit * fLit * (fCurt > 0.5 ? 0.7 : 1.1) * (1.0 - fLod * 0.5) + cLit * uNight * fLod * (uWin.x * uWin.y) / (uCell.x * uCell.y) * 0.25 * step(0.0, q.y);
      `);
  };
  m.customProgramCacheKey = () => 'facade-' + styleName;
  return m;
}
