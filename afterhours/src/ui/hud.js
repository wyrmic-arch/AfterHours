// Minimal HUD + settings UI. Vanilla DOM, no framework.

const css = `
  #ah-hud { position: fixed; inset: 0; pointer-events: none; font-family: 'Segoe UI', system-ui, sans-serif; }
  #ah-crosshair { position:absolute; left:50%; top:50%; width:6px; height:6px; margin:-3px;
    border-radius:50%; background:rgba(255,255,255,.85); box-shadow:0 0 4px rgba(0,0,0,.5); display:none; }
  #ah-compass { position:absolute; top:14px; left:50%; transform:translateX(-50%);
    color:#fff; text-shadow:0 1px 4px rgba(0,0,0,.6); font-size:13px; letter-spacing:.12em;
    background:rgba(20,28,40,.35); padding:6px 16px; border-radius:14px; backdrop-filter: blur(4px); }
  #ah-stats { position:absolute; left:14px; bottom:14px; color:#eaf3ff; font-size:12px; line-height:1.55;
    background:rgba(20,28,40,.45); padding:8px 12px; border-radius:10px; white-space:pre; }
  #ah-hint { position:absolute; left:50%; bottom:18px; transform:translateX(-50%);
    color:#fff; font-size:13px; text-shadow:0 1px 3px rgba(0,0,0,.7);
    background:rgba(20,28,40,.5); padding:8px 18px; border-radius:16px; transition:opacity .8s; }
  #ah-settings { position:absolute; right:14px; top:14px; pointer-events:auto;
    background:rgba(16,22,32,.82); color:#dfe9f5; border-radius:12px; padding:12px 14px;
    font-size:12px; min-width:200px; display:none; backdrop-filter: blur(6px);
    border:1px solid rgba(255,255,255,.08); }
  #ah-settings.open { display:block; }
  #ah-settings h3 { margin:0 0 8px; font-size:13px; font-weight:600; color:#fff; }
  #ah-settings label { display:block; margin:7px 0 2px; color:#9fb2c8; }
  #ah-settings select, #ah-settings input[type=range] { width:100%; }
  #ah-gear { position:absolute; right:14px; top:14px; pointer-events:auto; cursor:pointer;
    background:rgba(20,28,40,.5); color:#fff; border:none; border-radius:10px;
    font-size:18px; width:38px; height:38px; }
  #ah-start { position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:linear-gradient(160deg, rgba(10,14,24,.88), rgba(20,30,52,.75)); z-index:10;
    color:#fff; flex-direction:column; gap:18px; font-family:'Segoe UI', system-ui, sans-serif; }
  #ah-start h1 { font-size:52px; letter-spacing:.35em; margin:0; font-weight:200;
    text-shadow:0 0 30px rgba(120,180,255,.35); }
  #ah-start .sub { opacity:.75; letter-spacing:.2em; font-size:13px; margin-top:-8px; }
  #ah-start button { pointer-events:auto; font-size:16px; padding:12px 44px; border-radius:30px;
    border:1px solid rgba(255,255,255,.35); background:rgba(90,140,220,.25); color:#fff;
    cursor:pointer; letter-spacing:.15em; transition:background .2s; }
  #ah-start button:hover { background:rgba(120,170,255,.4); }
  #ah-start .keys { font-size:12px; opacity:.65; line-height:1.8; text-align:center; }
  #ah-loading { position:fixed; left:0; top:0; height:3px; width:0%; background:#8ec8ff; z-index:11;
    transition:width .3s; }
`;

export function createHUD({ onQualityChange, onTimeChange }) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const loading = el('div', 'ah-loading');
  document.body.appendChild(loading);

  const start = document.createElement('div');
  start.id = 'ah-start';
  start.innerHTML = `
    <h1>AFTERHOURS</h1>
    <div class="sub">VESPERA VALE — REGION 01</div>
    <button id="ah-play">ENTER WORLD</button>
    <div class="keys">WASD move · Shift sprint · Space jump · V toggle fly camera<br>
    Mouse look (click to lock) · Esc release mouse · P settings</div>`;
  document.body.appendChild(start);

  const hud = el('div', 'ah-hud');
  hud.innerHTML = `
    <div id="ah-crosshair"></div>
    <div id="ah-compass">N</div>
    <div id="ah-stats"></div>
    <div id="ah-hint">Click to look around — WASD to walk toward the mountains</div>
    <button id="ah-gear">⚙</button>
    <div id="ah-settings">
      <h3>Graphics</h3>
      <label>Quality preset</label>
      <select id="ah-quality">
        <option value="low">Low (integrated GPU)</option>
        <option value="medium" selected>Medium</option>
        <option value="high">High</option>
      </select>
      <label>Time of day</label>
      <select id="ah-time">
        <option value="golden" selected>Golden Afternoon</option>
        <option value="noon">Bright Noon</option>
        <option value="dusk">Rose Dusk</option>
      </select>
      <label>Render distance: <span id="ah-rd-val"></span></label>
      <input id="ah-rd" type="range" min="2" max="7" step="1" value="5">
    </div>`;
  document.body.appendChild(hud);

  const gearBtn = hud.querySelector('#ah-gear');
  const panel = hud.querySelector('#ah-settings');
  gearBtn.addEventListener('click', () => panel.classList.toggle('open'));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') panel.classList.toggle('open');
  });

  hud.querySelector('#ah-quality').addEventListener('change', (e) => onQualityChange(e.target.value));
  hud.querySelector('#ah-time').addEventListener('change', (e) => onTimeChange(e.target.value));
  const rdSlider = hud.querySelector('#ah-rd');
  const rdVal = hud.querySelector('#ah-rd-val');
  rdVal.textContent = rdSlider.value + ' chunks';
  rdSlider.addEventListener('input', (e) => {
    rdVal.textContent = e.target.value + ' chunks';
    onQualityChange(null, parseInt(e.target.value, 10));
  });

  const api = {
    startButton: start.querySelector('#ah-play'),
    onStart(cb) { start.querySelector('#ah-play').addEventListener('click', cb); },
    hideStart() { start.style.display = 'none'; },
    setLoading(pct) {
      loading.style.width = pct * 100 + '%';
      if (pct >= 1) setTimeout(() => loading.remove(), 600);
    },
    setStats(text) { hud.querySelector('#ah-stats').textContent = text; },
    setCompass(yawRad) {
      const dirs = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
      const idx = Math.round(((yawRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 4)) % 8;
      hud.querySelector('#ah-compass').textContent = '▲ ' + dirs[idx];
    },
    showCrosshair(v) { hud.querySelector('#ah-crosshair').style.display = v ? 'block' : 'none'; },
    fadeHint() { const h = hud.querySelector('#ah-hint'); if (h) h.style.opacity = '0'; },
  };
  return api;
}

function el(tag, id) {
  const e = document.createElement(tag);
  e.id = id;
  return e;
}
