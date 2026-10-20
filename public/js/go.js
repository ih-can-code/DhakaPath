// Go: one search box for routes, reports and questions. Live "understood" chips, Today in Dhaka,
// saved places, conversation bubbles, route ribbons with a why line, route detail, What if?.
const ACTIONS = {};
const BIND = {};
const FORMS = {};
const INPUTS = {};

const cur = () => (S.result && S.result.options ? S.result.options[S.sel] : null);
const fareKey = () => (S.q.student ? 'student' : 'regular');
S.thread = [];
S.activeMsg = null;
S.optsOpen = false;
S.goBusy = false;
S.today = null;
S.why = null;
S.whyDetail = null;
let searchToken = 0;

// Same assumed traffic curve as the server, used for the instant slider label.
const TRAFFIC_BY_HOUR = [0, 0, 0, 0, 0, 0.05, 0.2, 0.6, 1, 1, 0.7, 0.5, 0.5, 0.55, 0.5, 0.55, 0.7, 0.95, 1, 0.9, 0.6, 0.4, 0.2, 0.1];
const trafficAt = m => { const h = Math.floor(m / 60) % 24, f = (m % 60) / 60; return TRAFFIC_BY_HOUR[h] * (1 - f) + TRAFFIC_BY_HOUR[(h + 1) % 24] * f; };
const trafficLabel = t => (t >= 0.85 ? 'Rush hour' : t >= 0.55 ? 'Busy roads' : t >= 0.25 ? 'Light traffic' : 'Quiet roads');
const trafficTone = t => (t >= 0.55 ? 'orange' : t >= 0.25 ? 'blue' : 'green');
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

const EXAMPLES = [
  ['route', 'var(--accent)', 'Mirpur theke Motijheel jabo, student'],
  ['alert-triangle', 'var(--orange-solid)', 'Farmgate e jol jomeche'],
  ['coin', 'var(--green-solid)', 'Student fare koto?'],
  ['language', 'var(--metro)', 'মিরপুর থেকে মতিঝিল যাবো'],
  ['plane', 'var(--teal-solid)', 'Gulshan to Airport, cheapest way'],
  ['current-location', 'var(--accent)', 'Nearest metro station'],
];
const PLACES = { home: { label: 'Home', icon: 'home', c: 'var(--accent)' }, school: { label: 'School', icon: 'school', c: 'var(--orange-solid)' } };

function renderGo() {
  $('#view').innerHTML = `<div class="go">
    <form class="search" data-form="go" role="search">${ic('search')}
      <input id="goIn" type="text" autocomplete="off" enterkeyhint="go" aria-label="Where to? Ask anything" placeholder="Where to? Ask anything" value="${esc(S.goDraft || '')}">
      ${micBtn('micGo')}<button type="button" class="btn icon loc-btn${S.loc ? ' has-loc' : ''}" style="background:transparent" data-act="locateMe" aria-label="Use my location" title="${S.loc ? 'Location on. Tap to refresh' : 'Use my location'}">${ic(S.loc ? 'current-location' : 'location')}</button><button type="button" class="btn icon" style="background:transparent" data-act="opts" aria-label="Trip options" aria-expanded="${S.optsOpen}">${ic('adjustments-horizontal')}</button>
      <button class="btn icon send" type="submit" aria-label="Go">${ic('arrow-up')}</button></form>
    <div class="understood" id="understood" aria-live="polite"></div>
    <div id="optsBox"></div>
    <div id="goBody"></div>
    <div class="wi-inline" id="wiInline"></div>
  </div>`;
  const i = $('#goIn');
  i.oninput = () => { S.goDraft = i.value; liveUnderstand(i.value); };
  paintGo();
  if (!S.today || Date.now() - S.today.at > 60000) loadToday();
  if (S.pendingAsk) { const t = S.pendingAsk; S.pendingAsk = null; sendGo(t); }
  else if (S.pendingSearch) { S.pendingSearch = false; S.activeMsg = null; runSearch(); }
}

function paintGo() {
  const b = $('#goBody');
  if (!b) return;
  paintShell();
  b.innerHTML = S.view === 'detail' && cur() ? detailHTML(cur()) : S.thread.length ? threadHTML() : homeHTML();
  const ob = $('#optsBox'); if (ob) ob.innerHTML = S.optsOpen ? optionsHTML() : '';
  paintWhatIf();
  if (S.view !== 'detail' && S.thread.length) requestAnimationFrame(() => { const last = b.querySelector('[data-last]'); if (last) last.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' }); });
}

// ---------------- live understanding while typing (rules only, instant) ----------------
let uTimer = null;
function liveUnderstand(text) {
  clearTimeout(uTimer);
  const box = $('#understood');
  if (!text.trim()) { if (box) box.innerHTML = ''; return; }
  uTimer = setTimeout(async () => {
    const p = await api('/api/understand', { text });
    if (!box || ($('#goIn') || {}).value !== text) return;
    box.innerHTML = understoodHTML(p);
  }, 220);
}
function understoodHTML(p) {
  const c = [];
  if (p.intent === 'report' && (p.hub || p.alertType)) c.push(`<span class="chip orange">${ic('alert-triangle')}Report${p.alertType ? ' ' + esc(ALERT_NAME[p.alertType].toLowerCase()) : ''}${p.hub ? ' at ' + esc(hubName(p.hub)) : ''}</span>`);
  else {
    const nm = (id, place) => (place ? `${esc(place)} <span style="opacity:.7">via ${esc(hubName(id))}</span>` : esc(hubName(id)));
    if (p.here && !p.from) c.push(`<span class="chip green">${ic('current-location')}From where you are</span>`);
    if (p.from) c.push(`<span class="chip blue">${ic('circle-dot')}${nm(p.from, p.fromPlace)}</span>`);
    if (p.to) c.push(`<span class="chip blue">${ic('map-pin')}${nm(p.to, p.toPlace)}</span>`);
    if (p.mode) c.push(`<span class="chip">${ic(MODES[p.mode].icon)}By ${esc(MODES[p.mode].label)}</span>`);
    (p.noModes || []).forEach(m => c.push(`<span class="chip red">${ic('ban')}No ${esc(MODES[m].label)}</span>`));
    if (p.sort) c.push(`<span class="chip">${ic('arrows-sort')}${esc({ cheapest: 'Cheapest', fastest: 'Fastest', fewest: 'Fewest changes', safest: 'Most reliable' }[p.sort])}</span>`);
    (p.avoid || []).forEach(a => c.push(`<span class="chip red">${ic('ban')}Avoid ${esc(hubName(a))}</span>`));
    if (p.budget) c.push(`<span class="chip green">${ic('coin')}Under ৳${p.budget}</span>`);
    if (p.student) c.push(`<span class="chip">${ic('school')}Student</span>`);
    if (Number.isFinite(p.arriveBy)) c.push(`<span class="chip">${ic('clock')}By ${clock(p.arriveBy)}</span>`);
    if (p.rain) c.push(`<span class="chip teal">${ic('cloud-rain')}Rain</span>`);
    if (!c.length && (p.intent === 'fare_question' || p.intent === 'reliability')) c.push(`<span class="chip">${ic('help-circle')}A question</span>`);
  }
  return c.length ? `<span class="lab">${ic('sparkles')}Understood</span>${c.join('')}` : '';
}

// ---------------- home: today, places, examples ----------------
async function loadToday() {
  const r = await api('/api/today');
  if (r.ok) { S.today = { ...r, at: Date.now() }; if (S.tab === 'go' && !S.thread.length && S.view !== 'detail') paintGo(); }
  if (r.pending) setTimeout(async () => { const r2 = await api('/api/today'); if (r2.ok && r2.ai) { S.today = { ...r2, at: Date.now() }; if (S.tab === 'go' && !S.thread.length) paintGo(); } }, 9000);
}

function placeTile(key) {
  const P = PLACES[key], hub = S.places[key];
  if (S.placeEdit === key) {
    return `<div class="place"><span class="pi" style="--c:${P.c}">${ic(P.icon)}</span><b>${P.label} is at</b><select data-bind="place" aria-label="${P.label} hub">${hubOpts(hub || '', 'Pick a hub')}</select></div>`;
  }
  return `<button class="place" data-act="${hub ? 'goPlace' : 'editPlace'}" data-k="${key}"><span class="pi" style="--c:${P.c}">${ic(P.icon)}</span><b>${hub ? 'To ' + P.label : 'Add ' + P.label}</b><small>${hub ? esc(hubName(hub)) : 'Tap to set'}</small></button>`;
}

function homeHTML() {
  const t = S.today;
  const hr = new Date().getHours();
  const greet = hr < 5 ? 'Late night' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : hr < 21 ? 'Good evening' : 'Good night';
  const here = S.loc ? (S.loc.inDhaka ? `<div class="here-strip">${ic('current-location')}<span>You are near <b>${esc(S.loc.hubName || 'a stop')}</b>${S.loc.km != null ? `, about ${S.loc.km} km away` : ''}.</span><button class="btn sm" data-act="stopSharing">Clear</button></div>` : `<div class="here-strip">${ic('current-location')}<span>You seem to be outside Dhaka.</span><button class="btn sm" data-act="stopSharing">Clear</button></div>`) : '';
  return `<div class="stack enter" style="padding-top:10px">
    <div class="hello"><h2>${greet}. Where to?</h2><p>Type a place in English, Banglish or বাংলা. Gulshan, Airport, Tejgaon and many more areas work.</p></div>
    ${here}
    <section class="today" aria-label="Today in Dhaka"><div class="hd">${ic('sparkles')}Today in Dhaka<span class="ai-tag${t && t.ai ? '' : ' data'}">${t && t.ai ? 'AI' : 'Live data'}</span></div>
      ${t ? `<p>${esc(t.text)}</p>` : '<div class="sk" style="height:44px"></div>'}</section>
    ${S.live && S.live.items && S.live.items.length ? `<div><div class="gh"><span>Road news</span><button class="btn plain sm" data-act="go" data-tab="live">See all</button></div><div class="group">${S.live.items.slice(0, 2).map(newsRow).join('')}</div></div>` : ''}
    <div><div class="gh">Your places</div><div class="places">${placeTile('home')}${placeTile('school')}
      <button class="place" data-act="locate"><span class="pi" style="--c:var(--green-solid)">${ic('current-location')}</span><b>Near me</b><small>${S.loc && S.loc.hubName ? esc(S.loc.hubName) : 'Start from where you are'}</small></button></div></div>
    <div><div class="gh">Try asking</div><div class="group">${EXAMPLES.map(([icon, c, q]) => `<button class="cell has-ico" data-act="say" data-q="${esc(q)}"><span class="ico" style="--c:${c}">${ic(icon)}</span><span class="txt">${esc(q)}</span>${ic('chevron-right', 'chev')}</button>`).join('')}</div>
      <p class="foot">Type, or tap the microphone and speak. English, Banglish and বাংলা all work.</p></div>
    <button class="btn tint block" data-act="tour">${ic('player-play')}Take the 1-minute tour</button>
  </div>`;
}

// ---------------- conversation ----------------
function threadHTML() {
  const last = S.thread.length - 1;
  return `<div class="thread"><div class="thread-top"><button class="btn plain sm" data-act="newChat">${ic('chevron-left')}Home</button></div>${S.thread.map((m, i) => msgHTML(m, i === last)).join('')}${S.goBusy ? '<div class="msg bot" data-last><span class="typing"><i></i><i></i><i></i></span></div>' : ''}
    <button class="btn plain sm" style="align-self:center;margin-top:10px" data-act="newChat">${ic('refresh')}Start over</button></div>`;
}

function msgHTML(m, isLast) {
  const lastAttr = isLast && !S.goBusy ? ' data-last' : '';
  if (m.role === 'me') return `<div class="msg me"${lastAttr}>${esc(m.text)}</div>`;
  const meta = m.read ? `<div class="meta">${ic('sparkles')} ${m.parser === 'ai+rules' ? 'Understood by AI' : 'Understood'}: ${esc(m.read)}</div>` : '';
  let extra = '';
  if (m.draft) extra = draftHTML(m);
  if (m.route) extra = m.id === S.activeMsg ? routesHTML() : `<button class="btn tint sm" style="align-self:flex-start" data-act="reshow" data-id="${m.id}">${ic('history')}Show ${esc(m.tripLabel || 'these routes')} again</button>`;
  const quick = isLast && !S.goBusy && (m.suggest || []).length ? `<div class="quick" role="group" aria-label="Quick replies">${m.suggest.map(q => `<button type="button" data-act="say" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : '';
  const chips = (m.chips || []).length ? `<div class="group" style="align-self:stretch">${m.chips.slice(0, 3).map(proofHTML).join('')}</div>` : '';
  return `<div class="msg bot"${extra || chips ? '' : lastAttr}>${esc(m.text)}${meta}</div>${chips}${extra ? `<div style="display:flex;flex-direction:column"${lastAttr}>${extra}</div>` : ''}${quick}`;
}

function draftHTML(m) {
  const d = m.draft;
  const [icon, cls] = ALERT_ICON[d.type];
  const big = { water: 'water', slow: 'slow', '': 'block', work: 'work' }[cls];
  return `<div class="draft"><div class="row"><span class="big-ico ${big}">${ic(icon)}</span><div class="grow"><b>${esc(ALERT_NAME[d.type])}</b><div class="small muted">${esc(d.hubName)}, ${esc(d.severityWord)}</div></div></div>
    ${m.answered ? `<div class="small muted">${esc(m.answered)}</div>` : `<div class="row" style="gap:8px"><button class="btn fill grow" data-act="sayDraft" data-id="${m.id}" data-q="Yes, send it">${ic('send')}Send report</button><button class="btn" data-act="sayDraft" data-id="${m.id}" data-q="No, cancel">Cancel</button></div>`}</div>`;
}

// ---------------- route ribbons ----------------
function routesHTML() {
  if (S.searching && !S.result) return `<div class="routes"><div style="padding:12px 14px;display:flex;flex-direction:column;gap:12px"><div class="sk" style="height:62px"></div><div class="sk" style="height:62px"></div><div class="sk" style="height:62px"></div></div></div>`;
  const r = S.result;
  if (!r) return '';
  if (!r.options.length) return `<div class="routes"><div class="empty">${ic('route-off')}<h3>No route fits</h3><p class="small">${esc(r.error || 'Try a bigger budget, avoid fewer places, or switch rain or a blocked junction off.')}</p></div></div>`;
  const maxHi = Math.max(...r.options.map(o => o.totals.min.hi));
  const step = maxHi > 90 ? 30 : 15;
  const ticks = [];
  for (let t = 0; t <= maxHi; t += step) ticks.push(t);
  const why = S.why && S.why.key === whyKey(r.options[0]) ? `<div class="why">${ic('sparkles')}<span>${esc(S.why.text)}${S.why.ai ? ' <span class="ai-tag" style="margin-left:4px">AI</span>' : ''}</span></div>` : '';
  return `<div class="routes${S.searching ? ' busy' : ''}">${why}${impactLine()}${r.options.map((o, i) => ribbonHTML(o, i, maxHi)).join('')}
    <div class="rb-axis" aria-hidden="true">${ticks.map(t => `<span style="left:${(t / maxHi) * 100}%">${t}</span>`).join('')}<span class="unit">min</span></div>
    <p class="legend-note">Solid part: usual time. Faded part: how late it could be.</p></div>`;
}

function barHTML(o, maxHi) {
  const segs = [];
  o.legs.forEach(l => {
    if (l.wait) segs.push(`<span class="seg-w" style="width:${(l.wait.mid / maxHi) * 100}%" title="Change, about ${Math.round(l.wait.mid)} min"></span>`);
    const w = (l.min.mid / maxHi) * 100;
    segs.push(`<span class="seg-m${l.mode === 'walk' ? ' walk' : ''}" style="--c:${MODES[l.mode].color};width:${w}%" title="${MODES[l.mode].label}, about ${Math.round(l.min.mid)} min">${w > 9 ? ic(MODES[l.mode].icon) : ''}${w > 22 ? `<em>${MODES[l.mode].label}</em>` : ''}</span>`);
  });
  const lastC = MODES[o.legs[o.legs.length - 1].mode].color;
  segs.push(`<span class="seg-tail" style="--c:${lastC};width:${((o.totals.min.hi - o.totals.min.mid) / maxHi) * 100}%"></span>`);
  return `<div class="rb-bar">${segs.join('')}</div>`;
}

function ribbonHTML(o, i, maxHi) {
  const f = o.totals.fare[fareKey()];
  const via = o.hubs.length > 2 ? `via ${o.hubs.slice(1, -1).map(hubName).join(', ')}` : 'Direct';
  const nA = new Set(o.legs.flatMap(l => l.alerts.map(a => a.id))).size;
  const tag = i === 0 ? '<span class="chip blue">Best</span>' : o.tags[0] ? `<span class="chip">${esc(o.tags[0])}</span>` : '';
  return `<button class="rb${i === S.sel ? ' sel' : ''}" data-act="open" data-i="${i}" aria-label="${esc(o.summary)}, ${minRange(o.totals.min)} minutes, ${money(f)}">
    <div class="rb-top"><span class="rb-t">${minRange(o.totals.min)}<small>min</small></span>${tag}<span class="rb-f">${money(f)}</span></div>
    ${barHTML(o, maxHi)}
    <div class="rb-meta"><span>${esc(via)}</span>${Number.isFinite(o.leaveByMin) ? `<span>Leave by <b>${clock(o.leaveByMin)}</b></span>` : ''}${nA ? `<span style="color:var(--orange)">${ic('alert-triangle')} ${nA} alert${nA > 1 ? 's' : ''}</span>` : ''}</div>
  </button>`;
}

function impactLine() {
  const s = S.sim;
  if (!s || !s.segments) return '';
  const broken = s.segments.filter(x => x.status === 'broken');
  if (!broken.length) return '';
  const where = [...new Set(broken.map(b => b.reason.split(' is ')[0]))].join(', ');
  const d = s.detour;
  return `<div class="impact">${ic('alert-triangle-filled')}<span>The usual ${esc(s.baseBest.summary.toLowerCase())} is cut at ${esc(where)}, so these routes go around it${d && d.timeDeltaMid > 0 ? ` (+${d.timeDeltaMid} min)` : ''}.</span></div>`;
}

// ---------------- why this route ----------------
const whyKey = o => (o ? `${S.q.from}>${S.q.to}|${o.summary}|${o.hubs.join('>')}|${S.q.arriveBy}|${S.scn.rain}|${S.scn.blocked.join()}` : '');
let whyTimer = null;
function scheduleWhy() {
  clearTimeout(whyTimer);
  whyTimer = setTimeout(async () => {
    const o = S.result && S.result.options[0];
    if (!o) return;
    const key = whyKey(o);
    const body = { query: { ...qBody(), scenario: scnBody() }, optionId: o.id };
    const fast = await api('/api/why', { ...body, fast: true });
    if (fast.ok && whyKey(S.result && S.result.options[0]) === key) { S.why = { key, text: fast.text, ai: false }; repaintRoutes(); }
    if (!S.data.meta.ai) return;
    const ai = await api('/api/why', body);
    if (ai.ok && ai.ai && whyKey(S.result && S.result.options[0]) === key) { S.why = { key, text: ai.text, ai: true }; repaintRoutes(); }
  }, 700);
}
function repaintRoutes() { if (S.tab === 'go' && S.view !== 'detail' && S.thread.length) paintGo(); }

async function loadWhyDetail(o) {
  const key = whyKey(o) + '|detail';
  if (S.whyDetail && S.whyDetail.key === key) return;
  S.whyDetail = { key, text: '', ai: false };
  const body = { query: { ...qBody(), scenario: scnBody() }, optionId: o.id };
  const fast = await api('/api/why', { ...body, fast: true });
  if (fast.ok && S.whyDetail.key === key) { S.whyDetail = { key, text: fast.text, ai: false }; paintWhyBox(); }
  if (!S.data.meta.ai) return;
  const ai = await api('/api/why', body);
  if (ai.ok && ai.ai && S.whyDetail.key === key) { S.whyDetail = { key, text: ai.text, ai: true }; paintWhyBox(); }
}
function paintWhyBox() {
  const el = $('#whyBox');
  if (!el || !S.whyDetail) return;
  el.innerHTML = whyBoxInner();
}
const whyBoxInner = () => `${ic('sparkles')}<div class="grow"><div class="tiny muted" style="display:flex;gap:6px;align-items:center;margin-bottom:3px">Why this route<span class="ai-tag${S.whyDetail && S.whyDetail.ai ? '' : ' data'}" style="margin-left:0">${S.whyDetail && S.whyDetail.ai ? 'AI' : 'From the data'}</span></div><p>${S.whyDetail && S.whyDetail.text ? esc(S.whyDetail.text) : '<span class="sk" style="display:block;height:20px;width:80%"></span>'}</p></div>`;

// ---------------- route detail ----------------
function leaveHTML(o) {
  if (!Number.isFinite(o.leaveByMin)) return '';
  const arrive = clock(toMin(S.q.arriveBy));
  const diff = o.leaveByMin - nowMin();
  if (diff > 0 && diff <= 120) return `<div class="leave" data-leave>${ic('clock-hour-4')}<div>Leave in ${diff} min<small>Leave by ${clock(o.leaveByMin)} to arrive by ${arrive}, even on a slow day.</small></div></div>`;
  if (diff <= 0 && diff > -45) return `<div class="leave late" data-leave>${ic('run')}<div>Leave now<small>You may be up to ${-diff} min late for ${arrive}. Try the fastest route.</small></div></div>`;
  return `<div class="leave" data-leave>${ic('clock-hour-4')}<div>Leave by ${clock(o.leaveByMin)}<small>to arrive by ${arrive}, even on a slow day.</small></div></div>`;
}
setInterval(() => { const el = $('[data-leave]'); const o = cur(); if (el && o && S.view === 'detail') el.outerHTML = leaveHTML(o); }, 30000);

function legName(l) { return `${MODES[l.mode].label} ${hubName(l.from)} to ${hubName(l.to)}`; }

function detailHTML(o) {
  const key = fareKey();
  const t = o.totals.fare;
  const last = o.legs[o.legs.length - 1].to;
  const steps = o.legs.map(l => `<div class="step"><span class="si" style="--c:${MODES[l.mode].color}">${ic(MODES[l.mode].icon)}</span><div>
      ${l.wait ? `<div class="wait">${ic('hourglass')}Change here, about ${Math.round(l.wait.mid)} min wait</div>` : ''}
      <div class="sh"><span style="color:var(--ink);font-weight:600;font-size:16px">${l.mode === 'walk' ? 'Walk' : esc(l.lineName)}</span><span>${Math.round(l.min.lo)}-${Math.round(l.min.hi)} min</span></div>
      <p>${esc(l.instruction)}</p>
      ${l.alerts.length || l.rainOn ? `<div class="row" style="gap:6px;margin-top:8px">${l.alerts.map(a => `<span class="chip ${a.conf >= 0.6 ? 'red' : 'orange'}">${ic(ALERT_ICON[a.type][0])}${esc(ALERT_NAME[a.type])}</span>`).join('')}${l.rainOn ? `<span class="chip teal">${ic('cloud-rain')}Slower in rain</span>` : ''}</div>` : ''}
    </div></div>`).join('') + `<div class="step"><span class="si" style="--c:var(--ink)">${ic('flag-filled')}</span><div><div class="sh"><span style="color:var(--ink);font-weight:600;font-size:16px">Arrive at ${esc(hubName(last))}</span></div></div></div>`;
  const fareRows = o.legs.filter(l => l.mode !== 'walk').map(l => `<div class="cell has-ico"><span class="ico" style="--c:${MODES[l.mode].color}">${ic(MODES[l.mode].icon)}</span><span class="txt">${esc(hubName(l.from))} to ${esc(hubName(l.to))}<small>${l.studentApplies ? `Student ${money(l.fare.student)}` : 'No student discount'}${l.fare.surge > 1 ? `, normally ${money(l.fare.base)}` : ''}</small></span><span class="end">${money(l.fare.regular)}</span></div>`).join('');
  const save = Math.round((t.regular.lo + t.regular.hi) / 2 - (t.student.lo + t.student.hi) / 2);
  return `<div class="detail enter">
    <button class="back" data-act="backList">${ic('chevron-left')}Routes</button>
    <div class="dhead"><div class="t">${minRange(o.totals.min)}<small>min</small></div><div class="f">${money(t[key])}<div class="tiny muted" style="font-weight:500;margin-top:4px">${S.q.student ? 'student fare' : 'fare'}</div></div></div>
    <div class="small muted" style="margin-top:-6px">${esc(hubName(o.legs[0].from))} to ${esc(hubName(last))}, ${o.transfers === 0 ? 'no changes' : o.transfers + ' change' + (o.transfers > 1 ? 's' : '')}</div>
    ${barHTML(o, o.totals.min.hi)}
    ${leaveHTML(o)}
    <div class="whybox" id="whyBox">${whyBoxInner()}</div>
    <div class="actions"><button data-act="listen">${ic('volume')}Listen</button><button data-act="card">${ic('download')}Save card</button><button data-act="share">${ic('share-2')}Share</button><button data-act="copy">${ic('copy')}Copy</button></div>
    <div><div class="gh">Steps</div><div class="group">${steps}</div></div>
    <div id="fareCmp">${S.fareCmp && S.fareCmp.key === fareCmpKey(o) ? fareCmpHTML(S.fareCmp.data) : ''}</div>
    <div><div class="gh">This route's fare</div><div class="group fares">${fareRows || '<div class="cell"><span class="txt">Walking only, so it is free.</span></div>'}
      <div class="cell tot"><span class="txt">Total${S.q.student ? '' : ' (student ' + money(t.student) + ')'}</span><span class="end">${money(t[key])}</span></div></div>
      <p class="foot">${save > 0 ? `Students save about ৳${save} here. ` : ''}Students get 50% off buses only, never below ৳${S.data.rules.bus.floor}.</p></div>
    <div><div class="gh">Why you can trust it</div><div class="group">${o.proofs.map(proofHTML).join('')}</div></div>
  </div>`;
}

// ---------------- trip options ----------------
function hubPicks(key, ids, cls) {
  return majorHubs().map(h => `<button type="button" class="pick ${cls}" data-act="pick" data-k="${key}" data-id="${h.id}" aria-pressed="${ids.includes(h.id)}">${esc(h.name)}</button>`).join('');
}
function optionsHTML() {
  const cellSel = 'style="width:auto;max-width:60%;background-color:transparent;text-align:right;font-weight:500"';
  const modeRow = (label, act, set, on) => `<div class="cell" style="flex-wrap:wrap;gap:6px"><span class="tiny muted" style="width:100%">${label}</span>${['bus', 'metro', 'leguna', 'rickshaw', 'cng'].map(m => `<button type="button" class="pick${on === 'neg' ? ' neg' : ''}" data-act="${act}" data-m="${m}" aria-pressed="${set(m)}">${ic(MODES[m].icon)} ${MODES[m].label}</button>`).join('')}</div>`;
  return `<div class="group enter" style="margin-top:12px">
    <button type="button" class="cell has-ico" data-act="locate"><span class="ico" style="--c:var(--accent)">${ic('current-location')}</span><span class="txt">Start from my location<small>${S.loc && S.loc.hubName ? `Near ${esc(S.loc.hubName)}` : 'Finds the nearest stop'}</small></span>${ic('chevron-right', 'chev')}</button>
    <div class="cell has-ico"><span class="ico" style="--c:var(--green-solid)">${ic('circle-dot')}</span><span class="txt">From</span><select data-bind="q.from" aria-label="From" ${cellSel}>${hubOpts(S.q.from, 'Choose')}</select></div>
    <div class="cell has-ico"><span class="ico" style="--c:var(--red-solid)">${ic('map-pin-filled')}</span><span class="txt">To</span><select data-bind="q.to" aria-label="To" ${cellSel}>${hubOpts(S.q.to, 'Choose')}</select></div>
    <button type="button" class="cell has-ico" data-act="swap"><span class="ico" style="--c:var(--ink-2)">${ic('arrows-exchange')}</span><span class="txt">Swap start and end</span></button>
    <div class="cell has-ico"><span class="ico" style="--c:var(--orange-solid)">${ic('school')}</span><span class="txt">Student fare</span><button type="button" class="switch" role="switch" aria-checked="${S.q.student}" aria-label="Student fare" data-act="tog" data-k="student"></button></div>
    <div class="cell has-ico"><span class="ico" style="--c:var(--green-solid)">${ic('coin')}</span><span class="txt">Budget</span><input type="number" min="0" step="5" data-bind="q.budget" value="${esc(S.q.budget)}" placeholder="Any" aria-label="Budget in taka" style="width:96px;text-align:right"></div>
    <div class="cell has-ico"><span class="ico" style="--c:var(--accent)">${ic('arrows-sort')}</span><span class="txt">Show first</span><select data-bind="q.sort" aria-label="Show first" ${cellSel}>${[['best', 'Best'], ['cheapest', 'Cheapest'], ['fastest', 'Fastest'], ['fewest', 'Fewest changes'], ['safest', 'Most reliable']].map(([v, t]) => `<option value="${v}"${S.q.sort === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
    <button type="button" class="cell has-ico" data-act="drawer" data-k="avoid"><span class="ico" style="--c:var(--red-solid)">${ic('ban')}</span><span class="txt">Avoid places</span><span class="end">${S.q.avoid.length ? S.q.avoid.map(hubName).join(', ') : 'None'}${ic('chevron-right', 'chev')}</span></button>
    ${S.drawer === 'avoid' ? `<div class="cell" style="flex-wrap:wrap;gap:6px">${hubPicks('avoid', S.q.avoid, 'neg')}</div>` : ''}
    ${modeRow('Travel by (must use)', 'pickMode', m => S.q.mode === m)}
    ${modeRow('Skip', 'pickNoMode', m => (S.q.noModes || []).includes(m), 'neg')}
    <div class="panel-foot"><button type="button" class="btn tint sm" data-act="optsDone">${ic('check')}Done</button></div>
  </div>`;
}

// ---------------- what if ----------------
function deltaHTML() {
  const d = S.sim && S.sim.detour;
  if (!(d && d.timeDeltaMid != null && S.result && S.result.options.length)) return `<div class="wi-delta" style="color:var(--ink-3)">Plan a trip to see the difference.</div>`;
  const n = d.timeDeltaMid;
  return `<div class="wi-delta${n > 2 ? ' up' : ''}">${n > 0 ? `${n} min slower` : n < 0 ? `${-n} min faster` : 'Same time'} than a quiet day</div>`;
}
function whatIfHTML() {
  const t = toMin(S.q.arriveBy) || 480;
  return `<div class="whatif">
    <div class="hd"><div><div class="tiny muted">What if I need to arrive by</div><div class="time" data-wi-time>${clock(t)}</div></div><span class="chip ${trafficTone(trafficAt(t))}" data-wi-label>${trafficLabel(trafficAt(t))}</span></div>
    <input type="range" min="360" max="1380" step="15" value="${t}" data-input="wiTime" aria-label="Arrive by time" style="--p:${((t - 360) / 1020) * 100}%">
    <div class="opt"><span class="row" style="gap:8px">${ic('cloud-rain')}Heavy rain</span><button type="button" class="switch" role="switch" aria-checked="${S.scn.rain}" aria-label="Heavy rain" data-act="tog" data-k="rain"></button></div>
    <div class="opt"><span class="row" style="gap:8px;flex-wrap:nowrap">${ic('barrier-block')}Blocked</span><select data-bind="blocked" aria-label="Blocked junction"><option value="">None</option>${majorHubs().map(h => `<option value="${h.id}"${S.scn.blocked[0] === h.id ? ' selected' : ''}>${esc(h.name)}</option>`).join('')}</select></div>
    <div data-wi-delta>${deltaHTML()}</div>
  </div>`;
}
// update in place so a slider being dragged is never replaced mid-drag
function paintWhatIf() {
  const desktop = window.innerWidth >= 820;
  const show = S.tab === 'go';
  const fl = $('#wiFloat'), inl = $('#wiInline');
  if (fl && (!show || !desktop)) fl.innerHTML = '';
  if (inl && (desktop || !(S.result && S.thread.length))) inl.innerHTML = '';
  const box = show ? (desktop ? fl : (S.result && S.thread.length ? inl : null)) : null;
  if (!box) return;
  if (!box.querySelector('.whatif')) { box.innerHTML = whatIfHTML(); return; }
  const t = toMin(S.q.arriveBy) || 480;
  const lab = box.querySelector('[data-wi-label]');
  lab.textContent = trafficLabel(trafficAt(t)); lab.className = `chip ${trafficTone(trafficAt(t))}`;
  box.querySelector('[data-wi-time]').textContent = clock(t);
  const r = box.querySelector('[data-input="wiTime"]');
  if (document.activeElement !== r) r.value = t;
  r.style.setProperty('--p', ((t - 360) / 1020) * 100 + '%');
  box.querySelector('[data-k="rain"]').setAttribute('aria-checked', S.scn.rain);
  box.querySelector('[data-bind="blocked"]').value = S.scn.blocked[0] || '';
  box.querySelector('[data-wi-delta]').innerHTML = deltaHTML();
}

// ---------------- data flow ----------------
const scnBody = () => ({ rain: S.scn.rain, rainZones: S.scn.rainZones, blocked: S.scn.blocked });
function goBody() { return { ...qBody(), scenario: scnBody(), simulate: true, sessionId: S.sessionId }; }

function ensureRouteMsg(text) {
  const m = S.thread.find(x => x.id === S.activeMsg);
  if (m) { m.tripLabel = `${hubName(S.q.from)} to ${hubName(S.q.to)}`; m.q = { ...S.q }; return; }
  const id = rid();
  S.thread.push({ role: 'bot', id, route: true, text: text || `Here are the ways from ${hubName(S.q.from)} to ${hubName(S.q.to)}.`, tripLabel: `${hubName(S.q.from)} to ${hubName(S.q.to)}`, q: { ...S.q } });
  S.activeMsg = id;
}

async function runSearch(label) {
  if (!S.q.from || !S.q.to || S.q.from === S.q.to) { S.optsOpen = true; if (S.tab === 'go') paintGo(); return; }
  const token = ++searchToken;
  S.searching = true;
  ensureRouteMsg(label);
  if (S.tab === 'go') paintGo();
  sheetTo('half');
  const r = await api('/api/search', goBody());
  if (token !== searchToken) return; // a newer search is on its way
  S.searching = false;
  S.sim = r.sim || null;
  S.result = r.sim ? r.sim.scenario : r.result || null;
  if (S.sel >= ((S.result && S.result.options.length) || 0)) S.sel = 0;
  if (S.result && S.result.options.length) { rememberTrip(S.q.from, S.q.to); scheduleWhy(); }
  if (S.tab === 'go') { paintGo(); drawMap(); }
}

async function sendGo(text, opts = {}) {
  text = String(text || '').trim();
  if (!text || S.goBusy) return;
  S.thread.forEach(m => { if (m.draft && !m.answered) m.answered = /^(yes|ha)/i.test(text) ? 'Sending…' : 'Not sent.'; });
  S.thread.push({ role: 'me', text });
  S.goDraft = ''; S.goBusy = true; S.view = 'list'; S.optsOpen = false;
  const i = $('#goIn'); if (i) i.value = '';
  const u = $('#understood'); if (u) u.innerHTML = '';
  if (S.tab === 'go') paintGo();
  const r = await api('/api/chat', { sessionId: S.sessionId, uid: S.uid, message: text, student: S.q.student, arriveBy: toMin(S.q.arriveBy), scenario: scnBody(), useAlerts: S.useAlerts, loc: S.loc ? { lat: S.loc.lat, lng: S.loc.lng } : undefined });
  S.goBusy = false;
  // "nearest metro" or "from here" needs the person's location: ask the browser once, then ask again automatically
  if (r.needLocation && !S.loc && !opts.retry) {
    const l = await locateMe();
    if (l) { S.thread.pop(); return sendGo(text, { retry: true }); }
  }
  const p = r.parsed || {};
  const placed = (id, place) => (place ? `${place} (near ${hubName(id)})` : hubName(id));
  const read = [p.from && placed(p.from, p.fromPlace), p.here && !p.from && 'from your location', p.to && 'to ' + placed(p.to, p.toPlace), p.mode && 'by ' + MODES[p.mode].label, (p.avoid || []).length && 'avoid ' + p.avoid.map(hubName).join(', '), p.budget && 'under ৳' + p.budget, Number.isFinite(p.arriveBy) && 'by ' + clock(p.arriveBy), p.student && 'student'].filter(Boolean).join(', ');
  S.thread.forEach(m => { if (m.draft && m.answered === 'Sending…') m.answered = r.mutated ? 'Sent. Thank you.' : 'Not sent.'; });
  if (r.query && r.result) {
    const q = r.query;
    S.q = { from: q.from, to: q.to, avoid: q.avoid || [], budget: q.budget || '', student: !!q.student, arriveBy: Number.isFinite(q.arriveBy) ? fromMin(q.arriveBy) : S.q.arriveBy, sort: q.sort || 'best', mode: q.mode || '', noModes: q.noModes || [] };
    if (q.scenario && q.scenario.rain) S.scn.rain = true;
    const id = rid();
    S.thread.push({ role: 'bot', id, route: true, text: r.short || r.reply, parser: r.parser, read, suggest: r.suggest, tripLabel: `${hubName(q.from)} to ${hubName(q.to)}`, q: { ...S.q } });
    S.activeMsg = id; S.sel = 0; S.result = null; S.why = null;
    await runSearch();
  } else {
    S.thread.push({ role: 'bot', id: rid(), text: r.reply || r.message || 'Something went wrong. Please try again.', chips: r.draft ? [] : r.chips, parser: r.parser, read: r.draft ? '' : read, draft: r.draft || null, suggest: r.draft ? [] : r.suggest });
    if (r.mutated) { await refresh(); S.today = null; }
    if (S.tab === 'go') { paintGo(); drawMap(); }
    sheetTo('half');
  }
}

FORMS.go = () => sendGo(($('#goIn') || {}).value);
ACTIONS.say = b => sendGo(b.dataset.q);
ACTIONS.sayDraft = b => sendGo(b.dataset.q);
ACTIONS.micGo = b => listen(t => { const i = $('#goIn'); if (i) i.value = t; sendGo(t); }, b);
ACTIONS.opts = () => { S.optsOpen = !S.optsOpen; paintGo(); if (S.optsOpen) sheetTo('full'); };
ACTIONS.newChat = () => { S.thread = []; S.activeMsg = null; S.result = null; S.sim = null; S.why = null; S.view = 'list'; S.optsOpen = false; S.q.mode = ''; S.q.noModes = []; S.scn = { rain: false, rainZones: [], rush: false, blocked: [] }; paintGo(); drawMap(); loadToday(); };
ACTIONS.reshow = b => { const m = S.thread.find(x => x.id === b.dataset.id); if (!m || !m.q) return; S.q = { ...m.q }; S.activeMsg = m.id; S.sel = 0; S.result = null; runSearch(); };
const fareCmpKey = o => `${o.legs[0].from}>${o.legs[o.legs.length - 1].to}|${S.scn.rain}|${S.q.arriveBy}`;
async function loadFareCmp(o) {
  const key = fareCmpKey(o);
  if (S.fareCmp && S.fareCmp.key === key) return;
  const r = await api('/api/fares/compare', { from: o.legs[0].from, to: o.legs[o.legs.length - 1].to, rain: S.scn.rain, arriveBy: toMin(S.q.arriveBy) });
  if (!r.ok) return;
  S.fareCmp = { key, data: r };
  const el = $('#fareCmp'); if (el && S.view === 'detail') el.innerHTML = fareCmpHTML(r);
}
ACTIONS.open = b => { S.sel = Number(b.dataset.i) || 0; S.view = 'detail'; if (!(history.state && history.state.dp === 'detail')) history.pushState({ dp: 'detail' }, '', location.href); paintGo(); drawMap(); $('#view').scrollTop = 0; sheetTo('full'); loadWhyDetail(cur()); loadFareCmp(cur()); };
function leaveDetail() { S.view = 'list'; paintGo(); drawMap(); sheetTo('half'); }
ACTIONS.backList = () => { if (history.state && history.state.dp === 'detail') history.back(); else leaveDetail(); };
ACTIONS.swap = () => { [S.q.from, S.q.to] = [S.q.to, S.q.from]; runSearch(); };
ACTIONS.tog = b => {
  const k = b.dataset.k;
  if (k === 'student') S.q.student = !S.q.student; else S.scn[k] = !S.scn[k];
  if (k === 'rain' && !S.scn.rain) S.scn.rainZones = [];
  $$(`[data-act="tog"][data-k="${k}"]`).forEach(x => x.setAttribute('aria-checked', k === 'student' ? S.q.student : S.scn[k]));
  if (S.result || (S.q.from && S.q.to && S.thread.length)) runSearch();
};
ACTIONS.drawer = b => { S.drawer = S.drawer === b.dataset.k ? null : b.dataset.k; paintGo(); };
ACTIONS.pick = b => {
  const arr = b.dataset.k === 'avoid' ? S.q.avoid : S.scn[b.dataset.k];
  const i = arr.indexOf(b.dataset.id);
  if (i >= 0) arr.splice(i, 1); else arr.push(b.dataset.id);
  if (S.result || S.thread.length) runSearch(); else paintGo();
};
ACTIONS.editPlace = b => { S.placeEdit = b.dataset.k; paintGo(); };
ACTIONS.goPlace = b => {
  const key = b.dataset.k, other = key === 'home' ? 'school' : 'home';
  const to = S.places[key];
  let from = S.places[other] && S.places[other] !== to ? S.places[other] : S.q.from;
  if (!from || from === to) from = hubs().find(h => h.id !== to).id;
  S.q.from = from; S.q.to = to; S.activeMsg = null; S.result = null; S.why = null;
  runSearch(`On the way to ${PLACES[key].label.toLowerCase()}: ${hubName(from)} to ${hubName(to)}.`);
};
BIND.place = v => { if (S.placeEdit && v) { S.places[S.placeEdit] = v; savePlaces(); toast(`${PLACES[S.placeEdit].label} saved: ${hubName(v)}.`); } S.placeEdit = null; paintGo(); };
ACTIONS.mapMode = b => { S.mapMode = b.dataset.m; lsSet('dp_map', S.mapMode); mountMap(); paintMapOv(); };
ACTIONS.zoomIn = () => { if (LM) LM.zoomIn(); };
ACTIONS.zoomOut = () => { if (LM) LM.zoomOut(); };
ACTIONS.hubFrom = b => { if (LM) LM.closePopup(); if (S.tab !== 'go') go('go'); S.q.from = b.dataset.id; if (S.q.to === S.q.from) S.q.to = ''; S.activeMsg = null; runSearch(); };
ACTIONS.hubTo = b => { if (LM) LM.closePopup(); if (S.tab !== 'go') go('go'); S.q.to = b.dataset.id; if (S.q.from === S.q.to) S.q.from = ''; S.activeMsg = null; runSearch(); };
ACTIONS.hubBlock = b => { if (LM) LM.closePopup(); if (S.tab !== 'go') go('go'); S.scn.blocked = S.scn.blocked[0] === b.dataset.id ? [] : [b.dataset.id]; if (S.result || S.thread.length) runSearch(); paintWhatIf(); drawMap(); };
ACTIONS.locate = async () => {
  const l = S.loc && Date.now() - S.loc.at < 120000 ? S.loc : await locateMe();
  if (!l) return;
  if (!l.inDhaka || !l.hub) return toast('You seem to be outside Dhaka.', 'bad');
  S.q.from = l.hub;
  if (S.q.to === S.q.from) S.q.to = '';
  toast(`Starting from ${l.hubName}, ${l.km} km away.`);
  if (S.tab !== 'go') go('go');
  if (S.q.to && S.q.to !== S.q.from) { S.activeMsg = null; runSearch(); } else { S.optsOpen = true; paintGo(); }
};
ACTIONS.pickMode = b => {
  const m = b.dataset.m;
  S.q.mode = S.q.mode === m ? '' : m;
  if (S.q.mode) S.q.noModes = (S.q.noModes || []).filter(x => x !== S.q.mode);
  if (S.result || S.thread.length) runSearch(); else paintGo();
};
ACTIONS.pickNoMode = b => {
  const m = b.dataset.m, list = S.q.noModes || [];
  S.q.noModes = list.includes(m) ? list.filter(x => x !== m) : [...list, m];
  if (S.q.mode === m) S.q.mode = '';
  if (S.result || S.thread.length) runSearch(); else paintGo();
};
ACTIONS.optsDone = () => { S.optsOpen = false; paintGo(); sheetTo('half'); };

BIND['q.from'] = v => { S.q.from = v; runSearch(); };
BIND['q.to'] = v => { S.q.to = v; runSearch(); };
BIND['q.budget'] = v => { S.q.budget = v; if (S.result || S.thread.length) runSearch(); };
BIND['q.sort'] = v => { S.q.sort = v; if (S.result || S.thread.length) runSearch(); };
BIND.blocked = v => { S.scn.blocked = v ? [v] : []; if (S.result || S.thread.length) runSearch(); else { paintWhatIf(); drawMap(); } };

// live slider: label updates instantly, routes recalculate while you drag
let wiTimer = null;
INPUTS.wiTime = el => {
  const t = Number(el.value);
  S.q.arriveBy = fromMin(t);
  $$('[data-wi-time]').forEach(x => { x.textContent = clock(t); });
  $$('[data-wi-label]').forEach(x => { x.textContent = trafficLabel(trafficAt(t)); x.className = `chip ${trafficTone(trafficAt(t))}`; });
  $$('[data-input="wiTime"]').forEach(x => { if (x !== el) x.value = t; x.style.setProperty('--p', ((t - 360) / 1020) * 100 + '%'); });
  clearTimeout(wiTimer);
  wiTimer = setTimeout(() => { if (S.result || (S.q.from && S.q.to && S.thread.length)) runSearch(); }, 160);
};

// hover a route to preview it on the map
document.addEventListener('mouseover', e => {
  const c = e.target.closest('.rb[data-i]');
  if (!c || S.tab !== 'go' || S.view !== 'list') return;
  const i = Number(c.dataset.i);
  if (i >= 0 && i !== S.sel) { S.sel = i; $$('.rb[data-i]').forEach(x => x.classList.toggle('sel', Number(x.dataset.i) === i)); drawMap(); }
});

// ---------------- briefing, offline card, share, copy ----------------
async function getBrief() {
  const o = cur();
  if (!o) return null;
  const r = await api('/api/briefing', { query: { ...qBody(), scenario: scnBody() }, optionId: o.id });
  if (!r.ok) { toast(r.message || 'Could not build the briefing.', 'bad'); return null; }
  return r;
}
ACTIONS.listen = async () => {
  if (!('speechSynthesis' in window)) return toast('This browser cannot speak. Use the offline card instead.', 'bad');
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); return toast('Briefing stopped.'); }
  const r = await getBrief();
  if (!r) return;
  const u = new SpeechSynthesisUtterance(r.text);
  u.lang = 'en-IN'; u.rate = 0.97;
  speechSynthesis.speak(u);
  toast('Playing the briefing. Tap Listen again to stop.');
};
ACTIONS.copy = async () => {
  const r = await getBrief();
  if (!r) return;
  try { await navigator.clipboard.writeText(r.text); toast('Route copied as text.'); } catch { toast('Copy is blocked in this browser.', 'bad'); }
};
ACTIONS.share = async () => {
  const url = `${location.origin}/#go?f=${S.q.from}&t=${S.q.to}&s=${S.q.student ? 1 : 0}${S.q.arriveBy ? '&a=' + S.q.arriveBy : ''}`;
  try {
    if (navigator.share) await navigator.share({ title: 'DhakaPath route', text: `${hubName(S.q.from)} to ${hubName(S.q.to)}`, url });
    else { await navigator.clipboard.writeText(url); toast('Link copied. Anyone with it sees this trip.'); }
  } catch { /* share sheet closed */ }
};

function wrapText(ctx, text, maxW) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines;
}
ACTIONS.card = async () => {
  const r = await getBrief();
  if (!r) return;
  const o = r.option, W = 760, pad = 44, k = fareKey();
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = (w, s) => { ctx.font = `${w} ${s}px Geist, system-ui, sans-serif`; };
  cv.width = W;
  font(400, 16);
  const css = getComputedStyle(document.documentElement);
  const body = [];
  o.legs.forEach(l => { body.push({ t: `${MODES[l.mode].label}: ${hubName(l.from)} to ${hubName(l.to)}`, r: `${Math.round(l.min.lo)}-${Math.round(l.min.hi)} min${l.mode === 'walk' ? '' : ', ' + money(l.fare[k])}`, b: true, c: css.getPropertyValue('--' + l.mode).trim() || '#333' }); wrapText(ctx, l.instruction, W - pad * 2 - 24).forEach(t => body.push({ t })); body.push({ gap: true }); });
  const alerts = [];
  o.legs.forEach(l => l.alerts.forEach(a => { if (!alerts.find(x => x.id === a.id)) alerts.push(a); }));
  const hasLeave = Number.isFinite(o.leaveByMin);
  const H = 250 + body.reduce((s, b) => s + (b.gap ? 10 : b.b ? 30 : 22), 0) + 40 + Math.max(1, alerts.length) * 24 + 70;
  cv.height = H;
  ctx.fillStyle = '#fcfcfb'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0b6e4f'; ctx.fillRect(0, 0, W, 10);
  ctx.fillStyle = '#121614'; font(700, 15); ctx.fillText('DhakaPath', pad, 52);
  ctx.fillStyle = '#737c77'; font(400, 14); ctx.textAlign = 'right'; ctx.fillText('Offline route card', W - pad, 52); ctx.textAlign = 'left';
  ctx.fillStyle = '#121614'; font(700, 30); ctx.fillText(`${hubName(o.legs[0].from)} to ${hubName(o.legs[o.legs.length - 1].to)}`, pad, 104);
  font(600, 44); ctx.fillText(`${minRange(o.totals.min)} min`, pad, 168);
  ctx.textAlign = 'right'; ctx.fillText(money(o.totals.fare[k]), W - pad, 168); ctx.textAlign = 'left';
  ctx.fillStyle = '#47504b'; font(400, 15);
  ctx.fillText(`${k === 'student' ? 'Student' : 'Regular'} fare${hasLeave ? `.  Leave by ${clock(o.leaveByMin)} to arrive by ${clock(toMin(S.q.arriveBy))}.` : '.'}`, pad, 200);
  ctx.strokeStyle = '#e2e5e1'; ctx.beginPath(); ctx.moveTo(pad, 224); ctx.lineTo(W - pad, 224); ctx.stroke();
  let y = 260;
  body.forEach(b => {
    if (b.gap) { y += 10; return; }
    if (b.b) { ctx.fillStyle = b.c; ctx.beginPath(); ctx.arc(pad + 6, y - 6, 6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#121614'; font(600, 17); ctx.fillText(b.t, pad + 24, y); ctx.fillStyle = '#47504b'; font(500, 15); ctx.textAlign = 'right'; ctx.fillText(b.r, W - pad, y); ctx.textAlign = 'left'; y += 30; }
    else { ctx.fillStyle = '#47504b'; font(400, 15); ctx.fillText(b.t, pad + 24, y); y += 22; }
  });
  y += 14;
  ctx.fillStyle = alerts.length ? '#c22a39' : '#1b7446'; font(600, 16);
  ctx.fillText(alerts.length ? 'Watch out' : 'No active alerts on this route', pad, y); y += 26;
  ctx.fillStyle = '#121614'; font(400, 15);
  alerts.forEach(a => { ctx.fillText(`${ALERT_NAME[a.type]} at ${hubName(a.hub)}, ${pct(a.conf)}% sure`, pad, y); y += 24; });
  ctx.fillStyle = '#9aa29d'; font(400, 12.5);
  ctx.fillText(`Saved ${new Date().toLocaleString()}. Estimates only, agree rickshaw and CNG fares before you ride.`, pad, H - 28);
  cv.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dhakapath-${o.legs[0].from}-to-${o.legs[o.legs.length - 1].to}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Offline card saved as an image.');
  });
};
