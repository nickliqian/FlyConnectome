// 检视器浮层：点击果蝇 → 底部显示该 fly 的嗅觉链路 + GF 状态 sparkline。
// 每帧调用 inspector.record(fly)；fly=null 时清空。

const WINDOW = 600;         // 采样点数（10s @ 60fps）

export function createInspectorDOM() {
  if (document.getElementById('inspector')) return;
  const root = document.createElement('aside');
  root.id = 'inspector';
  root.hidden = true;
  root.innerHTML = `
    <header>
      <span class="ins-title">神经元检视 · 果蝇 <b id="ins-name">#--</b></span>
      <div class="ins-tools">
        <button id="ins-next" class="quiet" title="跟随下一只">→ 下一只</button>
        <button id="ins-close" class="quiet" title="关闭">✕</button>
      </div>
    </header>
    <div class="ins-body">
      <div class="ins-col">
        <div class="ins-cap">嗅觉链路 (ORN→PN→LN→KC)</div>
        <canvas id="ins-odor" width="280" height="120"></canvas>
      </div>
      <div class="ins-col">
        <div class="ins-cap">Giant Fiber (V / θ / AHP)</div>
        <canvas id="ins-gf" width="280" height="120"></canvas>
      </div>
      <div class="ins-numbers">
        <div class="num-row"><span class="k">浓度 c</span><span class="v" id="n-c">--</span></div>
        <div class="num-row"><span class="k">r_orn</span><span class="v" id="n-orn">--</span></div>
        <div class="num-row"><span class="k">out_pn</span><span class="v" id="n-pn">--</span></div>
        <div class="num-row"><span class="k">out_ln</span><span class="v" id="n-ln">--</span></div>
        <div class="num-row"><span class="k">KC fire</span><span class="v" id="n-kc">--</span></div>
        <div class="num-row"><span class="k">GF V</span><span class="v" id="n-V">--</span></div>
        <div class="num-row"><span class="k">GF θ</span><span class="v" id="n-th">--</span></div>
        <div class="num-row"><span class="k">AHP</span><span class="v" id="n-ahp">--</span></div>
        <div class="num-row"><span class="k">上次 spike</span><span class="v" id="n-last">--</span></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);
}

export class Inspector {
  constructor() {
    createInspectorDOM();
    this.el = document.getElementById('inspector');
    this.canvasOdor = document.getElementById('ins-odor');
    this.canvasGf = document.getElementById('ins-gf');
    this.closeBtn = document.getElementById('ins-close');
    this.nextBtn = document.getElementById('ins-next');
    this.nameEl = document.getElementById('ins-name');
    this.buf = new Array(WINDOW).fill(null);
    this.head = 0;
    this.fly = null;
    this.onNext = null;

    this.closeBtn.addEventListener('click', () => this.close());
    this.nextBtn.addEventListener('click', () => this.onNext?.());
  }

  open(fly) {
    this.fly = fly;
    this.el.hidden = false;
    this.buf = new Array(WINDOW).fill(null);
    this.head = 0;
    this.nameEl.textContent = '#' + fly.index;
  }

  close() {
    this.fly = null;
    this.el.hidden = true;
  }

  isOpen() { return !!this.fly && !this.el.hidden; }

  /** 每帧调用；fly 可为 null（此时不动作）。 */
  record(fly, elapsed) {
    if (!this.fly || fly !== this.fly) return;
    this.buf[this.head] = {
      t: elapsed,
      c: fly.odor.concentration,
      orn: fly.odor.r_orn,
      pn: fly.odor.out_pn,
      ln: fly.odor.out_ln,
      kc: fly.odor.fire,
      V: fly.gf.V,
      th: fly.gf.theta,
      ahp: fly.gf.ahp,
      spike: fly.gf.spikeFlag ? 1 : 0,
      sens: fly.gf.sens,
      habit: fly.gf.habit,
    };
    this.head = (this.head + 1) % WINDOW;
    this.draw(fly, elapsed);
  }

  draw(fly, elapsed) {
    drawSpark(this.canvasOdor, this.buf, this.head, [
      { key: 'orn', color: '#c66568' },
      { key: 'pn', color: '#db8550' },
      { key: 'ln', color: '#247ea3' },
      { key: 'kc', color: '#2f7d4a', step: true },
    ], { max: 3.2 });
    drawSpark(this.canvasGf, this.buf, this.head, [
      { key: 'V', color: '#247ea3' },
      { key: 'th', color: '#c66568' },
      { key: 'ahp', color: '#7c5aa6' },
    ], { max: 2.5, spikes: true });

    const set = (id, v) => { document.getElementById(id).textContent = v; };
    set('n-c', fly.odor.concentration.toFixed(3));
    set('n-orn', fly.odor.r_orn.toFixed(2));
    set('n-pn', fly.odor.out_pn.toFixed(2));
    set('n-ln', fly.odor.out_ln.toFixed(2));
    set('n-kc', fly.odor.fire ? '1' : '0');
    set('n-V', fly.gf.V.toFixed(2));
    set('n-th', fly.gf.theta.toFixed(2));
    set('n-ahp', fly.gf.ahp.toFixed(2));
    const since = elapsed - fly.gf.lastSpikeTime;
    set('n-last', fly.gf.lastSpikeTime < 0 ? '—'
      : (since < 1 ? since.toFixed(2) + ' s' : Math.round(since) + ' s'));
  }
}

function drawSpark(canvas, buf, head, series, opts) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  // 网格
  ctx.strokeStyle = '#e6ecf1';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (h * i) / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  const max = opts.max || 1;
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.key === 'kc' || s.key === 'V' ? 1.6 : 1.2;
    ctx.beginPath();
    for (let i = 0; i < WINDOW; i++) {
      const idx = (head + i) % WINDOW;
      const sample = buf[idx];
      if (!sample) continue;
      const x = (i / (WINDOW - 1)) * w;
      let val = sample[s.key] || 0;
      if (s.step) val = val > 0.5 ? 1 : 0;
      const y = h - Math.min(1, val / max) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // spike 竖线
  if (opts.spikes) {
    ctx.strokeStyle = '#8b2a30';
    ctx.lineWidth = 1;
    for (let i = 0; i < WINDOW; i++) {
      const idx = (head + i) % WINDOW;
      const sample = buf[idx];
      if (sample && sample.spike) {
        const x = (i / (WINDOW - 1)) * w;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
    }
  }
}
