// Live, More, and the pages under More: Network, Ride share, Scan, Fare check, Trust lab, Admin.
const val = id => { const e = document.getElementById(id); return e ? e.value : ''; };
const pageHead = (title, sub, back = true) => `${back ? `<button class="back" data-act="go" data-tab="more">${ic('chevron-left')}More</button>` : ''}<div class="page-h"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`;
const statusChip = s => `<span class="chip ${s === 'Clear' ? 'green' : s === 'Slow' ? 'orange' : 'red'}">${s}</span>`;
const icoCls = t => ({ waterlogging: 'water', gridlock: 'slow', blockade: 'block', construction: 'work' }[t]);
async function afterChange(render) { await refresh(); render(); drawMap(); }

// ---------------------------------------------------------------- Live
S.rep = { type: null, hub: '', sev: 2 };
S.reporting = false;
function alertRow(a) {
  const p = pct(a.conf);
  const tone = a.conf >= 0.6 ? 'hi' : a.conf >= 0.35 ? 'mid' : 'lo';
  const word = a.status !== 'open' ? (a.status === 'resolved' ? 'Cleared' : 'Rejected') : a.conf >= 0.6 ? 'Confirmed' : a.conf >= 0.35 ? 'Likely' : 'Fading';
  return `<div class="alert-cell${a.conf < 0.35 || a.status !== 'open' ? ' fade' : ''}"><span class="big-ico ${icoCls(a.type)}">${ic(ALERT_ICON[a.type][0])}</span><div>
    <div class="ah"><b>${esc(ALERT_NAME[a.type])}</b><span class="ring ${tone}">${word}${a.status === 'open' ? ' ' + p + '%' : ''}</span></div>
    <div class="small muted">${esc(hubName(a.hub))}, ${ago(a.ageMin)}${a.confirms.length ? `, ${a.confirms.length} people confirmed` : ''}</div>
    ${a.text ? `<p class="small" style="margin-top:6px">${esc(a.text)}</p>` : ''}
    ${a.status === 'open' ? `<div class="conf${a.conf < 0.35 ? ' low' : ''}"><i style="width:${p}%"></i></div>
    <div class="still">Still there?<button class="btn sm tint" data-act="confirmAlert" data-id="${a.id}">${ic('check')}Yes</button><button class="btn sm" data-act="resolveAlert" data-id="${a.id}">No, it's clear</button></div>` : ''}
  </div></div>`;
}

function reportHTML() {
  const r = S.rep;
  return `<div class="box enter" style="display:flex;flex-direction:column;gap:14px">
    <div class="row between"><h3>Report a problem</h3><button class="round" data-act="repClose" aria-label="Close">${ic('x')}</button></div>
    <div><div class="tiny muted" style="margin-bottom:8px">1. What do you see?</div><div class="types">${Object.keys(ALERT_NAME).map(t => `<button data-act="repType" data-v="${t}" aria-pressed="${r.type === t}"><span class="big-ico ${icoCls(t)}">${ic(ALERT_ICON[t][0])}</span>${{ waterlogging: 'Water', gridlock: 'Jam', blockade: 'Blocked', construction: 'Road work' }[t]}</button>`).join('')}</div></div>
    <div><div class="tiny muted" style="margin-bottom:8px">2. Where?</div><select id="repHub" data-bind="repHub">${hubOpts(r.hub, 'Choose a place')}</select><button type="button" class="btn tint sm" style="margin-top:8px" data-act="repHere">${ic('current-location')}Use my location</button></div>
    <div><div class="tiny muted" style="margin-bottom:8px">3. How bad?</div><div class="segc">${[[1, 'A little'], [2, 'Bad'], [3, 'Very bad']].map(([v, t]) => `<button data-act="repSev" data-v="${v}" aria-pressed="${r.sev === v}">${t}</button>`).join('')}</div></div>
    <button class="btn fill block" data-act="sendReport" ${r.type && r.hub ? '' : 'disabled'}>${ic('send')}Send report</button>
    <button class="btn block" data-act="repClose">Cancel</button>
    <p class="foot" style="margin:0">Others confirm it. Reports fade if nobody does. Tip: you can also just type "Farmgate e jol jomeche" in Go.</p>
  </div>`;
}

function renderAlerts() {
  const d = S.data;
  const open = d.alerts.filter(a => a.status === 'open' && a.conf >= 0.15).sort((x, y) => y.conf - x.conf);
  const old = d.alerts.filter(a => !(a.status === 'open' && a.conf >= 0.15));
  $('#view').innerHTML = `<div class="enter" style="padding-top:4px">
    <div class="page-h"><h1>Live</h1><p>${(() => { const n = open.filter(a => a.conf >= 0.35).length, f = open.length - n; return (n ? `${n} problem${n > 1 ? 's' : ''} on Dhaka's roads right now.` : 'No confirmed problems right now.') + (f ? ` ${f} older report${f > 1 ? 's are' : ' is'} fading.` : ''); })()}</p></div>
    ${S.live && S.live.weather ? `<div class="weather" style="margin-bottom:12px">${ic(S.live.weather.raining ? 'cloud-rain' : S.live.weather.nextRain ? 'cloud' : 'sun')}<div><b>${esc(S.live.weather.condition)}, ${esc(S.live.weather.temp)}°C</b><div class="small muted">${esc(S.live.weather.summary)}</div></div><span class="ai-tag data" style="margin-left:auto">Open-Meteo</span></div>` : ''}
    ${S.reporting ? reportHTML() : `<button class="btn fill block" data-act="repOpen">${ic('plus')}Report a problem</button>`}
    <div class="gh">On the roads now</div>
    <div class="group">${open.map(alertRow).join('') || `<div class="empty">${ic('mood-smile')}<h3>All clear</h3><p class="small">Nobody has reported a problem.</p></div>`}</div>
    ${old.length ? `<div class="gh"><span>Older and cleared</span><button class="btn plain sm" data-act="toggleOld">${S.showOld ? 'Hide' : 'Show'}</button></div>${S.showOld ? `<div class="group">${old.map(alertRow).join('')}</div>` : ''}` : ''}
    <p class="foot">Each report gets more sure when people confirm it, and fades by itself when nobody does. Under 35% it stops changing routes.</p>
    <div class="gh"><span>Road news</span><span class="tiny faint">${S.live ? `Updated ${ago(Math.round((Date.now() - S.live.fetchedAt) / 60000))}` : 'Loading'}</span></div>
    <div class="group">${S.live && S.live.items && S.live.items.length ? S.live.items.map(newsRow).join('') : `<div class="cell"><span class="txt muted">${S.live ? 'No road news right now, or the news sites could not be reached.' : 'Loading headlines…'}</span></div>`}</div>
    <p class="foot">Headlines from Google News (The Daily Star, BSS and others) and the Dhaka Tribune. They are not checked by DhakaPath, so they never change routes by themselves. Seen it yourself? Report it above.</p>
  </div>`;
}
ACTIONS.repOpen = () => { S.reporting = true; S.rep = { type: null, hub: '', sev: 2 }; renderAlerts(); sheetTo('full'); };
ACTIONS.repHere = async () => { const l = S.loc || await locateMe(); if (l && l.hub && l.inDhaka) { S.rep.hub = l.hub; toast(`Nearest stop: ${l.hubName}.`); renderAlerts(); } else if (l && !l.inDhaka) toast('You seem to be outside Dhaka.', 'bad'); };
ACTIONS.repClose = () => { S.reporting = false; renderAlerts(); };
ACTIONS.repType = b => { S.rep.type = b.dataset.v; renderAlerts(); };
ACTIONS.repSev = b => { S.rep.sev = Number(b.dataset.v); renderAlerts(); };
BIND.repHub = v => { S.rep.hub = v; renderAlerts(); };
ACTIONS.toggleOld = () => { S.showOld = !S.showOld; renderAlerts(); };
ACTIONS.confirmAlert = async b => { const r = await api(`/api/alerts/${b.dataset.id}/confirm`, { by: S.uid }); toast(r.ok ? 'Thanks. It is now more certain.' : r.message, r.ok ? undefined : 'bad'); afterChange(renderAlerts); };
ACTIONS.resolveAlert = async b => { const r = await api(`/api/alerts/${b.dataset.id}/resolve`, { by: S.uid }); toast(r.ok ? 'Thanks for checking.' : r.message, r.ok ? undefined : 'bad'); afterChange(renderAlerts); };
ACTIONS.sendReport = async () => {
  const r = await api('/api/alerts', { hub: S.rep.hub, type: S.rep.type, severity: S.rep.sev, text: '', by: S.uid });
  if (r.ok) { S.reporting = false; toast(r.flags && r.flags.length ? 'Saved. It waits for someone to confirm it.' : 'Report sent. Thank you.'); }
  else toast(r.message || 'Could not send.', 'bad');
  await refresh(); renderAlerts(); drawMap();
};

// ---------------------------------------------------------------- More
const MORE_TOOLS = [
  ['network', 'map-2', 'var(--accent)', 'Network', 'Every line, stop and fare'],
  ['rides', 'users', 'var(--rickshaw)', 'Ride share', 'Split a rickshaw or CNG'],
  ['scan', 'scan', 'var(--metro)', 'Scan a signboard', 'Photo to route'],
  ['fare', 'coin', 'var(--green-solid)', 'Check a fare', 'Was the price fair?'],
];
function renderMore() {
  const cell = ([id, icon, c, t, sub]) => `<button class="cell has-ico" data-act="go" data-tab="${id}"><span class="ico" style="--c:${c}">${ic(icon)}</span><span class="txt">${t}<small>${sub}</small></span>${ic('chevron-right', 'chev')}</button>`;
  const ai = S.data.meta.ai;
  $('#view').innerHTML = `<div class="enter" style="padding-top:4px">
    <div class="page-h"><h1>More</h1></div>
    <div class="group">${MORE_TOOLS.map(cell).join('')}</div>
    <div class="gh">Trust</div>
    <div class="group">${cell(['trust', 'shield-check', 'var(--green-solid)', 'Trust lab', 'How answers are checked'])}
      <div class="cell has-ico"><span class="ico" style="--c:var(--metro)">${ic('sparkles')}</span><span class="txt">AI<small>${ai ? `Gemini, ${esc(S.data.meta.aiModel || 'free tier')}` : 'Off. Add a free Gemini key to .env'}</small></span><span class="chip ${ai ? 'green' : ''}">${ai ? 'On' : 'Off'}</span></div></div>
    <div class="gh">Your settings</div>
    <div class="group">
      <div class="cell has-ico"><span class="ico" style="--c:var(--ink-2)">${ic('palette')}</span><span class="txt">Theme<small>${esc(themeInfo(S.theme).name)}: ${esc(themeInfo(S.theme).note)}</small></span></div>
      <div class="theme-row" role="radiogroup" aria-label="Theme">${themeOptions(true)}</div>
      <div class="cell has-ico"><span class="ico" style="--c:var(--green-solid)">${ic('current-location')}</span><span class="txt">My location<small>${S.loc ? `Near ${esc(S.loc.hubName || 'a stop')}. Never saved` : 'Off. Used only to find the nearest stop'}</small></span>${S.loc ? `<button class="btn sm" data-act="stopSharing">Clear</button>` : `<button class="btn sm tint" data-act="locateMe">Turn on</button>`}</div>
      ${SR ? `<div class="cell has-ico"><span class="ico" style="--c:var(--red-solid)">${ic('microphone')}</span><span class="txt">Voice language</span><div class="segc" style="width:170px"><button data-act="voiceLang" data-v="en" aria-pressed="${S.voiceLang === 'en'}">English</button><button data-act="voiceLang" data-v="bn" aria-pressed="${S.voiceLang === 'bn'}">বাংলা</button></div></div>` : ''}
      ${Object.entries(PLACES).map(([k, P]) => `<div class="cell has-ico"><span class="ico" style="--c:${P.c}">${ic(P.icon)}</span><span class="txt">${P.label}</span><select data-bind="placeSet" data-k="${k}" aria-label="${P.label}" style="width:auto;max-width:55%;background-color:transparent;text-align:right">${hubOpts(S.places[k] || '', 'Not set')}</select></div>`).join('')}
    </div>
    <div class="gh">Help</div>
    <div class="group"><button class="cell has-ico" data-act="tour"><span class="ico" style="--c:var(--accent)">${ic('player-play')}</span><span class="txt">Take the tour<small>See everything in one minute</small></span>${ic('chevron-right', 'chev')}</button>
      ${cell(['admin', 'settings', 'var(--ink-2)', 'Admin', 'Manage lines and reports'])}</div>
    <p class="foot" style="margin-top:18px">Fares, line names and times are sample values for this prototype. Map data from OpenStreetMap contributors.</p>
  </div>`;
}
ACTIONS.voiceLang = b => { S.voiceLang = b.dataset.v; lsSet('dp_voice', S.voiceLang); renderMore(); toast(S.voiceLang === 'bn' ? 'Voice set to Bangla.' : 'Voice set to English.'); };
document.addEventListener('change', e => { const t = e.target.closest('[data-bind="placeSet"]'); if (!t) return; if (t.value) S.places[t.dataset.k] = t.value; else delete S.places[t.dataset.k]; savePlaces(); toast('Saved.'); });

// ---------------------------------------------------------------- Network
S.netTab = 'lines'; S.netMode = 'all';
function renderNetwork() {
  const d = S.data;
  let body = '';
  if (S.netTab === 'lines') {
    const rows = [];
    d.lines.filter(l => S.netMode === 'all' || l.mode === S.netMode).forEach(l => {
      const i = d.linksInfo[l.id] || {};
      const un = l.status === 'unverified';
      rows.push(`<div class="cell has-ico"><span class="ico" style="--c:${MODES[l.mode].color}">${ic(MODES[l.mode].icon)}</span><span class="txt">${esc(l.name)} ${l.source === 'organizer' ? '<span class="chip green" style="vertical-align:1px">Organizer data</span>' : '<span class="chip" style="vertical-align:1px">Sample</span>'}<small>${l.stops.length} stops: ${l.stops.map(s => esc(hubName(s))).join(', ')}${i.min ? `, about ${i.min} min` : ''}</small>${un ? `<small style="color:var(--orange)">Needs ${2 - l.confirms.length} more confirmation${2 - l.confirms.length === 1 ? '' : 's'}</small>` : ''}</span>
        <span class="end" style="flex-direction:column;align-items:flex-end;gap:2px"><span style="color:var(--ink);font-weight:600">${i.regular ? money(i.regular) : ''}</span>${l.mode === 'bus' && i.student ? `<span class="tiny">student ${money(i.student)}</span>` : ''}${un ? `<button class="btn sm tint" data-act="confirmLine" data-id="${l.id}">Confirm</button>` : ''}</span></div>`);
    });
    d.connectors.filter(c => S.netMode === 'all' || c.mode === S.netMode).forEach(c => {
      const i = d.linksInfo[c.id] || {};
      rows.push(`<div class="cell has-ico"><span class="ico" style="--c:${MODES[c.mode].color}">${ic(MODES[c.mode].icon)}</span><span class="txt">${esc(hubName(c.from))} and ${esc(hubName(c.to))}<small>${c.mode === 'cng' ? 'CNG' : 'Rickshaw'}, not metered</small></span><span class="end" style="color:var(--ink);font-weight:600">${i.regular ? money(i.regular) : ''}</span></div>`);
    });
    body = `<div class="row" style="gap:6px;margin-bottom:12px">${['all', 'metro', 'bus', 'leguna', 'rickshaw', 'cng'].map(m => `<button class="pick" data-act="netMode" data-m="${m}" aria-pressed="${S.netMode === m}">${m === 'all' ? 'All' : MODES[m].label}</button>`).join('')}</div><div class="group">${rows.join('') || '<div class="empty">Nothing here.</div>'}</div>`;
  } else if (S.netTab === 'hubs') {
    body = `<div class="group">${sortedHubs().sort((a, b) => (b.major !== false) - (a.major !== false)).map(h => {
      const st = d.status[h.id], lm = d.landmarks[h.id] || {};
      return `<div class="cell" style="align-items:flex-start;flex-direction:column;gap:6px"><div class="row between" style="width:100%"><b>${esc(h.name)}${h.major === false ? ' <span class="chip" style="vertical-align:1px">Bus stop</span>' : ''}</b>${statusChip(st.status)}</div><div class="small muted">${esc(lm.general || '')}</div>
        <div class="row" style="gap:6px"><button class="btn sm tint" data-act="planFrom" data-id="${h.id}">Start here</button><button class="btn sm" data-act="planTo" data-id="${h.id}">Go here</button></div></div>`;
    }).join('')}</div>`;
  } else {
    const r = d.rules;
    const row = (m, text) => `<div class="cell has-ico"><span class="ico" style="--c:${MODES[m].color}">${ic(MODES[m].icon)}</span><span class="txt">${MODES[m].label}<small>${text}</small></span></div>`;
    body = `<div class="group">
      ${row('bus', `৳${r.bus.perKm} per km, at least ৳${r.bus.floor}. Students pay half, never below ৳${r.bus.floor}.`)}
      ${row('metro', `About ৳${r.metro.perKm} per km, ৳${r.metro.min} to ৳${r.metro.max}. No student discount.`)}
      ${row('leguna', `৳${r.leguna.perKm} per km, at least ৳${r.leguna.floor}. No student discount.`)}
      ${row('rickshaw', `৳${r.rickshaw.loKm}-${r.rickshaw.hiKm} per km. More in rush hour (+${Math.round((r.surge.rushRickshaw - 1) * 100)}%) and rain (+${Math.round((r.surge.rainRickshaw - 1) * 100)}%).`)}
      ${row('cng', `৳${r.cng.baseLo}-${r.cng.baseHi} to start, then ৳${r.cng.loKm}-${r.cng.hiKm} per km. More in rush hour and rain.`)}
    </div><p class="foot">Sample rates for this prototype. Admins can change them and every route updates right away.</p>`;
  }
  $('#view').innerHTML = `<div class="enter">${pageHead('Network', `Every line, link and place the planner uses: ${d.hubs.length} places. The MRT-6 and the Bikolpo and Uttara buses use the organizer's map data, with real stops and street paths.`)}
    <div class="segc" style="margin-bottom:14px">${[['lines', 'Lines'], ['hubs', 'Places'], ['fares', 'Fares']].map(([k, t]) => `<button data-act="netTab" data-k="${k}" aria-pressed="${S.netTab === k}">${t}</button>`).join('')}</div>${body}</div>`;
}
ACTIONS.netTab = b => { S.netTab = b.dataset.k; renderNetwork(); };
ACTIONS.netMode = b => { S.netMode = b.dataset.m; renderNetwork(); };
ACTIONS.planFrom = b => { S.q.from = b.dataset.id; if (S.q.to === S.q.from) S.q.to = ''; S.result = null; S.view = 'list'; S.activeMsg = null; S.pendingSearch = !!S.q.to; if (!S.q.to) S.optsOpen = true; go('go'); };
ACTIONS.planTo = b => { S.q.to = b.dataset.id; if (S.q.from === S.q.to) S.q.from = ''; S.result = null; S.view = 'list'; S.activeMsg = null; S.pendingSearch = !!S.q.from; if (!S.q.from) S.optsOpen = true; go('go'); };
ACTIONS.confirmLine = async b => { const r = await api(`/api/lines/${b.dataset.id}/confirm`, { by: S.uid }); toast(r.message || 'Done', r.ok ? undefined : 'bad'); afterChange(S.tab === 'scan' ? renderScan : renderNetwork); };

// ---------------------------------------------------------------- Fare check
function renderFare() {
  const fo = S.fareOut;
  const verdict = fo ? `<div class="box enter" style="display:flex;gap:12px;align-items:flex-start"><span class="big-ico ${fo.verdict === 'plausible' ? 'water' : fo.verdict === 'suspicious' ? 'slow' : 'block'}">${ic(fo.verdict === 'plausible' ? 'circle-check' : fo.verdict === 'suspicious' ? 'alert-triangle' : 'circle-x')}</span><div>
    <h3>${fo.verdict === 'plausible' ? 'That looks fair' : fo.verdict === 'suspicious' ? 'That is unusual' : 'That cannot be right'}</h3>
    ${fo.expected ? `<p class="small muted" style="margin-top:4px">Usually ৳${fo.expected.lo}${fo.expected.hi !== fo.expected.lo ? '-' + fo.expected.hi : ''} for ${fo.expected.km} km${fo.expected.surgeHi > fo.expected.hi ? `, up to ৳${fo.expected.surgeHi} in rain and rush hour` : ''}.</p>` : ''}
    ${fo.median ? `<p class="small muted">Other people paid ৳${fo.median}.</p>` : ''}${(fo.flags || []).map(f => `<p class="small muted">${esc(f.msg)}</p>`).join('')}</div></div>` : '';
  $('#view').innerHTML = `<div class="enter">${pageHead('Check a fare', 'Before or after a ride, see if the price was fair.')}
    <div class="group">
      <div class="cell"><span class="txt">Ride</span><select id="fMode" style="width:auto;background-color:transparent">${['rickshaw', 'cng', 'bus', 'leguna', 'metro'].map(m => `<option value="${m}">${MODES[m].label}</option>`).join('')}</select></div>
      <div class="cell"><span class="txt">From</span><select id="fFrom" style="width:auto;background-color:transparent">${hubOpts('farmgate')}</select></div>
      <div class="cell"><span class="txt">To</span><select id="fTo" style="width:auto;background-color:transparent">${hubOpts('science-lab')}</select></div>
      <div class="cell"><span class="txt">I paid (৳)</span><input type="number" id="fPaid" min="1" placeholder="50" style="width:100px;text-align:right"></div>
    </div>
    <div class="row" style="margin-top:14px;gap:8px"><button class="btn fill grow" data-act="checkFare">Check</button><button class="btn tint grow" data-act="sendFare">Check and share</button></div>
    <div style="margin-top:14px">${verdict}</div><div id="fareCmp" style="margin-top:6px"></div></div>`;
  const upd = async () => { const r = await api('/api/fares/compare', { from: val('fFrom'), to: val('fTo'), rain: S.scn.rain }); const el = $('#fareCmp'); if (el) el.innerHTML = r.ok ? fareCmpHTML(r) : ''; };
  $('#fFrom').onchange = upd; $('#fTo').onchange = upd; upd();
}
const fareBody = () => ({ mode: val('fMode'), from: val('fFrom'), to: val('fTo'), paid: Number(val('fPaid')), student: S.q.student, by: S.uid });
ACTIONS.checkFare = async () => { if (!val('fPaid')) return toast('Enter what you paid.', 'bad'); const b = fareBody(); S.fareOut = await api('/api/fare-check', b); renderFare(); restoreFare(b); };
ACTIONS.sendFare = async () => { if (!val('fPaid')) return toast('Enter what you paid.', 'bad'); const b = fareBody(); S.fareOut = await api('/api/fare-report', b); await refresh(); renderFare(); restoreFare(b); };
function restoreFare(b) { $('#fMode').value = b.mode; $('#fFrom').value = b.from; $('#fTo').value = b.to; $('#fPaid').value = b.paid; }

// ---------------------------------------------------------------- Ride share
S.openRide = null;
const initials = n => esc(String(n).trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());
async function renderRides() {
  const r = await api('/api/rides');
  S.rides = r.rides || [];
  const me = S.name || 'Commuter';
  const cards = S.rides.map(x => {
    const open = S.openRide === x.id, joined = x.joined.includes(me), full = x.joined.length >= x.seats;
    return `<div class="box"><div class="row between" style="flex-wrap:nowrap;align-items:flex-start"><div><div class="row" style="gap:6px">${modePill(x.mode)}<span class="small muted">${esc(x.when)}</span></div>
        <h3 style="margin-top:8px">${esc(x.hubName)} to ${esc(x.destName)}</h3><div class="small muted">Whole ride ${money(x.fare.now)}</div></div>
        <div style="text-align:right"><div class="tiny muted">each pays</div><div style="font-size:24px;font-weight:700;letter-spacing:-0.03em">${money(x.split.perPerson)}</div></div></div>
      <div class="row between" style="margin-top:12px"><div class="row" style="gap:4px">${x.joined.map(n => `<span class="chip" title="${esc(n)}" style="width:32px;height:32px;justify-content:center;padding:0">${initials(n)}</span>`).join('')}${Array.from({ length: x.seats - x.joined.length }, () => '<span class="chip" style="width:32px;height:32px;padding:0;background:transparent;border:1.5px dashed var(--sep)"></span>').join('')}</div>
        <div class="row" style="gap:6px"><button class="btn sm${joined || full ? '' : ' fill'}" data-act="joinRide" data-id="${x.id}" ${joined || full ? 'disabled' : ''}>${joined ? 'Joined' : full ? 'Full' : 'Join'}</button><button class="btn sm tint" data-act="openRide" data-id="${x.id}">${ic('message-circle')}${open ? 'Hide' : 'Chat'}</button></div></div>
      ${open ? `<div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">${x.messages.map(m => `<div class="msg ${m.from === 'bot' ? 'bot' : 'me'}" style="${m.from === 'bot' ? 'background:var(--fill-2)' : ''}">${m.from === 'bot' ? '' : `<b>${esc(m.from)}:</b> `}${esc(m.text)}</div>`).join('')}</div>
        <form class="search" style="margin-top:10px" data-form="rideMsg" data-id="${x.id}"><input type="text" id="rm-${x.id}" placeholder='Ask "fare koto?"' aria-label="Message"><button class="btn icon send" type="submit" aria-label="Send">${ic('arrow-up')}</button></form>` : ''}
    </div>`;
  }).join('');
  $('#view').innerHTML = `<div class="enter">${pageHead('Ride share', 'Waiting at the same place? Share a rickshaw or CNG. The bot splits the fare.')}
    ${cards || `<div class="box empty">${ic('users')}<h3>No rides yet</h3><p class="small">Post the first one below.</p></div>`}
    <div class="gh">Post a ride</div>
    <div class="group">
      <div class="cell"><span class="txt">Your name</span><input type="text" id="rdName" maxlength="24" value="${esc(S.name)}" placeholder="Tanvir" style="width:150px;text-align:right"></div>
      <div class="cell"><span class="txt">From</span><select id="rdHub" style="width:auto;background-color:transparent">${hubOpts('farmgate')}</select></div>
      <div class="cell"><span class="txt">To</span><select id="rdDest" style="width:auto;background-color:transparent">${hubOpts('science-lab')}</select></div>
      <div class="cell"><span class="txt">Vehicle</span><select id="rdMode" style="width:auto;background-color:transparent"><option value="rickshaw">Rickshaw (2)</option><option value="cng">CNG (up to 4)</option></select></div>
      <div class="cell"><span class="txt">Seats</span><select id="rdSeats" style="width:auto;background-color:transparent"><option>2</option><option>3</option><option>4</option></select></div>
      <div class="cell"><span class="txt">It is raining</span><button type="button" class="switch" role="switch" id="rdRain" aria-checked="${!!S.scn.rain}" data-act="rdTog" aria-label="Raining"></button></div>
      <div class="cell"><span class="txt">Rush hour</span><button type="button" class="switch" role="switch" id="rdRush" aria-checked="false" data-act="rdTog" aria-label="Rush hour"></button></div>
    </div>
    <button class="btn fill block" style="margin-top:14px" data-act="postRide">${ic('plus')}Post ride</button></div>`;
}
const rename = () => { const n = val('rdName').trim(); if (n) { S.name = n; lsSet('dp_name', n); } return S.name || 'Commuter'; };
ACTIONS.rdTog = b => b.setAttribute('aria-checked', b.getAttribute('aria-checked') !== 'true');
ACTIONS.postRide = async () => {
  const name = rename();
  const r = await api('/api/rides', { name, hub: val('rdHub'), dest: val('rdDest'), mode: val('rdMode'), seats: Number(val('rdSeats')), when: 'Now', rush: $('#rdRush').getAttribute('aria-checked') === 'true', rain: $('#rdRain').getAttribute('aria-checked') === 'true', by: S.uid });
  if (!r.ok) return toast(r.message || 'Could not post.', 'bad');
  S.openRide = r.ride.id; toast('Ride posted. The fare bot replied.'); renderRides();
};
ACTIONS.joinRide = async b => { const name = S.name || (val('rdName').trim() || 'Commuter'); const r = await api(`/api/rides/${b.dataset.id}/join`, { name }); toast(r.ok ? 'You joined the ride.' : r.message, r.ok ? undefined : 'bad'); S.openRide = b.dataset.id; renderRides(); };
ACTIONS.openRide = b => { S.openRide = S.openRide === b.dataset.id ? null : b.dataset.id; renderRides(); };
FORMS.rideMsg = async f => { const id = f.dataset.id; const t = val('rm-' + id); if (!t.trim()) return; const r = await api(`/api/rides/${id}/message`, { name: S.name || 'Commuter', text: t }); if (!r.ok) return toast(r.message, 'bad'); renderRides(); };

// ---------------------------------------------------------------- Scan
const SAMPLE_SCAN = 'Titumir: Mohammadpur - Agargaon - Farmgate - Shahbagh - Motijheel  Fare 35\nLocal 7: Badda - Mohakhali - Narnia - Farmgate  Fare 25';
function renderScan() {
  const pend = S.data.lines.filter(l => l.status === 'unverified');
  const drafts = S.scan.drafts.map((d, i) => `<div class="box enter"><div class="row between"><h3>${esc(d.name)}</h3>${d.ok ? '<span class="chip green">Readable</span>' : '<span class="chip red">Needs 2 known stops</span>'}</div>
    <div class="row" style="margin:10px 0;gap:6px">${d.stops.map(s => `<span class="chip blue">${esc(hubName(s))}</span>`).join('')}${d.unknown.map(u => `<span class="chip red" title="Not a DhakaPath place">${ic('x')}${esc(u)}</span>`).join('')}</div>
    <p class="small muted">${d.fare ? `Fare on the sign: ৳${d.fare}. ` : ''}${d.unknown.length ? 'Places outside the network are skipped.' : ''}</p>
    <button class="btn sm fill" style="margin-top:10px" data-act="addDraft" data-i="${i}" ${d.ok ? '' : 'disabled'}>${ic('plus')}Add for confirmation</button></div>`).join('');
  $('#view').innerHTML = `<div class="enter">${pageHead('Scan a signboard', 'Take a photo of a bus sign or fare chart. The AI reads it and turns it into a route.')}
    <label class="drop" id="drop" for="scanFile">${ic('camera')}<b>Take or upload a photo</b><span class="small muted">${S.data.meta.ai ? 'Read by Gemini AI' : 'Needs the free Gemini key'}</span><input type="file" id="scanFile" accept="image/*" capture="environment" class="sr"></label>
    <div class="gh">Or paste the text</div>
    <textarea id="scanText" rows="3" placeholder="Name: Stop - Stop - Stop  Fare 40"></textarea>
    <div class="row" style="margin-top:10px;gap:8px"><button class="btn fill grow" data-act="scanText">Read text</button><button class="btn tint" data-act="scanSample">Try a sample</button></div>
    ${S.scan.note ? `<p class="foot" style="margin-top:12px">${esc(S.scan.note)}</p>` : ''}
    <div class="stack" style="margin-top:12px">${drafts}</div>
    <div class="gh">Waiting for confirmation</div>
    <div class="group">${pend.length ? pend.map(l => `<div class="cell"><span class="txt">${esc(l.name)}<small>${l.stops.map(s => esc(hubName(s))).join(', ')}, ${l.confirms.length} of 2</small></span><button class="btn sm tint" data-act="confirmLine" data-id="${l.id}">I've seen it</button></div>`).join('') : '<div class="cell"><span class="txt muted">Nothing waiting.</span></div>'}</div>
    <p class="foot">A new line joins the planner after two different people confirm it.</p></div>`;
  $('#scanFile').onchange = () => ACTIONS.scanPhoto();
  const dz = $('#drop');
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('over')));
  dz.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) scanFile(e.dataTransfer.files[0]); });
}
async function downscale(file) {
  const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const k = Math.min(1, 1400 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.85);
}
async function scanFile(f) {
  toast('Reading the photo…');
  const r = await api('/api/scan', { image: await downscale(f) });
  S.scan = { drafts: r.drafts || [], note: r.note || r.message || '' };
  renderScan();
}
ACTIONS.scanSample = () => { $('#scanText').value = SAMPLE_SCAN; };
ACTIONS.scanText = async () => { if (!val('scanText').trim()) return toast('Paste some text, or try the sample.', 'bad'); const r = await api('/api/scan', { text: val('scanText') }); S.scan = { drafts: r.drafts || [], note: r.drafts && r.drafts.length ? '' : 'Nothing readable found.' }; renderScan(); };
ACTIONS.scanPhoto = () => { const f = $('#scanFile').files[0]; if (f) scanFile(f); };
ACTIONS.addDraft = async b => {
  const d = S.scan.drafts[Number(b.dataset.i)];
  const r = await api('/api/lines', { name: d.name, mode: 'bus', stops: d.stops, status: 'unverified' });
  if (!r.ok) return toast(r.message || 'Could not add.', 'bad');
  S.scan.drafts.splice(Number(b.dataset.i), 1); toast('Added. Two people need to confirm it.');
  await refresh(); renderScan();
};

// ---------------------------------------------------------------- Trust lab
function groundHTML(title, g) {
  return `<div class="gh"><span>${title}</span><span class="chip ${g.ok ? 'green' : 'red'}">${g.ok ? 'All real' : `${g.total - g.verified} made up`}</span></div>
    <div class="group">${g.legs.map(l => `<div class="proof${l.ok ? '' : ' bad'}">${ic(l.ok ? 'circle-check-filled' : 'circle-x-filled')}<div><b>${esc(l.input.mode)}</b> ${esc(l.input.line || '')}<div class="small muted">${esc(l.input.from)} to ${esc(l.input.to)}${l.input.fare != null ? `, ৳${esc(l.input.fare)}` : ''}</div>${l.issues.map(i => `<div class="small" style="color:var(--red);margin-top:2px">${esc(i)}</div>`).join('')}</div></div>`).join('')}</div>`;
}
function fadeRows() {
  const t = S.tm;
  return S.data.alerts.filter(a => a.status === 'open').map(a => {
    let c = 0.55;
    for (let i = 0; i < a.confirms.length; i++) c = 1 - (1 - c) * 0.6;
    if (a.flags.length && !a.confirms.length) c *= 0.5;
    c = c * Math.pow(0.5, (a.sinceVerifiedMin + t) / a.halfLifeMin) * Math.pow(0.5, a.resolves.length);
    const p = Math.round(c * 100);
    return `<div class="cell" style="flex-direction:column;align-items:stretch;gap:4px"><div class="row between"><span>${esc(ALERT_NAME[a.type])} <span class="muted">at ${esc(hubName(a.hub))}</span></span><span class="ring ${c >= 0.6 ? 'hi' : c >= 0.35 ? 'mid' : 'lo'}">${c >= 0.6 ? 'Confirmed' : c >= 0.35 ? 'Likely' : c >= 0.15 ? 'Fading' : 'Gone'} ${p}%</span></div><div class="conf${c < 0.35 ? ' low' : ''}" style="margin:2px 0"><i style="width:${p}%"></i></div></div>`;
  }).join('');
}
const PRESETS = [['Rickshaw ৳900, Farmgate to Science Lab', { mode: 'rickshaw', from: 'farmgate', to: 'science-lab', paid: 900 }], ['Bus ৳3, Mirpur to Motijheel', { mode: 'bus', from: 'mirpur', to: 'motijheel', paid: 3 }], ['Rickshaw ৳50, Farmgate to Science Lab', { mode: 'rickshaw', from: 'farmgate', to: 'science-lab', paid: 50 }], ['Metro ৳400, Uttara to Motijheel', { mode: 'metro', from: 'uttara', to: 'motijheel', paid: 400 }]];
async function renderTrust() {
  const sm = await api('/api/ground/samples');
  const [gf, gr] = await Promise.all([api('/api/ground', { plan: sm.fake }), api('/api/ground', { plan: sm.real })]);
  $('#view').innerHTML = `<div class="enter">${pageHead('Trust lab', 'How DhakaPath stops made-up routes, old reports and silly fares.')}
    <div class="box"><h3>1. Made-up routes get caught</h3><p class="small muted" style="margin-top:4px">The AI only reads your words. If any AI ever suggests a route, every part is checked against the real network.</p></div>
    ${groundHTML('A pretend AI plan', gf)}${groundHTML('A real plan', gr)}
    <div class="box" style="margin-top:18px"><h3>2. Old reports fade by themselves</h3><p class="small muted" style="margin-top:4px">Drag to see the future if nobody confirms them again.</p>
      <div class="row" style="gap:10px;margin-top:6px"><span class="tiny muted">Now</span><input type="range" id="tm" min="0" max="480" step="5" value="${S.tm}" class="grow" aria-label="Minutes from now" style="--p:${(S.tm / 480) * 100}%"><b id="tmv" style="min-width:72px;text-align:right">+${S.tm} min</b></div></div>
    <div class="group" id="fadeBody" style="margin-top:10px">${fadeRows()}</div>
    <div class="box" style="margin-top:18px"><h3>3. Silly numbers are rejected</h3><p class="small muted" style="margin-top:4px">Tap one to test the fare checks.</p>
      <div class="row" style="margin-top:12px;gap:6px">${PRESETS.map((p, i) => `<button class="pick" data-act="preset" data-i="${i}">${esc(p[0])}</button>`).join('')}</div><div id="presetOut" style="margin-top:12px"></div></div>
  </div>`;
  const tm = $('#tm');
  tm.oninput = () => { S.tm = Number(tm.value); tm.style.setProperty('--p', (S.tm / 480) * 100 + '%'); $('#tmv').textContent = '+' + S.tm + ' min'; $('#fadeBody').innerHTML = fadeRows(); };
}
ACTIONS.preset = async b => {
  const [label, body] = PRESETS[Number(b.dataset.i)];
  const r = await api('/api/fare-check', body);
  $('#presetOut').innerHTML = `<div class="proof${r.verdict === 'plausible' ? '' : r.verdict === 'suspicious' ? ' warn' : ' bad'}" style="padding:0">${ic(r.verdict === 'plausible' ? 'circle-check-filled' : r.verdict === 'suspicious' ? 'alert-triangle-filled' : 'circle-x-filled')}<div><b>${r.verdict === 'plausible' ? 'Accepted' : r.verdict === 'suspicious' ? 'Flagged' : 'Rejected'}:</b> ${esc(label)}${r.expected ? `<div class="small muted">Expected ৳${r.expected.lo}${r.expected.hi !== r.expected.lo ? '-' + r.expected.hi : ''}</div>` : ''}${(r.flags || []).map(f => `<div class="small muted">${esc(f.msg)}</div>`).join('')}</div></div>`;
};

// ---------------------------------------------------------------- Admin
S.adm = { stops: [], lmHub: 'farmgate' };
async function unlock() {
  const r = await api('/api/admin/check');
  S.admin = r.ok === true;
  if (!S.admin) { S.pin = ''; ssSet('dp_pin', ''); }
  return S.admin;
}
async function renderAdmin() {
  if (!S.admin && S.pin) await unlock();
  if (!S.admin) {
    $('#view').innerHTML = `<div class="enter">${pageHead('Admin', 'Manage the network, reports and fares.')}
      <form class="box" data-form="unlock" style="display:flex;flex-direction:column;gap:12px"><span style="font-size:28px;color:var(--accent)">${ic('lock')}</span><h3>Enter the admin PIN</h3>
      <input type="password" id="pin" autocomplete="off" aria-label="Admin PIN" placeholder="PIN"><button class="btn fill block" type="submit">Unlock</button><p class="foot" style="margin:0">Demo PIN: dhaka. This is a demo lock, not real security.</p></form></div>`;
    return;
  }
  const d = S.data;
  const queue = d.alerts.filter(a => a.status === 'open').sort((x, y) => (y.flags.length - x.flags.length) || (y.conf - x.conf));
  const lm = d.landmarks[S.adm.lmHub] || {};
  const r = d.rules;
  const sel = 'style="width:auto;background-color:transparent"';
  $('#view').innerHTML = `<div class="enter">${pageHead('Admin', 'Manage the network and live reports.')}
    <div class="gh"><span>Reports to check</span><button class="btn plain sm" data-act="lockAdmin">${ic('lock')}Lock</button></div>
    <div class="group">${queue.map(a => `<div class="cell" style="flex-wrap:wrap"><span class="txt">${esc(ALERT_NAME[a.type])} at ${esc(hubName(a.hub))}<small>${a.flags.length ? 'Flagged: ' + esc(a.flags.join(', ').replace(/_/g, ' ')) : pct(a.conf) + '% sure'}</small></span>
      <div class="row" style="gap:4px"><button class="btn sm tint" data-act="admAlert" data-do="approve" data-id="${a.id}">OK</button><button class="btn sm" data-act="admAlert" data-do="reject" data-id="${a.id}">Reject</button><button class="btn icon sm danger" data-act="admAlert" data-do="delete" data-id="${a.id}" aria-label="Delete">${ic('trash')}</button></div></div>`).join('') || '<div class="cell"><span class="txt muted">Nothing to check.</span></div>'}</div>
    <div class="gh">Add a line</div>
    <div class="group">
      <div class="cell"><span class="txt">Name</span><input type="text" id="lnName" placeholder="Uttara-Farmgate Express" style="width:60%;text-align:right"></div>
      <div class="cell"><span class="txt">Type</span><select id="lnMode" ${sel}><option value="bus">Bus</option><option value="leguna">Leguna</option><option value="metro">MRT</option></select></div>
      <div class="cell"><span class="txt">Add a stop</span><select id="lnStop" ${sel}>${hubOpts('', 'Choose')}</select><button class="btn sm tint" data-act="addStop">Add</button></div>
      <div class="cell" style="flex-wrap:wrap;gap:6px">${S.adm.stops.map((s, i) => `<span class="chip blue">${esc(hubName(s))}<button class="round" style="width:22px;height:22px;font-size:13px;background:transparent" data-act="rmStop" data-i="${i}" aria-label="Remove ${esc(hubName(s))}">${ic('x')}</button></span>`).join('') || '<span class="small muted">Stops appear here in order.</span>'}</div>
    </div>
    <button class="btn fill block" style="margin-top:10px" data-act="saveLine">Save line</button>
    <div class="gh">Lines</div>
    <div class="group">${d.lines.map(l => `<div class="cell has-ico"><span class="ico" style="--c:${MODES[l.mode].color}">${ic(MODES[l.mode].icon)}</span><span class="txt">${esc(l.name)}${l.status === 'unverified' ? '<small style="color:var(--orange)">Unverified</small>' : ''}</span>${l.status === 'unverified' ? `<button class="btn sm tint" data-act="admLine" data-do="approve" data-id="${l.id}">Approve</button>` : ''}<button class="btn icon sm danger" data-act="admLine" data-do="delete" data-id="${l.id}" aria-label="Delete ${esc(l.name)}">${ic('trash')}</button></div>`).join('')}</div>
    <div class="gh">Rickshaw and CNG links</div>
    <div class="group">
      <div class="cell"><select id="cnMode" ${sel} aria-label="Type"><option value="rickshaw">Rickshaw</option><option value="cng">CNG</option></select><select id="cnFrom" ${sel} aria-label="From">${hubOpts('', 'From')}</select><select id="cnTo" ${sel} aria-label="To">${hubOpts('', 'To')}</select><button class="btn sm tint" data-act="addConn">Add</button></div>
      <div class="cell" style="flex-wrap:wrap;gap:6px">${d.connectors.map(c => `<span class="chip">${MODES[c.mode].label} ${esc(hubName(c.from))}-${esc(hubName(c.to))}<button class="round" style="width:22px;height:22px;font-size:13px;background:transparent" data-act="rmConn" data-id="${c.id}" aria-label="Remove">${ic('x')}</button></span>`).join('')}</div>
    </div>
    <div class="gh">Boarding landmarks</div>
    <div class="group">
      <div class="cell"><span class="txt">Place</span><select data-bind="adm.lmHub" ${sel}>${hubOpts(S.adm.lmHub)}</select></div>
      ${[['general', 'General'], ['bus', 'Bus stop'], ['metro', 'MRT station'], ['rickshaw', 'Rickshaw stand']].map(([k, t]) => `<div class="cell" style="flex-direction:column;align-items:stretch;gap:6px"><span class="tiny muted">${t}</span><input type="text" id="lm-${k}" value="${esc(lm[k] || '')}" maxlength="140"></div>`).join('')}
    </div>
    <button class="btn fill block" style="margin-top:10px" data-act="saveLm">Save landmarks</button>
    <div class="gh">Fare rules</div>
    <div class="group">
      ${[['ruKm', 'Bus ৳ per km', r.bus.perKm, 0.05], ['ruFloor', 'Bus minimum ৳', r.bus.floor, 1], ['ruDisc', 'Student discount (0.5 = half)', r.bus.studentDiscount, 0.05], ['ruRush', 'Rickshaw rush ×', r.surge.rushRickshaw, 0.05], ['ruRain', 'Rickshaw rain ×', r.surge.rainRickshaw, 0.05]].map(([id, t, v, st]) => `<div class="cell"><span class="txt">${t}</span><input type="number" step="${st}" id="${id}" value="${v}" style="width:90px;text-align:right"></div>`).join('')}
    </div>
    <button class="btn fill block" style="margin-top:10px" data-act="saveRules">Save fare rules</button>
    <button class="btn danger block" style="margin-top:22px" data-act="resetDemo">${ic('refresh')}Reset demo data</button>
  </div>`;
}
BIND['adm.lmHub'] = v => { S.adm.lmHub = v; renderAdmin(); };
FORMS.unlock = async () => { S.pin = val('pin').trim(); ssSet('dp_pin', S.pin); if (await unlock()) { toast('Admin unlocked.'); renderAdmin(); } else toast('Wrong PIN.', 'bad'); };
ACTIONS.lockAdmin = () => { S.admin = false; S.pin = ''; ssSet('dp_pin', ''); renderAdmin(); toast('Admin locked.'); };
const admDone = async (r, ok) => { toast(r.ok ? ok : (r.message || 'That did not work.'), r.ok ? undefined : 'bad'); await refresh(); renderAdmin(); drawMap(); };
ACTIONS.admAlert = async b => { const m = b.dataset.do; const r = m === 'delete' ? await api(`/api/alerts/${b.dataset.id}`, null, 'DELETE') : await api(`/api/alerts/${b.dataset.id}/${m}`, {}); admDone(r, 'Done.'); };
ACTIONS.admLine = async b => { const r = b.dataset.do === 'delete' ? await api(`/api/lines/${b.dataset.id}`, null, 'DELETE') : await api(`/api/lines/${b.dataset.id}/approve`, {}); admDone(r, 'Done.'); };
ACTIONS.addStop = () => { const v = val('lnStop'); if (v && !S.adm.stops.includes(v)) S.adm.stops.push(v); keepForm(); };
ACTIONS.rmStop = b => { S.adm.stops.splice(Number(b.dataset.i), 1); keepForm(); };
function keepForm() { const n = val('lnName'), m = val('lnMode'); renderAdmin().then(() => { const a = $('#lnName'), b = $('#lnMode'); if (a) a.value = n; if (b) b.value = m; }); }
ACTIONS.saveLine = async () => { const r = await api('/api/lines', { name: val('lnName'), mode: val('lnMode'), stops: S.adm.stops }); if (r.ok) S.adm.stops = []; admDone(r, 'Line added.'); };
ACTIONS.addConn = async () => admDone(await api('/api/connectors', { mode: val('cnMode'), from: val('cnFrom'), to: val('cnTo') }), 'Link added.');
ACTIONS.rmConn = async b => admDone(await api(`/api/connectors/${b.dataset.id}`, null, 'DELETE'), 'Removed.');
ACTIONS.saveLm = async () => admDone(await api(`/api/landmarks/${S.adm.lmHub}`, { general: val('lm-general'), bus: val('lm-bus'), metro: val('lm-metro'), rickshaw: val('lm-rickshaw') }, 'PUT'), 'Landmarks saved.');
ACTIONS.saveRules = async () => admDone(await api('/api/rules', { busPerKm: val('ruKm'), busFloor: val('ruFloor'), studentDiscount: val('ruDisc'), rushRickshaw: val('ruRush'), rainRickshaw: val('ruRain') }, 'PUT'), 'Fare rules saved.');
ACTIONS.resetDemo = async () => { if (!confirm('Reset all data to the original demo?')) return; S.result = null; const r = await api('/api/reset', {}); admDone(r, 'Demo data restored.'); };
