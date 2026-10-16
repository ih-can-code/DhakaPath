// DhakaPath server: zero dependencies. Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

// tiny .env loader (no dotenv)
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env, fine */ }

const D = require('./src/data');
const E = require('./src/engine');
const A = require('./src/alerts');
const G = require('./src/grounding');
const llm = require('./src/llm');
const chat = require('./src/chat');
const rides = require('./src/rides');
const scan = require('./src/scan');
const brief = require('./src/briefing');
const nlp = require('./src/nlp');
const insight = require('./src/insight');
const live = require('./src/live');
const F = require('./src/fares');

D.load();
const PORT = Number(process.env.PORT) || 5177;
const ADMIN_PIN = process.env.ADMIN_PIN || 'dhaka';
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };

const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(b); };
const bad = (res, msg, code = 400) => send(res, code, { ok: false, error: msg, message: msg });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 8e6) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

const isAdmin = req => req.headers['x-admin-pin'] === ADMIN_PIN;
const str = (v, n = 80) => String(v == null ? '' : v).trim().slice(0, n);
const slug = s => str(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function cleanQuery(b) {
  const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v));
  return {
    from: str(b.from), to: str(b.to), avoid: Array.isArray(b.avoid) ? b.avoid.map(x => str(x)).slice(0, 6) : [],
    budget: num(b.budget), student: !!b.student, arriveBy: num(b.arriveBy),
    sort: ['best', 'cheapest', 'fastest', 'fewest', 'safest'].includes(b.sort) ? b.sort : 'best',
    scenario: E.normScenario(b.scenario), useAlerts: b.useAlerts !== false,
  };
}

// End-to-end sample fare, time and distance for every line and connector (shown in the Network fare chart).
function linksInfo(db) {
  const g = E.getGraph(db);
  const F = require('./src/fares');
  const info = {};
  const one = (id, key, from, to) => {
    const e = g.byId[`${id}:${from}>${to}`];
    if (!e) return;
    const f = F.legFare(e, { rules: db.rules });
    info[id] = { km: Math.round(e.km * 10) / 10, min: Math.round(e.baseMin), regular: f.regular, student: f.student, studentApplies: f.studentApplies };
  };
  for (const l of db.lines) one(l.id, l.id, l.stops[0], l.stops[l.stops.length - 1]);
  for (const c of db.connectors) one(c.id, c.id, c.from, c.to);
  return info;
}

function state() {
  const db = D.get();
  const now = Date.now();
  return {
    linksInfo: linksInfo(db),
    hubs: db.hubs, status: E.hubStatuses(db, now), lines: db.lines, connectors: db.connectors, landmarks: db.landmarks,
    rules: db.rules, alerts: A.all(db, now), fareReports: db.fareReports.slice(0, 30),
    meta: { ai: llm.provider(), aiModel: llm.status.model, aiError: llm.status.lastError, now, halfLife: A.HALF_LIFE_MIN, thresholds: { active: A.ACTIVE_MIN, weak: A.WEAK_MIN } },
  };
}

const R = [];
const route = (method, re, fn, admin = false) => R.push({ method, re, fn, admin });

route('GET', /^\/api\/state$/, async (req, res) => send(res, 200, state()));
route('GET', /^\/api\/admin\/check$/, async (req, res) => send(res, 200, { ok: true }), true);

route('POST', /^\/api\/search$/, async (req, res, m, b) => {
  const db = D.get(); const q = cleanQuery(b);
  const sim = b.simulate ? E.simulate(db, q) : null;
  const result = sim ? sim.scenario : E.search(db, q);
  // keep the assistant's memory in step with searches made from the map and options
  if (b.sessionId) chat.session(str(b.sessionId, 40)).last = { q, result };
  send(res, 200, sim ? { ok: true, sim } : { ok: true, result });
});

route('POST', /^\/api\/simulate$/, async (req, res, m, b) => send(res, 200, { ok: true, sim: E.simulate(D.get(), cleanQuery(b)) }));

route('POST', /^\/api\/ask$/, async (req, res, m, b) => {
  const db = D.get();
  const p = await chat.understand(db, str(b.text, 400), {});
  const base = cleanQuery({ ...b, from: p.from, to: p.to });
  const q = {
    ...base, avoid: [...new Set([...(base.avoid || []), ...p.avoid])], budget: p.budget || base.budget,
    student: p.student != null ? p.student : base.student, arriveBy: Number.isFinite(p.arriveBy) ? p.arriveBy : base.arriveBy,
    scenario: { ...base.scenario, rain: base.scenario.rain || !!p.rain, rush: base.scenario.rush || !!p.rush },
  };
  const parsed = { from: p.from, to: p.to, avoid: p.avoid, budget: p.budget, student: p.student, arriveBy: p.arriveBy, rain: p.rain, rush: p.rush, lang: p.lang, intent: p.intent, parser: p.parser, dropped: p.dropped };
  if (!q.from || !q.to) return send(res, 200, { ok: true, parsed, query: q, result: null, message: 'I need both a start and a destination hub.' });
  const sim = E.isActiveScenario(q.scenario) ? E.simulate(db, q) : null;
  const result = sim ? sim.scenario : E.search(db, q);
  const narration = await chat.narrate(db, result, { ...p, student: q.student, arriveBy: q.arriveBy });
  send(res, 200, { ok: true, parsed, query: q, result, sim, narration });
});

// instant, rules-only reading of what the user is typing (no AI call per keystroke)
route('POST', /^\/api\/understand$/, async (req, res, m, b) => {
  const p = nlp.parse(str(b.text, 400), D.get().hubs);
  send(res, 200, { ok: true, from: p.from, to: p.to, avoid: p.avoid, budget: p.budget, student: p.student, arriveBy: p.arriveBy, rain: p.rain, intent: p.intent, alertType: p.alertType, hub: p.hub, lang: p.lang });
});

// one sentence on why a route is recommended (AI-worded when a key is set, always grounded)
route('POST', /^\/api\/why$/, async (req, res, m, b) => {
  const db = D.get(); const q = cleanQuery(b.query || {});
  const r = E.search(db, q);
  const o = r.options.find(x => x.id === b.optionId) || r.options[0];
  if (!o) return bad(res, 'No route to explain.');
  send(res, 200, { ok: true, ...(await insight.whyRoute(db, r, o, b.lang === 'bn' ? 'bn' : 'en', !!b.fast)) });
});

route('POST', /^\/api\/fares\/compare$/, async (req, res, m, b) => {
  const db = D.get(); const from = str(b.from), to = str(b.to);
  if (!db.hubs.some(h => h.id === from) || !db.hubs.some(h => h.id === to) || from === to) return bad(res, 'Pick two different places.');
  const t = Number(b.arriveBy);
  send(res, 200, { ok: true, ...F.compareFares(db, from, to, { rain: !!b.rain, traffic: Number.isFinite(t) ? E.trafficAt(t) : 0 }) });
});

// live road news (Google News, Dhaka Tribune) and weather (Open-Meteo), cached for 10 minutes
route('GET', /^\/api\/live$/, async (req, res) => send(res, 200, { ok: true, ...(await live.live(D.get().hubs, { wait: true })) }));

route('GET', /^\/api\/today$/, async (req, res) => send(res, 200, { ok: true, ...(await insight.today(D.get())) }));

// fair price for every way of making a trip, from the MapData street distance
route('POST', /^\/api\/fares\/compare$/, async (req, res, m, b) => {
  const db = D.get(); const from = str(b.from), to = str(b.to);
  if (!db.hubs.some(h => h.id === from) || !db.hubs.some(h => h.id === to) || from === to) return bad(res, 'Pick two different places.');
  const t = Number(b.arriveBy);
  send(res, 200, { ok: true, ...F.compareFares(db, from, to, { rain: !!b.rain, traffic: Number.isFinite(t) && b.arriveBy !== '' && b.arriveBy != null ? E.trafficAt(t) : 0 }) });
});

// live road news (Google News, Dhaka Tribune) and weather (Open-Meteo), cached for 10 minutes
route('GET', /^\/api\/live$/, async (req, res) => send(res, 200, { ok: true, ...(await live.live(D.get().hubs, { wait: true })) }));

route('POST', /^\/api\/chat$/, async (req, res, m, b) => {
  const db = D.get();
  const out = await chat.handle(db, { sessionId: str(b.sessionId, 40), message: b.message, student: !!b.student, arriveBy: b.arriveBy === '' || b.arriveBy == null ? undefined : Number(b.arriveBy), scenario: E.normScenario(b.scenario), useAlerts: b.useAlerts !== false, uid: str(b.uid, 40) }, { save: D.save });
  send(res, 200, { ok: true, ...out });
});

// ---- alerts
route('POST', /^\/api\/alerts$/, async (req, res, m, b) => {
  const db = D.get();
  const r = A.submit(db, { type: str(b.type, 20), hub: str(b.hub, 30), severity: b.severity, text: b.text, by: str(b.by, 40) || 'anon' });
  if (r.ok) D.save();
  send(res, r.ok ? 200 : 422, r);
});
route('POST', /^\/api\/alerts\/([\w-]+)\/confirm$/, async (req, res, m, b) => { const r = A.confirm(D.get(), m[1], str(b.by, 40) || 'anon'); if (r.ok) D.save(); send(res, r.ok ? 200 : 409, r); });
route('POST', /^\/api\/alerts\/([\w-]+)\/resolve$/, async (req, res, m, b) => { const r = A.resolve(D.get(), m[1], str(b.by, 40) || 'anon'); if (r.ok) D.save(); send(res, r.ok ? 200 : 409, r); });
route('POST', /^\/api\/alerts\/([\w-]+)\/reject$/, async (req, res, m) => {
  const a = D.get().alerts.find(x => x.id === m[1]);
  if (!a) return bad(res, 'Not found', 404);
  a.status = 'rejected'; D.save(); send(res, 200, { ok: true });
}, true);
route('POST', /^\/api\/alerts\/([\w-]+)\/approve$/, async (req, res, m) => {
  const a = D.get().alerts.find(x => x.id === m[1]);
  if (!a) return bad(res, 'Not found', 404);
  a.flags = []; a.confirms.push({ by: 'admin', ts: Date.now() }); a.lastVerifiedAt = Date.now(); D.save(); send(res, 200, { ok: true });
}, true);
route('DELETE', /^\/api\/alerts\/([\w-]+)$/, async (req, res, m) => { const db = D.get(); db.alerts = db.alerts.filter(x => x.id !== m[1]); D.save(); send(res, 200, { ok: true }); }, true);

// ---- fares
route('POST', /^\/api\/fare-check$/, async (req, res, m, b) => send(res, 200, { ok: true, ...A.validateFare(D.get(), { mode: str(b.mode, 10), from: str(b.from), to: str(b.to), paid: b.paid, student: !!b.student }) }));
route('POST', /^\/api\/fare-report$/, async (req, res, m, b) => {
  const r = A.submitFare(D.get(), { mode: str(b.mode, 10), from: str(b.from), to: str(b.to), paid: b.paid, student: !!b.student, by: str(b.by, 40) });
  if (r.saved) D.save();
  send(res, 200, { ok: true, ...r });
});

// ---- grounding lab
route('GET', /^\/api\/ground\/samples$/, async (req, res) => send(res, 200, { fake: G.fakePlan(), real: G.realPlan(D.get()) }));
route('POST', /^\/api\/ground$/, async (req, res, m, b) => send(res, 200, { ok: true, ...G.groundPlan(D.get(), b.plan) }));

// ---- briefing (server recomputes the option so the text only contains verified data)
route('POST', /^\/api\/briefing$/, async (req, res, m, b) => {
  const db = D.get(); const q = cleanQuery(b.query || {});
  const r = E.search(db, q);
  const o = r.options.find(x => x.id === b.optionId) || r.options[0];
  if (!o) return bad(res, 'No route to brief.');
  send(res, 200, { ok: true, ...brief.build(db, o, q), option: o });
});

// ---- signboard scan
route('POST', /^\/api\/scan$/, async (req, res, m, b) => {
  const db = D.get();
  let drafts = [], source = 'text', note = '';
  if (b.image) {
    const mm = String(b.image).match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
    if (!mm) return bad(res, 'Send a base64 image data URL.');
    if (!llm.provider() || process.env.GEMINI_API_KEY == null || process.env.GEMINI_API_KEY === '') {
      return send(res, 200, { ok: true, drafts: [], source: 'image', note: 'Photo reading needs a free Gemini key (GEMINI_API_KEY in .env). Paste the text instead to try the same flow.', needsKey: true });
    }
    const j = await llm.vision(mm[2], mm[1]);
    drafts = scan.fromVision(j, db.hubs); source = 'photo';
    if (!drafts.length) note = 'Nothing readable found in the photo. Try a clearer shot or paste the text.';
  } else {
    drafts = scan.fromText(b.text, db.hubs);
  }
  send(res, 200, { ok: true, drafts, source, note });
});

// ---- network CMS
function lineFrom(b, status) {
  const stops = (Array.isArray(b.stops) ? b.stops : []).map(x => str(x, 30));
  return { name: str(b.name, 60), mode: str(b.mode, 10), stops, status, confirms: [] };
}
function validLine(db, l) {
  if (!l.name) return 'Name is required.';
  if (!['bus', 'metro', 'leguna'].includes(l.mode)) return 'Mode must be bus, metro or leguna.';
  if (l.stops.length < 2) return 'A line needs at least 2 stops.';
  const ids = new Set(db.hubs.map(h => h.id));
  const badStop = l.stops.find(s => !ids.has(s));
  if (badStop) return `Unknown hub: ${badStop}`;
  if (new Set(l.stops).size !== l.stops.length) return 'A hub appears twice in the stop list.';
  return null;
}
route('POST', /^\/api\/lines$/, async (req, res, m, b) => {
  const db = D.get();
  const admin = isAdmin(req);
  const l = lineFrom(b, admin && b.status !== 'unverified' ? 'verified' : 'unverified');
  const err = validLine(db, l); if (err) return bad(res, err);
  l.id = `${l.mode[0]}-${slug(l.name) || 'line'}-${Math.random().toString(36).slice(2, 5)}`;
  db.lines.push(l); D.save(); send(res, 200, { ok: true, line: l });
});
route('PUT', /^\/api\/lines\/([\w-]+)$/, async (req, res, m, b) => {
  const db = D.get(); const i = db.lines.findIndex(x => x.id === m[1]);
  if (i < 0) return bad(res, 'Not found', 404);
  const l = { ...lineFrom(b, db.lines[i].status), id: m[1] };
  const err = validLine(db, l); if (err) return bad(res, err);
  db.lines[i] = l; D.save(); send(res, 200, { ok: true, line: l });
}, true);
route('DELETE', /^\/api\/lines\/([\w-]+)$/, async (req, res, m) => { const db = D.get(); db.lines = db.lines.filter(x => x.id !== m[1]); D.save(); send(res, 200, { ok: true }); }, true);
route('POST', /^\/api\/lines\/([\w-]+)\/approve$/, async (req, res, m) => { const l = D.get().lines.find(x => x.id === m[1]); if (!l) return bad(res, 'Not found', 404); l.status = 'verified'; D.save(); send(res, 200, { ok: true }); }, true);
route('POST', /^\/api\/lines\/([\w-]+)\/confirm$/, async (req, res, m, b) => {
  const l = D.get().lines.find(x => x.id === m[1]);
  if (!l) return bad(res, 'Not found', 404);
  const by = str(b.by, 40) || 'anon';
  if (l.confirms.includes(by)) return bad(res, 'You already confirmed this line.', 409);
  l.confirms.push(by);
  if (l.status === 'unverified' && l.confirms.length >= 2) l.status = 'verified';
  D.save(); send(res, 200, { ok: true, line: l, message: l.status === 'verified' ? 'Two commuters confirmed it. The line is now in the network.' : 'Thanks. One more confirmation makes it live.' });
});
route('POST', /^\/api\/connectors$/, async (req, res, m, b) => {
  const db = D.get();
  const mode = str(b.mode, 10), from = str(b.from), to = str(b.to);
  if (!['rickshaw', 'cng'].includes(mode)) return bad(res, 'Connector mode must be rickshaw or cng.');
  if (!db.hubs.some(h => h.id === from) || !db.hubs.some(h => h.id === to) || from === to) return bad(res, 'Pick two different, known hubs.');
  if (db.connectors.some(c => c.mode === mode && ((c.from === from && c.to === to) || (c.from === to && c.to === from)))) return bad(res, 'That connector already exists.');
  const c = { id: 'c' + Math.random().toString(36).slice(2, 6), mode, from, to };
  db.connectors.push(c); D.save(); send(res, 200, { ok: true, connector: c });
}, true);
route('DELETE', /^\/api\/connectors\/([\w-]+)$/, async (req, res, m) => { const db = D.get(); db.connectors = db.connectors.filter(x => x.id !== m[1]); D.save(); send(res, 200, { ok: true }); }, true);
route('PUT', /^\/api\/landmarks\/([\w-]+)$/, async (req, res, m, b) => {
  const db = D.get();
  if (!db.hubs.some(h => h.id === m[1])) return bad(res, 'Unknown hub', 404);
  db.landmarks[m[1]] = { general: str(b.general, 140), bus: str(b.bus, 140), metro: str(b.metro, 140), rickshaw: str(b.rickshaw, 140) };
  D.save(); send(res, 200, { ok: true });
}, true);
route('PUT', /^\/api\/rules$/, async (req, res, m, b) => {
  const db = D.get(); const r = db.rules; const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : d);
  r.bus.perKm = n(b.busPerKm, 0.5, 10, r.bus.perKm); r.bus.floor = n(b.busFloor, 1, 50, r.bus.floor); r.bus.studentDiscount = n(b.studentDiscount, 0, 0.9, r.bus.studentDiscount);
  r.surge.rushRickshaw = n(b.rushRickshaw, 1, 3, r.surge.rushRickshaw); r.surge.rainRickshaw = n(b.rainRickshaw, 1, 3, r.surge.rainRickshaw);
  D.save(); send(res, 200, { ok: true, rules: r });
}, true);
route('POST', /^\/api\/reset$/, async (req, res) => { D.reset(); send(res, 200, { ok: true }); }, true);

// ---- rides
route('GET', /^\/api\/rides$/, async (req, res) => send(res, 200, { ok: true, rides: rides.list(D.get()) }));
route('POST', /^\/api\/rides$/, async (req, res, m, b) => { const r = rides.create(D.get(), { ...b, hub: str(b.hub), dest: str(b.dest), name: str(b.name, 24) }); if (r.ok) D.save(); send(res, r.ok ? 200 : 422, r); });
route('POST', /^\/api\/rides\/([\w-]+)\/join$/, async (req, res, m, b) => { const r = rides.join(D.get(), m[1], b.name); if (r.ok) D.save(); send(res, r.ok ? 200 : 409, r); });
route('POST', /^\/api\/rides\/([\w-]+)\/message$/, async (req, res, m, b) => { const r = rides.message(D.get(), m[1], b.name, b.text); if (r.ok) D.save(); send(res, r.ok ? 200 : 422, r); });

function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/')) return serveStatic(req, res);
    for (const r of R) {
      if (r.method !== req.method) continue;
      const m = url.match(r.re);
      if (!m) continue;
      if (r.admin && !isAdmin(req)) return bad(res, 'Admin PIN required.', 403);
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      return await r.fn(req, res, m, body);
    }
    bad(res, 'Unknown endpoint', 404);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) bad(res, e.message || 'Server error', 500);
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`DhakaPath running at http://localhost:${PORT}`);
    console.log(`AI: ${llm.provider() || 'none (rule-based Banglish parser only)'}  |  Admin PIN: ${ADMIN_PIN === 'dhaka' ? 'dhaka (default)' : 'custom'}`);
  });
}

module.exports = { server };
