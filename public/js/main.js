// App shell: a full-screen map with one floating card (a draggable sheet on phones).
// Three sections, Go, Live and More, switch inside the card.
const TABS = {
  go: { label: 'Go', icon: 'route', render: renderGo },
  live: { label: 'Live', icon: 'broadcast', render: renderAlerts },
  more: { label: 'More', icon: 'dots-circle-horizontal', render: renderMore },
  network: { label: 'Network', parent: 'more', wide: true, render: renderNetwork },
  rides: { label: 'Ride share', parent: 'more', render: renderRides },
  scan: { label: 'Scan a signboard', parent: 'more', render: renderScan },
  fare: { label: 'Check a fare', parent: 'more', render: renderFare },
  trust: { label: 'Trust lab', parent: 'more', wide: true, render: renderTrust },
  admin: { label: 'Admin', parent: 'more', wide: true, render: renderAdmin },
};
const MAIN = ['go', 'live', 'more'];
const OLD = { home: 'go', plan: 'go', chat: 'go', alerts: 'live' };

// Back is offered wherever there is somewhere to go back to: sub-pages, route details, open trip options, a conversation.
function canBack() {
  if (TABS[S.tab] && TABS[S.tab].parent) return true;
  if (S.tab === 'go') return S.view === 'detail' || S.optsOpen || S.thread.length > 0;
  return false;
}
function shellSub() {
  if (TABS[S.tab] && TABS[S.tab].parent) return `Back to ${TABS[TABS[S.tab].parent].label}`;
  if (S.tab === 'go' && S.view === 'detail') return 'Back to routes';
  if (S.tab === 'go' && S.optsOpen) return 'Back to home';
  if (S.tab === 'go' && S.thread.length) return 'Back to home';
  return 'Dhaka transit, honestly';
}
let shellKey = '';
paintShell = function () {
  const n = S.data ? activeAlerts().length : 0;
  const ai = !!(S.data && S.data.meta.ai);
  const back = canBack();
  const key = [S.tab, back, shellSub(), n, ai, S.theme].join('|');
  if (key === shellKey) return;
  shellKey = key;
  const on = id => S.tab === id || (TABS[S.tab] && TABS[S.tab].parent === id);
  $('#top').innerHTML = `<div class="row between" style="flex-wrap:nowrap"><div class="brand-wrap">${back ? `<button class="round back-top" data-act="navBack" aria-label="${esc(shellSub())}" title="${esc(shellSub())}">${ic('chevron-left')}</button>` : `<span class="logo">${ic('route-2')}</span>`}<span class="brand">DhakaPath<span class="brand-sub">${esc(shellSub())}</span></span></div>
      <div class="hdr-btns">${ai ? `<span class="ai-tag" title="Language AI is on">${ic('sparkles')} AI on</span>` : ''}
      <button class="round" data-act="tour" aria-label="Take the tour" title="Take the tour">${ic('player-play')}</button>
      <button class="round" data-act="themeMenu" aria-label="Change theme" aria-haspopup="dialog" title="Theme: ${esc(themeInfo(S.theme).name)}">${ic('palette')}</button></div></div>
    <nav class="segc" aria-label="Sections">${MAIN.map(id => `<button data-act="go" data-tab="${id}" aria-pressed="${on(id)}">${ic(TABS[id].icon)}${TABS[id].label}${id === 'live' && n ? `<span class="badge">${n}</span>` : ''}</button>`).join('')}</nav>`;
};

function paintMapOv() { const o = $('#mapov'); if (o) o.innerHTML = mapOverlays(); }

function go(tab, opts = {}) {
  tab = OLD[tab] || tab;
  if (!TABS[tab]) tab = 'go';
  S.tab = tab;
  if (!opts.keepHash && location.hash.split('?')[0] !== '#' + tab) history.pushState(null, '', '#' + tab);
  $('#card').classList.toggle('wide', !!TABS[tab].wide);
  paintShell();
  $('#view').scrollTop = 0;
  TABS[tab].render();
  if (tab !== 'go') { const f = $('#wiFloat'); if (f) f.innerHTML = ''; }
  drawMap();
  document.title = tab === 'go' ? 'DhakaPath' : `${TABS[tab].label} | DhakaPath`;
}
ACTIONS.go = b => go(b.dataset.tab);

// ---------------- back, theme menu, keyboard ----------------
ACTIONS.navBack = () => {
  closeThemeMenu();
  const t = TABS[S.tab];
  if (t && t.parent) return go(t.parent);
  if (S.tab !== 'go') return;
  if (S.view === 'detail') return ACTIONS.backList();
  if (S.optsOpen) { S.optsOpen = false; paintGo(); sheetTo('half'); return; }
  if (S.thread.length) return ACTIONS.newChat();
};
function closeThemeMenu() { const m = $('#themeMenu'); if (m && !m.hidden) m.hidden = true; }
ACTIONS.themeMenu = b => {
  const m = $('#themeMenu');
  if (!m.hidden) return closeThemeMenu();
  m.innerHTML = `<h4>Appearance</h4><div class="theme-grid" role="radiogroup" aria-label="Theme">${themeOptions()}</div>`;
  m.hidden = false;
  const r = b.getBoundingClientRect(), w = m.offsetWidth;
  m.style.top = Math.round(r.bottom + 8) + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, Math.round(r.right - w))) + 'px';
  const cur = m.querySelector('[aria-checked="true"]'); if (cur) cur.focus();
};
ACTIONS.pickTheme = b => { setTheme(b.dataset.v); closeThemeMenu(); const t = $('[data-act="themeMenu"]'); if (t) t.focus(); };
document.addEventListener('click', e => { if (!e.target.closest('#themeMenu') && !e.target.closest('[data-act="themeMenu"]')) closeThemeMenu(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const m = $('#themeMenu');
  if (m && !m.hidden) { closeThemeMenu(); const t = $('[data-act="themeMenu"]'); if (t) t.focus(); return; }
  if (typeof tourAt !== 'undefined' && tourAt >= 0) { ACTIONS.tourEnd(); return; }
  if (S.tab === 'live' && S.reporting) { ACTIONS.repClose(); return; }
  if (canBack()) ACTIONS.navBack();
});
// the phone's and browser's Back button closes a route detail first
window.addEventListener('popstate', () => { closeThemeMenu(); if (S.tab === 'go' && S.view === 'detail') leaveDetail(); });
ACTIONS.locateMe = async () => {
  const l = await locateMe();
  if (l && LM && l.inDhaka) LM.setView([l.lat, l.lng], Math.max(LM.getZoom(), 14), { animate: !reduceMotion() });
  else if (l && !LM) drawMap();
};
ACTIONS.stopSharing = () => { stopSharing(); toast('Location cleared. It was never saved.'); };

// ---------------- phone sheet: drag the handle, it snaps to peek, half or full ----------------
const SNAP = () => { const h = window.innerHeight; return { peek: Math.min(250, h * 0.36), half: h * 0.56, full: h - Math.max(54, h * 0.07) }; };
S.sheet = 'half';
function sheetTo(name) {
  if (window.innerWidth >= 820) return;
  S.sheet = name;
  $('#card').style.setProperty('--sheet', SNAP()[name] + 'px');
  setTimeout(() => { if (typeof drawMap === 'function') lastFitKey = ''; drawMap(); }, 450);
}
(function sheetDrag() {
  let y0 = 0, h0 = 0, dragging = false, moved = false;
  const card = $('#card');
  const start = e => {
    if (window.innerWidth >= 820) return;
    if (e.target.closest('button, input, select, a, .segc')) return;
    dragging = true; moved = false; y0 = e.clientY; h0 = card.getBoundingClientRect().height;
    card.classList.add('dragging');
  };
  const move = e => {
    if (!dragging) return;
    const dy = y0 - e.clientY;
    if (Math.abs(dy) > 4) moved = true;
    const s = SNAP();
    card.style.setProperty('--sheet', Math.max(s.peek * 0.8, Math.min(s.full, h0 + dy)) + 'px');
  };
  const end = () => {
    if (!dragging) return;
    dragging = false; card.classList.remove('dragging');
    const h = card.getBoundingClientRect().height, s = SNAP();
    const next = moved ? Object.entries(s).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0] : (S.sheet === 'full' ? 'half' : 'full');
    sheetTo(next);
  };
  $('#grab').addEventListener('pointerdown', start);
  $('#top').addEventListener('pointerdown', start);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
})();

// ---------------- global wiring ----------------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const fn = ACTIONS[b.dataset.act];
  if (!fn) return;
  if (b.tagName === 'A') e.preventDefault();
  fn(b, e);
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-bind]');
  if (t && BIND[t.dataset.bind]) BIND[t.dataset.bind](t.value);
});
document.addEventListener('input', e => {
  const t = e.target.closest('[data-input]');
  if (t && INPUTS[t.dataset.input]) INPUTS[t.dataset.input](t);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  if (FORMS[f.dataset.form]) FORMS[f.dataset.form](f);
});
document.addEventListener('focusin', e => { if (e.target.id === 'goIn' && window.innerWidth < 820 && S.sheet === 'peek') sheetTo('half'); });
let rsz = null;
window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => { if (LM) LM.invalidateSize(); if (S.tab === 'go') paintWhatIf(); sheetTo(S.sheet); lastFitKey = ''; drawMap(); }, 200); });
// Leaflet must re-measure if the map box changes size for any reason (pane resize, sheet, zoom level)
if (window.ResizeObserver) new ResizeObserver(() => { if (LM) LM.invalidateSize({ pan: false }); }).observe($('#map'));

function readHash() {
  const [raw, qs] = location.hash.replace('#', '').split('?');
  const tab = OLD[raw] || raw;
  if (tab === 'go' && qs) {
    const p = new URLSearchParams(qs);
    const ok = id => hubs().some(h => h.id === id);
    if (ok(p.get('f')) && ok(p.get('t'))) { S.q.from = p.get('f'); S.q.to = p.get('t'); S.pendingSearch = true; }
    if (p.get('s')) S.q.student = p.get('s') === '1';
    if (/^\d{2}:\d{2}$/.test(p.get('a') || '')) S.q.arriveBy = p.get('a');
  }
  return TABS[tab] ? tab : 'go';
}

(async function init() {
  applyTheme();
  await refresh();
  if (!S.data) { $('#view').innerHTML = `<div class="empty">${ic('plug-connected-x')}<h3>Cannot reach the server</h3><p class="small">Start it with <code>node server.js</code> and reload.</p></div>`; return; }
  if (S.pin) { const r = await api('/api/admin/check'); S.admin = r.ok === true; }
  mountMap();
  paintMapOv();
  loadLive();
  setInterval(loadLive, 10 * 60000);
  sheetTo('half');
  go(readHash(), { keepHash: true });
  window.addEventListener('hashchange', () => { const t = readHash(); if (t !== S.tab || S.pendingSearch) go(t, { keepHash: true }); });
  setInterval(async () => {
    if (document.hidden || S.tab !== 'live' || S.reporting) return;
    await refresh(); renderAlerts(); drawMap();
  }, 30000);
})();
