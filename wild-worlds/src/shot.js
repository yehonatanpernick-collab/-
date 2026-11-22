const {chromium}=require('/opt/node-tools/node_modules/playwright');const fs=require('fs'),path=require('path');
(async()=>{const root=path.resolve(__dirname,'..');const names=process.argv.slice(2);
const html='<html dir=rtl><head><link rel=stylesheet href="style.css"></head><body style="background:#fff;width:690px">'+names.map(n=>'<div class="fig" style="margin:6px 0">'+fs.readFileSync(path.join(root,'assets','svg_'+n+'.svg'),'utf8').replace(/class="map"/,"class=\"map\"")+'</div>').join('')+'</body></html>';
fs.writeFileSync(path.join(__dirname,'_shot.html'),html);
const b=await chromium.launch();const p=await b.newPage({viewport:{width:700,height:800},deviceScaleFactor:1.6});await p.goto('file://'+path.join(__dirname,'_shot.html'));await p.waitForTimeout(400);
await p.screenshot({path:path.join(root,'out','shot.png'),fullPage:true});await b.close();})();
