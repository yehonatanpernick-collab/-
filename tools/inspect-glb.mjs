import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f); const r = doc.getRoot();
  console.log('==', f, 'nodes', r.listNodes().length, 'mats', r.listMaterials().map(m=>m.getName()).join('|'));
  console.log(' anims', r.listAnimations().map(a=>a.getName()+':'+a.listSamplers()[0]?.getInput()?.getMax([])?.[0]?.toFixed(2)).join(' '));
  const walk=(n,d)=>{ const m=n.getMesh(); const t=n.getTranslation(); if(d<4) console.log(' '.repeat(d*2)+n.getName()+(m?' [mesh '+m.listPrimitives().map(p=>p.getMaterial()?.getName()).join(',')+']':'')+' t='+t.map(v=>v.toFixed(2))); n.listChildren().forEach(c=>walk(c,d+1)); };
  r.listScenes()[0].listChildren().forEach(n=>walk(n,0));
}
