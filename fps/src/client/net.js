// Transports: LocalNet runs the authoritative Sim in-page (offline / practice);
// WSNet talks JSON over WebSocket to the dedicated Node server.
import { TICK_DT } from '../shared/config.js';

export class LocalNet {
  constructor(sim) {
    this.sim = sim;
    this.onMessage = null;
    this.cid = sim.addClient((m) => this.onMessage && this.onMessage(m));
    this.acc = 0;
    this.local = true;
  }
  send(m) { this.sim.handle(this.cid, m); }
  tick(dt) {
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= TICK_DT && n < 5) { this.sim.tick(TICK_DT); this.acc -= TICK_DT; n++; }
  }
  close() { this.sim.removeClient(this.cid); }
}

export class WSNet {
  constructor(url) { this.url = url; this.onMessage = null; this.local = false; this.ws = null; this.onClose = null; }
  connect(timeoutMs = 6000) {
    return new Promise((res, rej) => {
      let done = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const to = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch (e) { /* ignore */ } rej(new Error('timeout')); } }, timeoutMs);
      ws.onopen = () => { if (done) return; done = true; clearTimeout(to); res(this); };
      ws.onerror = () => { if (!done) { done = true; clearTimeout(to); rej(new Error('connection failed')); } };
      ws.onclose = () => { if (this.onClose) this.onClose(); };
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (this.onMessage) this.onMessage(m); };
    });
  }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  tick() { }
  close() { if (this.ws) { this.onClose = null; this.ws.close(); } }
}
