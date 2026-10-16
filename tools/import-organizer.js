// Builds data/organizer-build.json from the organizer's map data in data/organizer/.
// Run once after the data changes:  node tools/import-organizer.js
//
// What it does:
//  1. MRT-6: all 16 stations from transit-data.json, track shape from Routemap-DhakaMetroRail.csv.
//  2. Bikolpo and Uttara buses: every stop and the exact street path of each segment.
//  3. Stops are merged with DhakaPath's 14 core hubs when they are the same place (same name, or within 250 m).
//  4. Roadmap-Dhaka.csv becomes a street graph. Walking links and rickshaw/CNG links get real road
//     distances and street-following shapes from shortest paths on that graph.
const fs = require('fs');
const path = require('path');
const { BASE } = require('../src/data');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'organizer');
const OUT = path.join(ROOT, 'data', 'organizer-build.json');

const rad = d => (d * Math.PI) / 180;
function dist(a, b) {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
const plen = pts => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);
const r5 = x => Math.round(x * 1e5) / 1e5;
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const slug = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Ramer-Douglas-Peucker, so shapes stay light without losing their look (tolerance in km).
function simplify(pts, tol = 0.012) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const off = (p, a, b) => {
    const k = Math.cos(rad(p[0])) * 111, x = (q) => q[1] * k, y = (q) => q[0] * 111;
    const dx = x(b) - x(a), dy = y(b) - y(a), L = dx * dx + dy * dy;
    let t = L ? ((x(p) - x(a)) * dx + (y(p) - y(a)) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(x(p) - (x(a) + t * dx), y(p) - (y(a) + t * dy));
  };
  while (stack.length) {
    const [s, e] = stack.pop(); let idx = -1, md = 0;
    for (let i = s + 1; i < e; i++) { const d = off(pts[i], pts[s], pts[e]); if (d > md) { md = d; idx = i; } }
    if (md > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]).map(p => [r5(p[0]), r5(p[1])]);
}

// Spelling variants used in the organizer CSV labels and by commuters.
const EXTRA = {
  'Shyamoli': ['shamoli'], 'Shishu Mela': ['sisu mela', 'sisumela', 'shishumela'], 'Asad Gate': ['asadgate', 'asad gate'],
  'Kalyan Pur': ['kalyanpur', 'kollanpur', 'kallyanpur'], 'Mirpur 1': ['mirpur-1', 'mirpur1'], 'Mirpur 11': ['mirpur-11', 'mirpur11', 'purobi hall'],
  'Labaid': ['lab aid'], 'MES Bus Stop': ['mes bus stop', 'mes busstop'], 'Jashim Uddin': ['jasim uddin', 'jashimuddin'],
  'Shewrapara': ['shewra para', 'sheorapara'], 'Bangladesh Secretariat': ['secretariat', 'sachibaloy'], 'Karwan Bazar': ['kawran bazar', 'karwan bazaar', 'sonargaon'],
  'Bijoy Sarani': ['bijoy sharani'], 'Pallabi': ['mirpur 12', 'mirpur12'], 'Uttara North': ['diabari'], 'Darussalam': ['darus salam'],
  'Dhaka University': ['dhaka university', 'dhaka uni'], 'Kakrail': ['kakrail'], 'Rajlokkhi': ['rajlakshmi', 'rajlokkhi'],
};

// ---------------- hubs ----------------
const hubs = BASE.HUBS.map(h => ({ ...h, aliases: [...h.aliases], major: true, source: 'core' }));
const byId = id => hubs.find(h => h.id === id);
function addAlias(h, name) { const a = String(name).toLowerCase().trim(); if (a && !h.aliases.includes(a)) h.aliases.push(a); }

function findMatch(name, lat, lng) {
  const n = norm(name);
  const named = hubs.find(h => norm(h.name) === n || h.aliases.some(a => norm(a) === n));
  if (named && dist([named.lat, named.lng], [lat, lng]) < 1.6) return named;
  let best = null, bd = Infinity;
  for (const h of hubs) { const d = dist([h.lat, h.lng], [lat, lng]); if (d < bd) { bd = d; best = h; } }
  return bd < 0.25 ? best : null;
}

function place(name, lat, lng, { major = false, prefer = false, forceId = null } = {}) {
  let h = forceId ? byId(forceId) : findMatch(name, lat, lng);
  if (h) {
    addAlias(h, name);
    (EXTRA[name] || []).forEach(a => addAlias(h, a));
    if ((prefer || (h.source === 'core' && !h.fixed))) { h.lat = r5(lat); h.lng = r5(lng); h.fixed = true; }
    if (major) h.major = true;
    if (h.source === 'core') h.source = 'core+organizer';
    return h.id;
  }
  let id = slug(name);
  while (byId(id)) id += '-x';
  h = { id, name, lat: r5(lat), lng: r5(lng), aliases: [name.toLowerCase(), ...(EXTRA[name] || [])], major, source: 'organizer', fixed: true };
  hubs.push(h);
  return id;
}

// ---------------- read organizer data ----------------
const transit = JSON.parse(fs.readFileSync(path.join(SRC, 'transit-data.json'), 'utf8'));
function readRoute(file) {
  return fs.readFileSync(path.join(SRC, file), 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const parts = line.split(',');
    const nums = [], names = [];
    for (const p of parts.slice(1)) { const v = Number(p); if (p.trim() !== '' && Number.isFinite(v)) nums.push(v); else names.push(p.trim()); }
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i + 1], nums[i]]); // CSV is lng,lat
    return { pts, names };
  });
}

// ---------------- MRT-6 ----------------
const METRO_MERGE = { uttara_center: 'uttara', mirpur10: 'mirpur', agargaon: 'agargaon', farmgate: 'farmgate', shahbagh: 'shahbagh', motijheel: 'motijheel' };
const metroIds = transit.metro.stations.map(s => place(s.name, s.lat, s.lng, { major: true, prefer: true, forceId: METRO_MERGE[s.id] || null }))
  .filter((id, i, a) => i === 0 || a[i - 1] !== id);
// one continuous track shape from the CSV rows, each row turned to continue from the previous end
const rows = readRoute('Routemap-DhakaMetroRail.csv');
let track = rows[0].pts.slice();
for (const r of rows.slice(1)) {
  const end = track[track.length - 1];
  const p = dist(end, r.pts[0]) <= dist(end, r.pts[r.pts.length - 1]) ? r.pts : r.pts.slice().reverse();
  track = track.concat(p.slice(1));
}
if (dist(track[0], [23.73, 90.42]) < dist(track[track.length - 1], [23.73, 90.42])) track.reverse(); // north to south
const nearestIdx = (pts, q) => { let bi = 0, bd = Infinity; pts.forEach((p, i) => { const d = dist(p, q); if (d < bd) { bd = d; bi = i; } }); return [bi, bd]; };
const metroSegs = [];
for (let i = 0; i < metroIds.length - 1; i++) {
  const A = byId(metroIds[i]), B = byId(metroIds[i + 1]);
  const [ia, da] = nearestIdx(track, [A.lat, A.lng]);
  const [ib, db] = nearestIdx(track, [B.lat, B.lng]);
  const geom = da < 0.35 && db < 0.35 && ia < ib ? [[A.lat, A.lng], ...track.slice(ia, ib + 1), [B.lat, B.lng]] : [[A.lat, A.lng], [B.lat, B.lng]];
  metroSegs.push({ km: Math.round(plen(geom) * 1000) / 1000, geom: simplify(geom, 0.006), shape: geom.length > 2 ? 'track' : 'straight' });
}
const metro = { id: 'mrt6', mode: 'metro', name: 'MRT Line-6', stops: metroIds, segs: metroSegs, source: 'organizer', status: 'verified', confirms: [] };

// ---------------- buses ----------------
const busLines = transit.buses.map(b => {
  const ids = b.stops.map(s => place(s.name, s.lat, s.lng));
  const stops = [ids[0]], segs = [];
  let carry = [];
  b.segments.forEach((sg, k) => {
    const from = b.stops[k];
    let geom = sg.coordinates.map(c => [c[0], c[1]]);
    if (dist(geom[0], [from.lat, from.lng]) > dist(geom[geom.length - 1], [from.lat, from.lng])) geom.reverse();
    const a = ids[k], c = ids[k + 1];
    if (a === c) { carry = carry.concat(geom); return; } // both stops merged into one place
    const full = carry.concat(geom); carry = [];
    if (stops.includes(c)) return; // never loop back to a place already on this line
    stops.push(c);
    segs.push({ km: Math.round(plen(full) * 1000) / 1000, geom: simplify(full, 0.006) });
  });
  return { id: `o-${b.id}`, mode: 'bus', name: `${b.name} bus`, stops, segs, source: 'organizer', status: 'verified', confirms: [] };
});

// ---------------- street graph ----------------
const t0 = Date.now();
const key = new Map(), coords = [], adj = [];
const nid = (lat, lng) => { const k = lat.toFixed(5) + ',' + lng.toFixed(5); let i = key.get(k); if (i === undefined) { i = coords.length; key.set(k, i); coords.push([lat, lng]); adj.push([]); } return i; };
let roadKm = 0, roadRows = 0;
for (const line of fs.readFileSync(path.join(SRC, 'Roadmap-Dhaka.csv'), 'utf8').split(/\r?\n/)) {
  if (!line) continue;
  const v = line.split(',').slice(1).map(Number);
  const c = v.slice(0, -2);
  roadRows++; roadKm += v[v.length - 1] || 0;
  let prev = -1;
  for (let i = 0; i + 1 < c.length; i += 2) {
    const n = nid(c[i + 1], c[i]);
    if (prev >= 0 && prev !== n) { const w = dist(coords[prev], coords[n]); adj[prev].push(n, w); adj[n].push(prev, w); }
    prev = n;
  }
}
// connected parts of the street graph; places snap to the biggest one so every route can reach every other
const comp = new Int32Array(coords.length).fill(-1); const compSize = [];
for (let i = 0; i < coords.length; i++) {
  if (comp[i] >= 0) continue;
  const c = compSize.length; let n = 0; const st = [i]; comp[i] = c;
  while (st.length) { const u = st.pop(); n++; const a = adj[u]; for (let k = 0; k < a.length; k += 2) if (comp[a[k]] < 0) { comp[a[k]] = c; st.push(a[k]); } }
  compSize.push(n);
}
const giant = compSize.indexOf(Math.max(...compSize));
function snap(h) { let bi = -1, bd = Infinity; for (let i = 0; i < coords.length; i++) { if (comp[i] !== giant) continue; const d = dist(coords[i], [h.lat, h.lng]); if (d < bd) { bd = d; bi = i; } } return [bi, bd]; }
const snaps = Object.fromEntries(hubs.map(h => [h.id, snap(h)]));

// binary-heap Dijkstra, stops at `cut` km
function dijkstra(src, cut) {
  const d = new Float64Array(coords.length).fill(Infinity), prev = new Int32Array(coords.length).fill(-1);
  const heap = [[0, src]]; d[src] = 0;
  const push = x => { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [du, u] = pop();
    if (du > d[u] || du > cut) continue;
    const a = adj[u];
    for (let k = 0; k < a.length; k += 2) { const v = a[k], nd = du + a[k + 1]; if (nd < d[v]) { d[v] = nd; prev[v] = u; push([nd, v]); } }
  }
  return { d, prev };
}
const pathTo = (prev, t) => { const p = []; for (let x = t; x >= 0; x = prev[x]) p.push(coords[x]); return p.reverse(); };

const road = {}; // "a>b" -> {km, geom}
function roadBetween(aId, bId, res) {
  const [sa, da] = snaps[aId], [sb, db] = snaps[bId];
  if (da > 2.2 || db > 2.2 || !Number.isFinite(res.d[sb])) return null;
  const A = byId(aId), B = byId(bId);
  const geom = [[A.lat, A.lng], ...pathTo(res.prev, sb), [B.lat, B.lng]];
  return { km: Math.round((res.d[sb] + da + db) * 1000) / 1000, geom: simplify(geom) };
}

const walks = [];
const connectors = BASE.CONNECTORS.map(c => ({ ...c }));
const results = {};
for (const h of hubs) {
  const [s, sd] = snaps[h.id];
  if (sd > 2.2) continue;
  results[h.id] = dijkstra(s, 32);
}
// walking: real street distance up to 1.4 km, at most 4 per place
for (const h of hubs) {
  const res = results[h.id];
  if (!res) continue;
  const near = hubs.filter(o => o.id !== h.id && dist([h.lat, h.lng], [o.lat, o.lng]) < 1.3)
    .map(o => ({ o, r: roadBetween(h.id, o.id, res) })).filter(x => x.r && x.r.km <= 1.4)
    .sort((x, y) => x.r.km - y.r.km).slice(0, 4);
  for (const { o, r } of near) if (!walks.some(w => (w.a === h.id && w.b === o.id) || (w.a === o.id && w.b === h.id))) walks.push({ a: h.id, b: o.id, km: r.km, geom: r.geom });
}
// rickshaw and CNG links follow real streets
let roadConn = 0;
for (const c of connectors) {
  const res = results[c.from];
  const r = res && roadBetween(c.from, c.to, res);
  if (r) { c.km = r.km; c.geom = r.geom; roadConn++; }
}

// sample bus and leguna lines (areas the organizer data does not cover) also follow real streets now
const sampleLines = BASE.LINES.filter(l => l.id !== 'mrt6' && l.stops.every(id => byId(id))).map(l => {
  const segs = [];
  for (let i = 0; i < l.stops.length - 1; i++) {
    const res = results[l.stops[i]];
    const r = res && roadBetween(l.stops[i], l.stops[i + 1], res);
    const A = byId(l.stops[i]), B = byId(l.stops[i + 1]);
    segs.push(r || { km: Math.round(dist([A.lat, A.lng], [B.lat, B.lng]) * 1.3 * 1000) / 1000, geom: [[A.lat, A.lng], [B.lat, B.lng]] });
  }
  return { ...l, segs, source: 'sample', status: 'verified', confirms: [] };
});

// rickshaws: each place gets short street-following links to its nearest neighbours (up to 3, at most 2.5 km)
const haveConn = (a, b) => connectors.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
let autoRick = 0;
for (const h of hubs) {
  const res = results[h.id];
  if (!res) continue;
  const near = hubs.filter(o => o.id !== h.id && dist([h.lat, h.lng], [o.lat, o.lng]) < 2.2)
    .map(o => ({ o, r: roadBetween(h.id, o.id, res) })).filter(x => x.r && x.r.km <= 2.5 && x.r.km > 0.5)
    .sort((x, y) => x.r.km - y.r.km).slice(0, 3);
  for (const { o, r } of near) {
    if (haveConn(h.id, o.id)) continue;
    connectors.push({ id: `r-${h.id}-${o.id}`, mode: 'rickshaw', from: h.id, to: o.id, km: r.km, geom: r.geom, auto: true });
    autoRick++;
  }
}

// street distance between every pair of places, used for fair-fare checks
const pairKm = {};
for (const a of hubs) {
  pairKm[a.id] = {};
  const res = results[a.id];
  for (const b of hubs) {
    if (a.id === b.id) continue;
    const sb = snaps[b.id];
    const d = res && Number.isFinite(res.d[sb[0]]) ? res.d[sb[0]] + snaps[a.id][1] + sb[1] : null;
    pairKm[a.id][b.id] = d == null ? Math.round(dist([a.lat, a.lng], [b.lat, b.lng]) * 1.3 * 100) / 100 : Math.round(d * 100) / 100;
  }
}

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  note: transit.sources && transit.sources.note,
  sources: transit.sources,
  hubs: hubs.map(({ fixed, ...h }) => h),
  lines: [metro, ...busLines, ...sampleLines],
  roadKm: pairKm,
  connectors,
  walks,
  stats: {
    hubs: hubs.length, newPlaces: hubs.filter(h => h.source === 'organizer').length,
    metroStations: metroIds.length, metroTrackSegments: metroSegs.filter(s => s.shape === 'track').length,
    buses: busLines.map(b => ({ id: b.id, stops: b.stops.length })),
    roadRows, roadNodes: coords.length, roadKm: Math.round(roadKm),
    walks: walks.length, roadConnectors: `${roadConn}/${connectors.length}`,
    worstSnapKm: Math.round(Math.max(...Object.values(snaps).map(s => s[1])) * 1000) / 1000,
    streetParts: compSize.length, giantPart: compSize[giant], autoRickshawLinks: autoRick,
    farFromRoads: Object.entries(snaps).filter(([, s]) => s[1] > 0.45).map(([id, s]) => `${id} ${s[1].toFixed(2)}km`),
    straightConnectors: connectors.filter(c => !c.geom).map(c => `${c.mode} ${c.from}-${c.to}`),
    buildMs: Date.now() - t0,
  },
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('Wrote', path.relative(ROOT, OUT), `(${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
console.log(JSON.stringify(out.stats, null, 1));
