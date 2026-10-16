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
  q: { from: 'mirpur', to: 'motijheel', avoid: [], budget: '', student: true, arriveBy: '08:00', sort: 'best' },
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
  return { from: S.q.from, to: S.q.to, avoid: S.q.avoid, budget: S.q.budget, student: S.q.student, arriveBy: toMin(S.q.arriveBy), sort: S.q.sort, scenario: S.scn, useAlerts: S.useAlerts };
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

// ---- theme
function applyTheme() {
  const t = S.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f2f2f7';
  if (typeof drawMap === 'function') setTimeout(drawMap, 50);
}
function cycleTheme() {
  S.theme = S.theme === 'auto' ? 'light' : S.theme === 'light' ? 'dark' : 'auto';
  lsSet('dp_theme2', S.theme);
  applyTheme();
  paintShell();
  toast(`Theme: ${S.theme === 'auto' ? 'follows your device' : S.theme}`);
}
const themeIcon = () => (S.theme === 'light' ? 'sun' : S.theme === 'dark' ? 'moon' : 'device-desktop');

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
