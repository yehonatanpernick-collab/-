const {chromium}=require('/opt/node-tools/node_modules/playwright');
const path=require('path'),fs=require('fs');
(async()=>{
  const root=path.resolve(__dirname,'..'); const src=path.join(root,'src','book.html');
  const out=process.argv[2]||path.join(root,'out','book.pdf');
  const b=await chromium.launch(); const pg=await b.newPage();
  await pg.goto('file://'+src); await pg.evaluate(()=>document.fonts.ready); await pg.waitForTimeout(500);
  const rep=await pg.evaluate(()=>{
    const res=[];
    document.querySelectorAll('.page').forEach(p=>{
      const cols=p.querySelector('.cols'); if(!cols){res.push({n:+p.dataset.n,skip:1});return;}
      const kids=[...cols.children];
      const measure=()=>{const cr=cols.getBoundingClientRect(); let minL=1e9,last=null,maxB=0;
        kids.forEach(k=>{const r=k.getBoundingClientRect(); if(r.left<minL)minL=r.left;});
        // last kid
        const lk=kids[kids.length-1].getBoundingClientRect();
        const over = minL < cr.left-2 || cols.scrollHeight>cols.clientHeight+2;
        return {over, free:(cr.bottom-lk.bottom)/cr.height, lkLeft:lk.left-cr.left, cr};};
      let lo=7.6, hi=10.4, best=null;
      const set=v=>p.style.setProperty('--fs',v.toFixed(2)+'pt');
      set(hi); let m=measure();
      if(!m.over){ res.push({n:+p.dataset.n,fs:hi,free:m.free,status:'UNDER'});return;}
      set(lo); m=measure();
      if(m.over){ res.push({n:+p.dataset.n,fs:lo,free:m.free,status:'OVER'});return;}
      for(let i=0;i<14;i++){const mid=(lo+hi)/2; set(mid); const mm=measure(); if(mm.over) hi=mid; else lo=mid;}
      set(lo); m=measure();
      res.push({n:+p.dataset.n,fs:+lo.toFixed(2),free:+m.free.toFixed(3),status:'ok'});
    });
    return res;});
  fs.writeFileSync(path.join(root,'out','report.json'),JSON.stringify(rep,null,1));
  const bad=rep.filter(r=>!r.skip&&(r.status!=='ok'||r.fs<8.4||r.fs>10.2));
  console.log('pages',rep.length,'| flagged:',JSON.stringify(bad));
  await pg.pdf({path:out,preferCSSPageSize:true,printBackground:true});
  await b.close();
})();
