import { AGC, MCT_PER_SEC } from './agc.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------------------------------------------------------------- digits
// 7-segment geometry for a 30 × 46 cell, matching the DSKY's upright EL digits.
const SEG = {
  a: '5,1 25,1 22,5 8,5', b: '26,2 26,22 22,20 22,6', c: '26,24 26,44 22,40 22,26',
  d: '5,45 25,45 22,41 8,41', e: '4,24 8,26 8,40 4,44', f: '4,2 8,6 8,20 4,22',
  g: '5,23 8,21 22,21 25,23 22,25 8,25',
};
const GLYPH = {
  ' ': '', 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg',
  6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};
function digitSvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 30 46');
  svg.setAttribute('aria-hidden', 'true');
  for (const [k, pts] of Object.entries(SEG)) {
    const p = document.createElementNS(ns, 'polygon');
    p.setAttribute('points', pts); p.setAttribute('class', 'seg'); p.dataset.s = k;
    svg.appendChild(p);
  }
  return svg;
}
function signSvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 30 46'); svg.setAttribute('class', 'sign');
  svg.setAttribute('aria-hidden', 'true');
  const h = document.createElementNS(ns, 'rect');
  Object.entries({ x: 3, y: 21, width: 24, height: 4, class: 'seg', 'data-s': 'h' }).forEach(([a, v]) => h.setAttribute(a, v));
  const v = document.createElementNS(ns, 'rect');
  Object.entries({ x: 13, y: 11, width: 4, height: 24, class: 'seg', 'data-s': 'v' }).forEach(([a, v2]) => v.setAttribute(a, v2));
  svg.append(h, v);
  return svg;
}
const fields = {};
for (const el of $$('.digits')) {
  const name = el.dataset.field;
  const reg = el.classList.contains('reg');
  const cells = [];
  if (reg) { const s = signSvg(); el.appendChild(s); cells.push(s); }
  for (let i = 0; i < (reg ? 5 : 2); i++) { const d = digitSvg(); el.appendChild(d); cells.push(d); }
  fields[name] = { el, cells, reg, last: null };
}
function paintField(name, text, blank = false) {
  const f = fields[name];
  const key = blank ? '' : text;
  if (f.last === key) return;
  f.last = key;
  let chars = blank ? ' '.repeat(f.cells.length) : text;
  f.cells.forEach((svg, i) => {
    const ch = chars[i] ?? ' ';
    if (svg.classList.contains('sign')) {
      svg.querySelector('[data-s=h]').classList.toggle('on', ch === '+' || ch === '-');
      svg.querySelector('[data-s=v]').classList.toggle('on', ch === '+');
    } else {
      const on = GLYPH[ch] ?? '';
      for (const p of svg.children) p.classList.toggle('on', on.includes(p.dataset.s));
    }
  });
}

// ---------------------------------------------------------------- lamps
// Panel order as on the Block II DSKY: left column white, right column amber.
// The CM DSKY leaves the bottom four positions blank.
const LAMPS = [
  ['UPLINK_ACTY', 'UPLINK ACTY', 'white'], ['TEMP', 'TEMP', 'amber'],
  ['NO_ATT', 'NO ATT', 'white'], ['GIMBAL_LOCK', 'GIMBAL LOCK', 'amber'],
  ['STBY', 'STBY', 'white'], ['PROG', 'PROG', 'amber'],
  ['KEY_REL', 'KEY REL', 'white'], ['RESTART', 'RESTART', 'amber'],
  ['OPR_ERR', 'OPR ERR', 'white'], ['TRACKER', 'TRACKER', 'amber'],
  ['PRIO_DISP', 'PRIO DISP', 'white', 'lm'], ['ALT', 'ALT', 'amber', 'lm'],
  ['NO_DAP', 'NO DAP', 'white', 'lm'], ['VEL', 'VEL', 'amber', 'lm'],
];
const lampEls = {};
function buildLamps(isLM) {
  const box = $('#lamps'); box.innerHTML = '';
  for (const [id, label, color, only] of LAMPS) {
    const d = document.createElement('div');
    const blank = only === 'lm' && !isLM;
    d.className = `lamp ${color}${blank ? ' blank' : ''}`;
    d.innerHTML = label.replace(' ', '<br>');
    d.setAttribute('role', 'img');
    d.setAttribute('aria-label', blank ? 'unused' : `${label} lamp off`);
    box.appendChild(d);
    lampEls[id] = blank ? null : d;
  }
}

// ---------------------------------------------------------------- I/O panel
let chanDefs = null;
const chanEls = {};
const ANN = [
  { id: 'agcwarn', label: 'AGC warning', test: (s) => s.d.agcWarn },
  { id: 'isswarn', label: 'ISS warning', test: (s) => s.ch[0o11] & 1 },
  { id: 'compacty', label: 'Comp activity', test: (s) => s.d.compActy, green: true },
  { id: 'engon', label: 'Engine on', test: (s) => s.ch[0o11] & 0o10000 },
  { id: 'engoff', label: 'Engine off', test: (s) => s.ch[0o11] & 0o20000, lm: true },
  { id: 'jets', label: 'RCS jets firing', test: (s) => (s.ch[0o5] | s.ch[0o6]) & 0o377 },
  { id: 'coarse', label: 'IMU coarse align', test: (s) => s.ch[0o12] & 0o10 },
  { id: 'isson', label: 'ISS turn-on complete', test: (s) => s.ch[0o12] & 0o40000, green: true },
  { id: 'gyro', label: 'Gyro torquing', test: (s) => s.ch[0o14] & 0o1000 },
  { id: 'cdudrive', label: 'CDU drive', test: (s) => s.ch[0o14] & 0o76000 },
];

function buildIO(defs, isLM) {
  chanDefs = defs;
  const ann = $('#annunciators'); ann.innerHTML = '';
  for (const a of ANN) {
    if (a.lm && !isLM) { a.el = null; continue; }
    const d = document.createElement('div');
    d.className = 'ann' + (a.green ? ' green' : '');
    d.textContent = a.label;
    ann.appendChild(d); a.el = d; a.last = null;
  }
  const box = $('#channels'); box.innerHTML = '';
  for (const c of defs.channels) {
    const wrap = document.createElement('div');
    wrap.className = `chan ${c.direction}`;
    const title = c.direction === 'in'
      ? `Channel ${c.octal} in${c.name && c.name !== 'INPUT' ? ', ' + c.name : ''}`
      : `Channel ${c.octal} out, ${c.name}`;
    wrap.innerHTML = `<div class="chan-head"><h3>${title}</h3><span class="val"></span></div><div class="bits"></div><p class="bit-detail"></p>`;
    const bits = $('.bits', wrap), detail = $('.bit-detail', wrap);
    const els = [];
    const describe = (b) => {
      const t = c.bits[b];
      detail.textContent = t ? `Bit ${b}: ${t.toLowerCase().replace(/^./, (m) => m.toUpperCase())}` : `Bit ${b}: not used`;
    };
    for (let b = 15; b >= 1; b--) {
      const el = document.createElement(c.direction === 'in' ? 'button' : 'div');
      el.className = 'bit' + (c.bits[b] && !/^(SPARE|NOT USED|UNUSED)/.test(c.bits[b]) ? '' : ' unused');
      el.textContent = b;
      el.title = c.bits[b] || 'not used';
      el.addEventListener('mouseenter', () => describe(b));
      el.addEventListener('focus', () => describe(b));
      if (c.direction === 'in') {
        el.setAttribute('aria-pressed', 'false');
        el.setAttribute('aria-label', `Channel ${c.octal} bit ${b}: ${c.bits[b] || 'not used'}`);
        el.addEventListener('click', () => {
          if (!agc) return;
          // Channels 30-33 are inverted: 0 means the signal is present.
          const mask = 1 << (b - 1);
          const present = !(agc.io(c.channel) & mask);
          agc.setInputBits(c.channel, mask, present ? mask : 0);
          describe(b);
        });
      }
      bits.appendChild(el); els[b] = el;
    }
    box.appendChild(wrap);
    chanEls[c.channel] = { els, val: $('.val', wrap), dir: c.direction, last: -1 };
  }
  $('#io-source').textContent = `Bit labels: ${defs.source}.`;
}

// ---------------------------------------------------------------- simulation
let agc = null, rope = null, speed = 1, lastT = 0, running = false;
const ropes = {}, defsCache = {};

async function fetchBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}

let wasmBytes = null;
async function start(name) {
  running = false;
  $('#status').textContent = 'Loading…';
  wasmBytes ??= await fetchBin('agc.wasm');
  ropes[name] ??= await fetchBin(`ropes/${name}.bin`);
  defsCache[name] ??= await (await fetch(`channels-${name}.json`)).json();
  const isLM = name === 'Luminary099';
  agc = await AGC.fromBytes(wasmBytes);
  agc.boot(ropes[name]);
  rope = name;
  buildLamps(isLM);
  buildIO(defsCache[name], isLM);
  Object.values(fields).forEach((f) => (f.last = null));
  $('#build-line').textContent = isLM
    ? 'Lunar Module Eagle, running Luminary 099 assembled from the original source'
    : 'Command Module Columbia, running Comanche 055 assembled from the original source';
  document.title = `${isLM ? 'Luminary 099' : 'Comanche 055'} – Apollo 11 AGC`;
  lastT = performance.now();
  running = true;
  requestAnimationFrame(frame);
}

function frame(t) {
  if (!running) return;
  const dt = Math.min((t - lastT) / 1000, 0.25);
  lastT = t;
  if (speed > 0) agc.run(dt * speed);
  render();
  requestAnimationFrame(frame);
}

function render() {
  const d = agc.dsky();
  paintField('prog', d.prog);
  paintField('verb', d.verb, d.vnBlank);
  paintField('noun', d.noun, d.vnBlank);
  paintField('r1', d.r1); paintField('r2', d.r2); paintField('r3', d.r3);
  $('#comp-acty').classList.toggle('on', d.compActy);
  $('#tag-verb').classList.toggle('on', !d.vnBlank);
  $('#tag-noun').classList.toggle('on', !d.vnBlank);
  for (const [id, el] of Object.entries(lampEls)) {
    if (!el) continue;
    const on = !!d.lamps[id];
    if (el.classList.contains('on') !== on) {
      el.classList.toggle('on', on);
      el.setAttribute('aria-label', `${el.textContent} lamp ${on ? 'on' : 'off'}`);
    }
  }
  const ch = {};
  for (const c of Object.keys(chanEls)) {
    const n = +c;
    ch[n] = n >= 0o30 ? agc.io(n) : agc.channel(n);
  }
  for (const [c, info] of Object.entries(chanEls)) {
    const v = ch[c];
    if (v === info.last) continue;
    info.last = v;
    info.val.textContent = v.toString(8).padStart(5, '0');
    for (let b = 1; b <= 15; b++) {
      const bit = !!(v & (1 << (b - 1)));
      const on = info.dir === 'in' ? !bit : bit; // inputs: lit = signal present
      info.els[b].classList.toggle('on', on);
      if (info.dir === 'in') info.els[b].setAttribute('aria-pressed', String(on));
    }
  }
  const s = { d, ch };
  for (const a of ANN) {
    if (!a.el) continue;
    const on = !!a.test(s);
    if (on !== a.last) { a.last = on; a.el.classList.toggle('on', on); }
  }
  const secs = agc.cycles / MCT_PER_SEC;
  const h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, sec = Math.floor(secs % 60);
  $('#status').textContent = `${speed === 0 ? 'Paused. ' : ''}AGC powered for ${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- input
function press(key) {
  if (!agc) return;
  if (key === 'PRO') return;
  agc.key(key);
}
for (const b of $$('.k')) {
  const key = b.dataset.key;
  // Keep focus where it was when a key is clicked, so the keyboard keeps working.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  if (key === 'PRO') {
    const down = (e) => { e.preventDefault(); agc?.pro(true); b.classList.add('down'); };
    const up = () => { agc?.pro(false); b.classList.remove('down'); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') down(e); });
    b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') up(); });
  } else {
    b.addEventListener('click', () => press(key));
  }
}

const KEYMAP = { v: 'VERB', n: 'NOUN', enter: 'ENTR', e: 'ENTR', c: 'CLR', backspace: 'CLR',
  r: 'RSET', k: 'KEYREL', '+': '+', '=': '+', '-': '-' };
function flash(key) {
  const b = $(`.k[data-key="${CSS.escape(key)}"]`);
  if (!b) return;
  b.classList.add('down');
  setTimeout(() => b.classList.remove('down'), 110);
}
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.closest && t.closest('select, input, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'p') {
    if (!e.repeat) { agc?.pro(true); $('.k[data-key="PRO"]').classList.add('down'); }
    e.preventDefault(); return;
  }
  // A focused DSKY key must not swallow Enter: on the DSKY, Enter always means ENTR.
  const onKeypad = t.classList?.contains('k');
  if (!onKeypad && (t.tagName === 'BUTTON' || t.closest?.('#recipes')) && (k === 'enter' || k === ' ')) return;
  if (onKeypad && k === ' ') return;
  const key = /^[0-9]$/.test(k) ? k : KEYMAP[k];
  if (!key || e.repeat) return;
  e.preventDefault();
  press(key); flash(key);
});
document.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() === 'p') { agc?.pro(false); $('.k[data-key="PRO"]').classList.remove('down'); }
});

// Recipes: key the sequence in, as a person would.
for (const tr of $$('#recipes tr')) {
  tr.tabIndex = 0;
  const go = () => {
    const seq = tr.querySelector('kbd').textContent.match(/V|N|E|\d/g);
    seq.forEach((c, i) => setTimeout(() => {
      const key = { V: 'VERB', N: 'NOUN', E: 'ENTR' }[c] ?? c;
      press(key); flash(key);
    }, i * 140));
  };
  tr.addEventListener('click', go);
  tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}

$('#speed').addEventListener('change', (e) => { speed = +e.target.value; });
$('#btn-restart').addEventListener('click', () => start(rope));
for (const b of $$('.vehicle button')) {
  b.addEventListener('click', () => {
    $$('.vehicle button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    start(b.dataset.rope);
  });
}

const initial = new URLSearchParams(location.search).get('rope') === 'Luminary099' ? 'Luminary099' : 'Comanche055';
$$('.vehicle button').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.rope === initial)));
start(initial).catch((err) => {
  $('#status').textContent = `Couldn't start the AGC: ${err.message}. Serve this folder over HTTP (for example, python3 -m http.server) rather than opening the file directly.`;
});
