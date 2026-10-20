// Shared helpers, state, icons, theme, voice input and API access.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (name, cls = '') => `<i class="ti ti-${name}${cls ? ' ' + cls : ''}" aria-hidden="true"></i>`;

const MODES = {
  metro: { label: 'MRT-6', icon: 'train', color: 'var(--metro)' },
  bus: { label: 'Bus', icon: 'bus', color: 'var(--bus)' },
  leguna: { label: 'Leguna', icon: 'truck', color: 'var(--leguna)' },
  rickshaw: { label: 'Rickshaw', icon: 'bike', color: 'var(--rickshaw)' },
  cng: { label: 'CNG', icon: 'car', color: 'var(--cng)' },
  walk: { label: 'Walk', icon: 'walk', color: 'var(--walk)' },
};
const ALERT_ICON = { waterlogging: ['droplet', 'water'], gridlock: ['traffic-lights', 'slow'], blockade: ['barrier-block', ''], construction: ['traffic-cone', 'work'] };
const ALERT_NAME = { waterlogging: 'Waterlogging', gridlock: 'Severe gridlock', blockade: 'Intersection blocked', construction: 'Road construction' };
const modePill = (m, iconOnly) => `<span class="mode${iconOnly ? ' dot' : ''}" style="--c:${MODES[m].color}" title="${MODES[m].label}">${ic(MODES[m].icon)}${iconOnly ? '' : MODES[m].label}</span>`;

function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
function ssGet(k) { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } }
function ssSet(k, v) { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch { /* ignore */ } }
const rid = () => Math.random().toString(36).slice(2, 10);
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

const S = {
  data: null, tab: 'go',
  q: { from: 'mirpur', to: 'motijheel', avoid: [], budget: '', student: true, arriveBy: '08:00', sort: 'best', mode: '', noModes: [] },
  loc: null, // the person's own location (memory only: never saved, only sent with chat messages and location lookups)
  scn: { rain: false, rainZones: [], rush: false, blocked: [] }, useAlerts: true,
  result: null, sim: null, sel: 0, view: 'list', parsed: null, narr: null, searching: false, message: '', nl: '',
  drawer: null, mapMode: lsGet('dp_map', 'street'),
  uid: lsGet('dp_uid', '') || (() => { const v = 'u-' + rid(); lsSet('dp_uid', v); return v; })(),
  name: lsGet('dp_name', ''), theme: lsGet('dp_theme2', 'light'), voiceLang: lsGet('dp_voice', 'en'),
  pin: ssGet('dp_pin'), admin: false,
  sessionId: 's-' + rid(), chat: [], chatBusy: false,
  rides: [], scan: { drafts: [], note: '' }, showOld: false, tm: 0, fareOut: null, reportOut: null,
  recent: (() => { try { return JSON.parse(lsGet('dp_recent', '[]')) || []; } catch { return []; } })(),
  places: (() => { try { return JSON.parse(lsGet('dp_places', '{}')) || {}; } catch { return {}; } })(),
};

async function api(path, body, method) {
  const opt = { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' } };
  if (S.pin) opt.headers['x-admin-pin'] = S.pin;
  if (body) opt.body = JSON.stringify(body);
  let j;
  try {
    const r = await fetch(path, opt);
    j = await r.json();
    j._status = r.status;
  } catch (e) {
    j = { ok: false, message: 'Could not reach the DhakaPath server.', _status: 0 };
  }
  return j;
}

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'bad' ? ' bad' : '');
  el.innerHTML = `${ic(kind === 'bad' ? 'alert-circle' : 'check')}<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

const hubs = () => (S.data ? S.data.hubs : []);
const hubName = id => (hubs().find(h => h.id === id) || { name: id || '?' }).name;
const sortedHubs = () => hubs().slice().sort((a, b) => a.name.localeCompare(b.name));
const majorHubs = () => sortedHubs().filter(h => h.major !== false);
const hubOpts = (sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : '') + sortedHubs().map(h => `<option value="${h.id}"${h.id === sel ? ' selected' : ''}>${esc(h.name)}</option>`).join('');

const money = r => (r.lo === r.hi ? `৳${r.lo}` : `৳${r.lo}-${r.hi}`);
const minRange = t => `${t.lo}-${t.hi}`;
function clock(m) {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
const toMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : undefined; };
const fromMin = n => (Number.isFinite(n) ? `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : '');
const ago = m => (m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`);
const pct = c => Math.round(c * 100);

function qBody() {
  return { from: S.q.from, to: S.q.to, avoid: S.q.avoid, budget: S.q.budget, student: S.q.student, arriveBy: toMin(S.q.arriveBy), sort: S.q.sort, mode: S.q.mode || undefined, noModes: S.q.noModes || [], scenario: S.scn, useAlerts: S.useAlerts };
}
const scenActive = () => S.scn.rain || S.scn.rush || S.scn.blocked.length > 0;
const activeAlerts = () => (S.data ? S.data.alerts.filter(a => a.status === 'open' && a.conf >= S.data.meta.thresholds.active) : []);

function proofHTML(p) {
  const cls = p.ok ? '' : p.warn ? ' warn' : ' bad';
  return `<div class="proof${cls}">${ic(p.ok ? 'circle-check-filled' : p.warn ? 'alert-triangle-filled' : 'circle-x-filled')}<span>${esc(p.text)}</span></div>`;
}

function rememberTrip(from, to) {
  if (!from || !to) return;
  S.recent = [{ from, to }, ...S.recent.filter(r => !(r.from === from && r.to === to))].slice(0, 5);
  lsSet('dp_recent', JSON.stringify(S.recent));
}

// ---- theme: two light themes, two dark themes, and auto. data-theme names the palette, data-scheme is light or dark.
const THEMES = [
  { id: 'light', name: 'Light', note: 'Clean and bright', dark: false, a: '#f2f2f7', b: '#007aff' },
  { id: 'mint', name: 'Mint', note: 'Soft green light', dark: false, a: '#e8f4ed', b: '#0a8f5b' },
  { id: 'dark', name: 'Dark', note: 'Easy on the eyes', dark: true, a: '#1c1c1e', b: '#0a84ff' },
  { id: 'midnight', name: 'Midnight', note: 'Deep blue night', dark: true, a: '#0f1830', b: '#5aa9ff' },
  { id: 'auto', name: 'Auto', note: 'Follows your device', dark: null, a: 'linear-gradient(135deg,#f2f2f7 50%,#1c1c1e 50%)', b: '#007aff' },
];
const themeInfo = id => THEMES.find(t => t.id === id) || THEMES[0];
function resolveScheme(id) {
  const t = themeInfo(id);
  if (t.dark !== null) return t.dark ? 'dark' : 'light';
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme() {
  if (!THEMES.some(t => t.id === S.theme)) S.theme = 'light';
  const root = document.documentElement;
  root.dataset.theme = S.theme;
  root.dataset.scheme = resolveScheme(S.theme);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || '#f2f2f7';
  if (typeof drawMap === 'function') setTimeout(drawMap, 50);
}
function setTheme(id, quiet) {
  S.theme = themeInfo(id).id;
  lsSet('dp_theme2', S.theme);
  applyTheme();
  paintShell();
  if (S.tab === 'more' && typeof renderMore === 'function') renderMore();
  if (!quiet) toast(`Theme: ${themeInfo(S.theme).name}`);
}
if (window.matchMedia) {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => { if (S.theme === 'auto') applyTheme(); };
  if (mq.addEventListener) mq.addEventListener('change', onScheme); else if (mq.addListener) mq.addListener(onScheme);
}
const themeIcon = () => themeInfo(S.theme).dark === true ? 'moon' : themeInfo(S.theme).dark === false ? 'sun' : 'device-desktop';
const swatch = t => `<span class="sw" style="--a:${t.a};--b:${t.b}"></span>`;
function themeOptions(compact) {
  return THEMES.map(t => `<button type="button" class="theme-opt" role="radio" aria-checked="${S.theme === t.id}" data-act="pickTheme" data-v="${t.id}" aria-label="${t.name} theme">${swatch(t)}<span>${t.name}${compact ? '' : `<small>${t.note}</small>`}</span>${compact ? '' : ic('check', 'chk')}</button>`).join('');
}

// ---- the person's location (browser geolocation; works on https or localhost)
function locateMe(opts = {}) {
  return new Promise(resolve => {
    if (!navigator.geolocation) { if (!opts.silent) toast('Location is not available in this browser.', 'bad'); return resolve(null); }
    if (!opts.silent) toast('Finding your location…');
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      const r = await api('/api/locate', { lat, lng });
      const near = r.ok && r.nearest ? r.nearest : null;
      S.loc = { lat, lng, acc: Math.round(accuracy || 0), at: Date.now(), hub: near && near.hub, hubName: near && near.name, km: near && near.km, inDhaka: r.ok ? r.inDhaka : true, metro: r.ok ? r.metro : null };
      if (!S.loc.inDhaka && !opts.silent) toast('You seem to be outside Dhaka, so routes cannot start from you.', 'bad');
      if (typeof paintMapOv === 'function') paintMapOv();
      if (typeof drawMap === 'function') drawMap();
      if (S.tab === 'go' && typeof paintGo === 'function' && !S.thread.length && S.view !== 'detail') paintGo();
      resolve(S.loc);
    }, err => {
      if (!opts.silent) toast(err && err.code === 1 ? 'Location permission was blocked. Allow it in the browser to use this.' : 'Could not get your location. Try again outdoors or check GPS.', 'bad');
      resolve(null);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}
function stopSharing() {
  S.loc = null;
  if (typeof paintMapOv === 'function') paintMapOv();
  if (typeof drawMap === 'function') drawMap();
  if (S.tab === 'go' && typeof paintGo === 'function' && !S.thread.length && S.view !== 'detail') paintGo();
}

// ---- voice input (browser speech recognition, free; Chrome and Edge support it)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function listen(onText, btn) {
  if (!SR) { toast('Voice input needs Chrome or Edge.', 'bad'); return; }
  if (rec) { rec.stop(); return; }
  rec = new SR();
  rec.lang = S.voiceLang === 'bn' ? 'bn-BD' : 'en-IN';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  if (btn) btn.classList.add('listening');
  rec.onresult = e => { const t = e.results[0][0].transcript; onText(t); };
  rec.onerror = e => { if (e.error !== 'aborted') toast(e.error === 'not-allowed' ? 'Microphone permission was blocked.' : 'Did not catch that. Try again.', 'bad'); };
  rec.onend = () => { rec = null; if (btn) btn.classList.remove('listening'); };
  rec.start();
  toast(S.voiceLang === 'bn' ? 'Listening in Bangla…' : 'Listening…');
}
const micBtn = (act, extra = '') => (SR ? `<button type="button" class="btn icon" style="background:transparent" data-act="${act}" aria-label="Speak instead of typing" title="Speak (${S.voiceLang === 'bn' ? 'Bangla' : 'English'})" ${extra}>${ic('microphone')}</button>` : '');

async function refresh() {
  const d = await api('/api/state');
  if (d && d.hubs) S.data = d;
  paintShell();
}

// filled in by main.js
let paintShell = () => {};

function savePlaces() { lsSet('dp_places', JSON.stringify(S.places)); }

// ---- live road news and weather (server caches public feeds for 10 minutes)
S.live = null;
async function loadLive() {
  const r = await api('/api/live');
  if (!r.ok) return;
  S.live = r;
  if (S.tab === 'live' && typeof renderAlerts === 'function' && !S.reporting) { renderAlerts(); drawMap(); }
  if (S.tab === 'go' && S.thread && !S.thread.length && S.view !== 'detail' && typeof paintGo === 'function') paintGo();
}
function newsRow(i) {
  const tags = i.hubs.slice(0, 3).map(h => `<span class="chip blue" style="margin-left:4px">${esc(hubName(h))}</span>`).join('');
  return `<a class="news-row" href="${esc(i.link)}" target="_blank" rel="noopener noreferrer"><span class="ico" style="--c:var(--accent);width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:#fff;background:var(--accent)">${ic('news')}</span>
    <div><b>${esc(i.title)}</b><div class="src">${esc(i.source)}, ${ago(Math.max(0, Math.round((Date.now() - i.ts) / 60000)))}${tags}</div></div></a>`;
}
function fareCmpHTML(c) {
  if (!c || !c.items) return '';
  const rows = c.items.map(i => `<div class="cell has-ico"><span class="ico" style="--c:${MODES[i.mode].color}">${ic(MODES[i.mode].icon)}</span><span class="txt">${i.label}<small>${i.km} km${i.studentApplies ? `, student ${money(i.student)}` : ''}${i.surge > 1 ? `, normally ${money(i.base)}` : ''}</small></span><span class="end" style="color:var(--ink);font-weight:600">${money(i.fare)}</span></div>`).join('');
  const h = c.haggle;
  return `<div class="gh"><span>Fair prices for this trip</span><span class="tiny faint">${c.source === 'MapData street network' ? `${c.km} km by road (MapData)` : `about ${c.km} km`}</span></div>
    <div class="group">${rows}</div>
    <div class="haggle" style="margin-top:10px">${ic('message-circle')}<div><b>"${esc(h.banglish)}"</b><div class="small muted" style="margin-top:2px">${esc(h.bn)} Fair ${h.mode === 'cng' ? 'CNG' : 'rickshaw'} price. More than ৳${h.tooMuch} is too much.</div></div></div>`;
}
