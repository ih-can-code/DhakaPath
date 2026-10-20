// Route graph, multi-leg search, ranking, scenarios (rain / rush / blocked), and detour comparison.
// All routes come from this deterministic graph. The AI never produces a route.
const { km: hav } = require('./geo');
const F = require('./fares');
const A = require('./alerts');

const ROAD = new Set(['bus', 'leguna', 'rickshaw', 'cng']);
const SPEED = { bus: 20, leguna: 14, rickshaw: 10, cng: 22, walk: 4.5 }; // km/h, free-flow
const ROAD_FACTOR = { bus: 1.3, leguna: 1.3, rickshaw: 1.25, cng: 1.3, walk: 1.25, metro: 1.15 };
const SPREAD = { bus: 0.22, leguna: 0.22, rickshaw: 0.25, cng: 0.25, metro: 0.06, walk: 0.08 };
const WAIT = { bus: 5, leguna: 4, metro: 4, rickshaw: 1.5, cng: 2, walk: 0 };
const ALERT_DELAY = { waterlogging: 14, gridlock: 12, construction: 6, blockade: 20 }; // minutes per severity step
const MAX_LEGS = 4;
const MODES = new Set(['bus', 'metro', 'leguna', 'rickshaw', 'cng']);

let cache = { v: -1, graph: null };

function getGraph(db) {
  if (cache.v === db._v && cache.graph) return cache.graph;
  const hubMap = Object.fromEntries(db.hubs.map(h => [h.id, h]));
  const edges = [];
  const pathKm = (stops, mode) => {
    let d = 0;
    for (let i = 0; i < stops.length - 1; i++) d += hav(hubMap[stops[i]], hubMap[stops[i + 1]]);
    return d * ROAD_FACTOR[mode];
  };
  // km and shape can come from real data (organizer street paths); otherwise straight lines times a road factor
  const mk = (mode, lineId, lineName, stops, studentEligible, real = null) => {
    const kmv = real && real.km ? real.km : pathKm(stops, mode);
    const baseMin = mode === 'metro'
      ? (kmv / 36) * 60 + 0.6 * (stops.length - 1)
      : Math.max(3, (kmv / SPEED[mode]) * 60);
    edges.push({
      id: `${lineId}:${stops[0]}>${stops[stops.length - 1]}`, mode, lineId, lineName,
      from: stops[0], to: stops[stops.length - 1], stops, km: kmv, baseMin, studentEligible,
      geom: real && real.geom ? real.geom : null,
    });
  };
  const joinGeom = parts => parts.reduce((all, g) => (all.length ? all.concat(g.slice(1)) : g.slice()), []);
  for (const line of db.lines) {
    if (line.status === 'unverified') continue;
    const s = line.stops.filter(x => hubMap[x]);
    const hasSegs = Array.isArray(line.segs) && line.segs.length === line.stops.length - 1 && s.length === line.stops.length;
    for (let i = 0; i < s.length; i++) {
      for (let j = 0; j < s.length; j++) {
        if (i === j) continue;
        const stops = i < j ? s.slice(i, j + 1) : s.slice(j, i + 1).reverse();
        let real = null;
        if (hasSegs) {
          const lo = Math.min(i, j), hi = Math.max(i, j);
          const part = line.segs.slice(lo, hi);
          const geom = joinGeom(part.map(x => x.geom));
          real = { km: part.reduce((t, x) => t + x.km, 0), geom: i < j ? geom : geom.slice().reverse() };
        }
        mk(line.mode, line.id, line.name, stops, line.mode === 'bus', real);
      }
    }
  }
  for (const c of db.connectors) {
    if (!hubMap[c.from] || !hubMap[c.to]) continue;
    const name = `${c.mode === 'cng' ? 'CNG' : 'Rickshaw'} ${hubMap[c.from].name}-${hubMap[c.to].name}`;
    const real = c.km ? { km: c.km, geom: c.geom } : null;
    mk(c.mode, c.id, name, [c.from, c.to], false, real);
    mk(c.mode, c.id, name, [c.to, c.from], false, real && { km: real.km, geom: real.geom && real.geom.slice().reverse() });
  }
  if (Array.isArray(db.walks) && db.walks.length) {
    // walking links measured on the organizer street map
    for (const w of db.walks) {
      if (!hubMap[w.a] || !hubMap[w.b]) continue;
      mk('walk', 'walk', `Walk ${hubMap[w.a].name}-${hubMap[w.b].name}`, [w.a, w.b], false, { km: w.km, geom: w.geom });
      mk('walk', 'walk', `Walk ${hubMap[w.b].name}-${hubMap[w.a].name}`, [w.b, w.a], false, { km: w.km, geom: w.geom.slice().reverse() });
    }
  } else {
    for (const a of db.hubs) {
      for (const b of db.hubs) {
        if (a.id === b.id) continue;
        if (hav(a, b) * ROAD_FACTOR.walk <= 1.6) mk('walk', 'walk', `Walk ${a.name}-${b.name}`, [a.id, b.id], false);
      }
    }
  }
  const byFrom = {};
  const byId = {};
  for (const e of edges) { (byFrom[e.from] = byFrom[e.from] || []).push(e); byId[e.id] = e; }
  cache = { v: db._v, graph: { hubMap, edges, byFrom, byId } };
  return cache.graph;
}

// Traffic level by hour of day, 0 = quiet roads, 1 = peak rush. ASSUMED shape for Dhaka, not measured data.
const TRAFFIC_BY_HOUR = [0, 0, 0, 0, 0, 0.05, 0.2, 0.6, 1, 1, 0.7, 0.5, 0.5, 0.55, 0.5, 0.55, 0.7, 0.95, 1, 0.9, 0.6, 0.4, 0.2, 0.1];
function trafficAt(minOfDay) {
  const m = ((minOfDay % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), f = (m % 60) / 60;
  return Math.round((TRAFFIC_BY_HOUR[h] * (1 - f) + TRAFFIC_BY_HOUR[(h + 1) % 24] * f) * 100) / 100;
}
const trafficLabel = t => (t >= 0.85 ? 'Rush hour' : t >= 0.55 ? 'Busy roads' : t >= 0.25 ? 'Light traffic' : 'Quiet roads');

function normScenario(s) {
  s = s || {};
  const traffic = s.traffic == null || s.traffic === '' || !Number.isFinite(Number(s.traffic)) ? null : Math.min(1, Math.max(0, Number(s.traffic)));
  return { rain: !!s.rain, rainZones: Array.isArray(s.rainZones) ? s.rainZones : [], rush: !!s.rush, blocked: Array.isArray(s.blocked) ? s.blocked : [], traffic };
}
const isActiveScenario = s => s.rain || s.rush || s.blocked.length > 0 || (s.traffic || 0) > 0.05;

// Time range, breakage and alert delays for one edge under a scenario.
function legMetrics(edge, ctx) {
  const sc = ctx.scenario;
  const road = ROAD.has(edge.mode);
  const rainOn = sc.rain && (!sc.rainZones.length || edge.stops.some(s => sc.rainZones.includes(s)));
  const blockedHub = road ? edge.stops.find(s => sc.blocked.includes(s) || ctx.hardBlocks.includes(s)) : null;
  let mid = edge.baseMin;
  const tr = sc.traffic || 0;
  mid *= road ? 1 + 0.35 * tr : edge.mode === 'metro' ? 1 + 0.1 * tr : 1;
  if (rainOn && road) mid *= 1.4;
  const hits = ctx.active.filter(a => edge.stops.includes(a.hub));
  let delay = 0;
  if (road || edge.mode === 'walk') {
    for (const a of hits) {
      const d = Math.min(30, ALERT_DELAY[a.type] * a.severity * a.conf) * (road ? 1 : 0.4);
      delay += d;
    }
  }
  mid += delay;
  const s = SPREAD[edge.mode] || 0.15;
  const lo = mid * (1 - 0.6 * s);
  const hi = mid * (1 + s) + (rainOn && road ? mid * 0.15 : 0) + delay * 0.8 + (road ? mid * 0.05 * tr : 0);
  return {
    broken: !!blockedHub, blockedHub, rainOn,
    min: { lo, mid, hi }, delay,
    alerts: hits.filter(a => road || edge.mode === 'walk').map(a => ({ id: a.id, type: a.type, hub: a.hub, conf: a.conf, severity: a.severity, label: a.label })),
  };
}

function buildCtx(db, q, now) {
  const scenario = normScenario(q.scenario);
  // Resolve traffic: explicit value wins, rush means peak, otherwise follow the arrive-by clock.
  if (scenario.traffic == null) scenario.traffic = scenario.rush ? 1 : Number.isFinite(q.arriveBy) ? trafficAt(q.arriveBy) : 0;
  scenario.trafficLabel = trafficLabel(scenario.traffic);
  const active = q.useAlerts === false ? [] : A.activeAlerts(db, now, A.ACTIVE_MIN);
  const hardBlocks = active.filter(a => a.type === 'blockade' && a.severity >= 2 && a.conf >= 0.5).map(a => a.hub);
  return { scenario, active, hardBlocks, rules: db.rules };
}

const hubName = (g, id) => (g.hubMap[id] ? g.hubMap[id].name : id);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

function landmark(db, hub, mode) {
  const l = db.landmarks[hub] || {};
  return l[mode] || l.general || '';
}

function instruction(db, g, leg, idx, prev) {
  const from = hubName(g, leg.from);
  const to = hubName(g, leg.to);
  const n = leg.stops.length - 1;
  if (leg.mode === 'walk') return `Walk from ${from} to ${to} (about ${Math.round(leg.min.mid)} min).`;
  const pickup = landmark(db, leg.from, leg.mode);
  const drop = landmark(db, leg.to, leg.mode);
  const verb = leg.mode === 'metro' ? 'Board the MRT' : leg.mode === 'bus' ? `Board "${leg.lineName}"` : leg.mode === 'leguna' ? 'Board the leguna' : `Take a ${leg.mode === 'cng' ? 'CNG' : 'rickshaw'}`;
  const head = prev ? `Transfer at ${from}. ` : '';
  const ride = ['bus', 'metro', 'leguna'].includes(leg.mode) ? ` Ride ${n} stop${n === 1 ? '' : 's'} to ${to}.` : ` Go to ${to}.`;
  return `${head}${verb} at: ${pickup || from}.${ride}${drop ? ` Get off near: ${drop}.` : ''}`;
}

function search(db, q, now = Date.now()) {
  const g = getGraph(db);
  const ctx = buildCtx(db, q, now);
  const { scenario } = ctx;
  const out = { query: q, scenario, options: [], meta: { evaluated: 0, hardBlocks: ctx.hardBlocks, activeAlerts: ctx.active.length } };
  if (!g.hubMap[q.from] || !g.hubMap[q.to]) { out.error = 'Unknown from/to hub.'; return out; }
  if (q.from === q.to) { out.error = 'Pick two different hubs.'; return out; }

  const avoid = new Set((q.avoid || []).filter(h => h !== q.from && h !== q.to));
  // travel-mode preferences: noModes are never used, mode must appear somewhere on the route
  const noModes = new Set((Array.isArray(q.noModes) ? q.noModes : []).filter(m => MODES.has(m)));
  const wantMode = MODES.has(q.mode) ? q.mode : null;
  const directKm = hav(g.hubMap[q.from], g.hubMap[q.to]);
  const kmCap = directKm * 2.2 + 5;
  const found = [];
  const visited = new Set([q.from]);

  // Depth-first search with two speed-ups for a bigger network: try edges that head towards the
  // destination first, and drop branches that cannot beat the best route found so far by a wide margin.
  const toHub = g.hubMap[q.to];
  const lb = h => (hav(g.hubMap[h], toHub) / 36) * 60; // optimistic minutes left (metro speed, straight line)
  let best = Infinity;
  const order = {};
  const edgesFrom = h => order[h] || (order[h] = (g.byFrom[h] || []).slice().sort((a, b) => hav(g.hubMap[a.to], toHub) - hav(g.hubMap[b.to], toHub)));
  const dfs = (cur, legs, kmSum, minSum) => {
    if (cur === q.to) { found.push(legs.slice()); best = Math.min(best, minSum); return; }
    if (legs.length >= MAX_LEGS) return;
    for (const e of edgesFrom(cur)) {
      if (visited.has(e.to)) continue;
      // Avoiding an intersection applies to road vehicles passing through it, and to boarding/alighting there.
      // The elevated metro passing over it does not count.
      if (avoid.size && e.stops.some((s, k) => avoid.has(s) && (ROAD.has(e.mode) || e.mode === 'walk' || k === 0 || k === e.stops.length - 1))) continue;
      const prev = legs.length ? legs[legs.length - 1].edge : null; // legs hold { edge, m }
      if (noModes.has(e.mode)) continue;
      if (prev && prev.mode === 'walk' && e.mode === 'walk') continue;
      if (prev && prev.lineId === e.lineId && e.mode !== 'walk') continue;
      if (kmSum + e.km > kmCap) continue;
      const m = legMetrics(e, ctx);
      if (m.broken) continue;
      const t = minSum + m.min.mid;
      if (t > 240) continue;
      if (t + lb(e.to) > Math.max(best * 1.8, best + 30)) continue;
      visited.add(e.to);
      legs.push({ edge: e, m });
      dfs(e.to, legs, kmSum + e.km, t);
      legs.pop();
      visited.delete(e.to);
    }
  };
  dfs(q.from, [], 0, 0);
  out.meta.evaluated = found.length;

  const seen = new Set();
  let options = [];
  for (const raw of found) {
    const sig = raw.map(l => `${l.edge.mode}:${l.edge.lineId}:${l.edge.from}>${l.edge.to}`).join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    options.push(buildOption(db, g, ctx, raw, q));
  }

  if (wantMode) {
    const before = options.length;
    options = options.filter(o => o.legs.some(l => l.mode === wantMode));
    out.meta.modeFiltered = before - options.length;
    out.meta.modeWanted = wantMode;
  }

  if (q.budget > 0) {
    const key = q.student ? 'student' : 'regular';
    const before = options.length;
    options = options.filter(o => (o.totals.fare[key].lo + o.totals.fare[key].hi) / 2 <= q.budget);
    out.meta.budgetFiltered = before - options.length;
  }

  // drop dominated options
  options = options.filter(a => !options.some(b => b !== a && dominates(b, a, q.student)));

  const sorter = {
    best: (a, b) => score(a, q.student) - score(b, q.student),
    cheapest: (a, b) => costMid(a, q.student) - costMid(b, q.student) || a.totals.min.mid - b.totals.min.mid,
    fastest: (a, b) => a.totals.min.mid - b.totals.min.mid,
    fewest: (a, b) => a.transfers - b.transfers || a.totals.min.mid - b.totals.min.mid,
    safest: (a, b) => a.totals.min.hi - b.totals.min.hi,
  }[q.sort] || ((a, b) => score(a, q.student) - score(b, q.student));
  options.sort(sorter);
  // two options with the same modes through the same hubs look identical to a commuter, so keep the better one
  const shapes = new Set();
  options = options.filter(o => { const k = `${o.summary}|${o.hubs.join('>')}`; if (shapes.has(k)) return false; shapes.add(k); return true; });
  const perType = {};
  options = options.filter(o => (perType[o.summary] = (perType[o.summary] || 0) + 1) <= 2).slice(0, 6);

  const lead = (key, f) => options.length > 1 && options.reduce((m, o) => (f(o) < f(m) ? o : m), options[0]);
  const tag = (o, t) => o && o.tags.push(t);
  tag(lead('c', o => costMid(o, q.student)), 'Cheapest');
  tag(lead('f', o => o.totals.min.mid), 'Fastest');
  tag(lead('t', o => o.transfers * 1000 + o.totals.min.mid), 'Fewest transfers');
  tag(lead('s', o => o.totals.min.hi), 'Safest arrival');

  options.forEach((o, i) => {
    o.id = `opt${i + 1}`;
    o.rank = i + 1;
    if (Number.isFinite(q.arriveBy)) o.leaveByMin = Math.round(q.arriveBy - o.totals.min.hi);
  });
  out.options = options;
  return out;
}

const costMid = (o, student) => { const f = o.totals.fare[student ? 'student' : 'regular']; return (f.lo + f.hi) / 2; };
const score = (o, student) => o.totals.min.hi + o.transfers * 4 + costMid(o, student) * 0.15;
function dominates(b, a, student) {
  const cb = costMid(b, student), ca = costMid(a, student);
  const le = cb <= ca && b.totals.min.mid <= a.totals.min.mid && b.totals.min.hi <= a.totals.min.hi && b.transfers <= a.transfers;
  const lt = cb < ca || b.totals.min.mid < a.totals.min.mid || b.totals.min.hi < a.totals.min.hi || b.transfers < a.transfers;
  return le && lt;
}

function buildOption(db, g, ctx, raw, q) {
  const sc = ctx.scenario;
  const legs = raw.map((r, i) => {
    const e = r.edge;
    const m = r.m;
    const flood = m.alerts.some(a => a.type === 'waterlogging');
    const fare = F.legFare(e, { rules: db.rules, traffic: sc.traffic, rainOn: m.rainOn, flood });
    const wait = i === 0 ? null : (() => {
      const w = WAIT[e.mode] + (sc.rain ? 3 : 0) + (ROAD.has(e.mode) ? 2 * sc.traffic : 0);
      return { lo: w * 0.6, mid: w, hi: w * 1.8 };
    })();
    return {
      edgeId: e.id, mode: e.mode, lineId: e.lineId, lineName: e.lineName, from: e.from, to: e.to, stops: e.stops, geom: e.geom || null,
      stopCount: e.stops.length - 1, km: Math.round(e.km * 10) / 10,
      min: m.min, wait, rainOn: m.rainOn, delay: Math.round(m.delay), alerts: m.alerts,
      fare, studentApplies: fare.studentApplies,
    };
  });
  legs.forEach((l, i) => { l.instruction = instruction(db, g, l, i, legs[i - 1]); });

  const time = k => sum(legs, l => l.min[k] + (l.wait ? l.wait[k] : 0));
  const fareSum = (who, k) => Math.round(sum(legs, l => l.fare[who][k]));
  const totals = {
    min: { lo: time('lo'), mid: time('mid'), hi: time('hi') },
    fare: {
      regular: { lo: fareSum('regular', 'lo'), hi: fareSum('regular', 'hi') },
      student: { lo: fareSum('student', 'lo'), hi: fareSum('student', 'hi') },
      baseRegular: { lo: Math.round(sum(legs, l => l.fare.base.lo)), hi: Math.round(sum(legs, l => l.fare.base.hi)) },
    },
  };
  totals.min.lo = Math.round(totals.min.lo); totals.min.mid = Math.round(totals.min.mid); totals.min.hi = Math.round(totals.min.hi);
  totals.walkMin = Math.round(sum(legs.filter(l => l.mode === 'walk'), l => l.min.mid));

  const proofs = [];
  legs.forEach(l => {
    if (l.mode === 'walk') return;
    const what = ['rickshaw', 'cng'].includes(l.mode) ? `${l.lineName}: connector link exists` : `${l.lineName} serves ${hubName(g, l.from)} to ${hubName(g, l.to)} (${l.stopCount} stop${l.stopCount === 1 ? '' : 's'})`;
    proofs.push({ ok: true, kind: 'route', text: what });
  });
  const buses = legs.filter(l => l.mode === 'bus');
  if (q.student && buses.length) proofs.push({ ok: true, kind: 'fare', text: `Student rule applied to ${buses.length} bus leg${buses.length > 1 ? 's' : ''}: 50% off, minimum ৳${db.rules.bus.floor}` });
  if (q.student && legs.some(l => ['metro', 'leguna', 'rickshaw', 'cng'].includes(l.mode))) proofs.push({ ok: true, kind: 'fare', text: 'No student discount on metro, leguna, rickshaw or CNG' });
  if (legs.some(l => l.fare.surge > 1)) proofs.push({ ok: true, kind: 'fare', text: 'Rickshaw/CNG surge applied (' + [sc.traffic >= 0.25 ? sc.trafficLabel.toLowerCase() : null, sc.rain ? 'rain' : null].filter(Boolean).join(' + ') + ')' });
  const seenA = new Set();
  legs.forEach(l => l.alerts.forEach(a => {
    if (seenA.has(a.id)) return;
    seenA.add(a.id);
    proofs.push({ ok: a.conf >= 0.6, warn: a.conf < 0.6, kind: 'alert', text: `${a.type} at ${hubName(g, a.hub)}: ${Math.round(a.conf * 100)}% confidence (${a.label})` });
  }));
  if (!seenA.size) proofs.push({ ok: true, kind: 'alert', text: 'No active alerts on this route' });

  return {
    legs, totals, transfers: legs.length - 1, tags: [], proofs,
    hubs: [legs[0].from, ...legs.map(l => l.to)],
    summary: legs.map(l => (l.mode === 'walk' ? 'Walk' : l.mode === 'metro' ? 'MRT-6' : l.mode === 'bus' ? 'Bus' : l.mode === 'leguna' ? 'Leguna' : l.mode === 'cng' ? 'CNG' : 'Rickshaw')).join(' + '),
  };
}

// Compare a normal day with the chosen scenario: broken segments and the detour.
function simulate(db, q, now = Date.now()) {
  const g = getGraph(db);
  // the comparison baseline is a quiet, dry, unblocked day with no alerts
  const normal = search(db, { ...q, scenario: { traffic: 0 }, useAlerts: false, arriveBy: q.arriveBy }, now);
  const scen = search(db, q, now);
  const baseBest = normal.options[0] || null;
  const scenBest = scen.options[0] || null;
  const ctx = buildCtx(db, q, now);
  const segments = [];
  if (baseBest) {
    for (const l of baseBest.legs) {
      const e = g.byId[l.edgeId];
      const m = legMetrics(e, ctx);
      if (m.broken) segments.push({ status: 'broken', leg: l, reason: `${hubName(g, m.blockedHub)} is blocked for road vehicles.` });
      else {
        const ratio = m.min.mid / Math.max(1, l.min.mid);
        if (ratio >= 1.3) segments.push({ status: 'slowed', leg: l, reason: `Takes about ${Math.round((ratio - 1) * 100)}% longer than normal.`, minNow: Math.round(m.min.mid), minNormal: Math.round(l.min.mid) });
      }
    }
  }
  const same = baseBest && scenBest && baseBest.legs.map(l => l.edgeId).join() === scenBest.legs.map(l => l.edgeId).join();
  const key = q.student ? 'student' : 'regular';
  const detour = scenBest && {
    changed: !same,
    timeDeltaMid: baseBest ? scenBest.totals.min.mid - baseBest.totals.min.mid : null,
    timeDeltaHi: baseBest ? scenBest.totals.min.hi - baseBest.totals.min.hi : null,
    costDeltaMid: baseBest ? Math.round(costMid(scenBest, q.student) - costMid(baseBest, q.student)) : null,
    costKey: key,
  };
  return { normal, scenario: scen, baseBest, scenBest, segments, detour, active: isActiveScenario(ctx.scenario) };
}

function hubStatuses(db, now = Date.now()) {
  const act = A.activeAlerts(db, now, A.ACTIVE_MIN);
  const out = {};
  for (const h of db.hubs) {
    const al = act.filter(a => a.hub === h.id);
    let status = 'Clear';
    if (al.some(a => a.type === 'blockade' && a.severity >= 2 && a.conf >= 0.5)) status = 'Blocked';
    else if (al.some(a => a.severity >= 2)) status = 'Disrupted';
    else if (al.length) status = 'Slow';
    out[h.id] = { status, alerts: al.map(a => ({ id: a.id, type: a.type, conf: a.conf, severity: a.severity })) };
  }
  return out;
}

function fmtClock(minOfDay) {
  let m = ((Math.round(minOfDay) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

module.exports = { getGraph, search, simulate, hubStatuses, normScenario, isActiveScenario, legMetrics, buildCtx, fmtClock, ROAD_FACTOR, costMid, trafficAt, trafficLabel };
