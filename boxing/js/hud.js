const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = $('hud');
    this.trail = [1, 1]; this.trailDelay = [0, 0]; this.lastHp = [1, 1];
    this.coTimer = null;
  }
  show(v) { this.el.classList.toggle('show', v); document.getElementById('touch').classList.toggle('show', v); document.body.classList.toggle('playing', v); }
  setNames(a, b) {
    $('n1').textContent = a.name; $('r1').textContent = `${a.flag} · ${a.record}`;
    $('n2').textContent = b.name; $('r2').textContent = `${b.flag} · ${b.record}`;
    this.trail = [1, 1]; this.lastHp = [1, 1];
  }
  update(dt, f1, f2, round, time) {
    [f1, f2].forEach((f, i) => {
      const n = i + 1, hp = Math.max(0, f.health / 100);
      $('h' + n).style.transform = `scaleX(${hp})`;
      if (hp < this.lastHp[i]) this.trailDelay[i] = 0.55;
      this.lastHp[i] = hp;
      if (this.trailDelay[i] > 0) this.trailDelay[i] -= dt; else this.trail[i] = Math.max(hp, this.trail[i] - dt * 0.35);
      if (this.trail[i] < hp) this.trail[i] = hp;
      $('t' + n).style.transform = `scaleX(${this.trail[i]})`;
      $('h' + n).parentElement.classList.toggle('low', hp < 0.25);
      $('s' + n).style.transform = `scaleX(${Math.max(0, f.stamina / 100)})`;
      $('s' + n).parentElement.classList.toggle('tired', f.stamina < 30);
      const kd = $('k' + n); if (kd.childElementCount !== f.knockdowns) kd.innerHTML = '<i></i>'.repeat(f.knockdowns);
    });
    $('rd').textContent = round;
    const t = Math.max(0, Math.ceil(time));
    const tm = $('tm'); tm.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    tm.classList.toggle('warn', t <= 10);
  }
  pop(side, html, cls = '') {
    const box = $(side === 0 ? 'pop1' : 'pop2');
    const d = document.createElement('div'); d.className = 'pop ' + cls; d.innerHTML = html;
    box.appendChild(d); while (box.childElementCount > 4) box.firstChild.remove();
    setTimeout(() => d.remove(), 1300);
  }
  callout(text, cls = '', sub = '', dur = 1.2, slab = false) {
    const c = $('callout');
    clearTimeout(this.coTimer); clearTimeout(this.coTimer2);
    c.innerHTML = `<div class="co ${cls}">${slab ? '<div class="slab"></div>' : ''}${text}${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
    if (dur > 0) {
      this.coTimer = setTimeout(() => { const e = c.firstChild; if (e) e.classList.add('out'); }, dur * 1000);
      this.coTimer2 = setTimeout(() => { c.innerHTML = ''; }, dur * 1000 + 400);
    }
  }
  clearCallout() { $('callout').innerHTML = ''; }
  count(n, showGetup, fill) {
    const c = $('count');
    if (n === null) { c.classList.remove('show'); return; }
    c.classList.add('show');
    const b = $('countN');
    if (b.textContent !== String(n)) { b.textContent = n; b.classList.remove('tick'); void b.offsetWidth; b.classList.add('tick'); }
    $('getup').classList.toggle('show', !!showGetup);
    $('getupFill').style.width = `${Math.min(100, (fill || 0) * 100)}%`;
  }
  hint(v) { $('hudHint').classList.toggle('hide', !v); }
}
