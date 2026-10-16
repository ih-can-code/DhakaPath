// Fare rules. All numbers are ASSUMED sample values: verify against BRTA / MRT-6 charts before real use.
const DEFAULT_RULES = {
  bus: { perKm: 2.45, floor: 10, studentDiscount: 0.5 },
  leguna: { perKm: 2.2, floor: 10 },
  metro: { perKm: 5, min: 20, max: 100 },
  rickshaw: { loKm: 14, hiKm: 22, minLo: 20, minHi: 30 },
  cng: { baseLo: 40, baseHi: 50, loKm: 14, hiKm: 24 },
  surge: { rushRickshaw: 1.2, rainRickshaw: 1.6, rushCng: 1.15, rainCng: 1.4, floodReported: 1.25, cap: 2 },
};

const FLEX = new Set(['rickshaw', 'cng']);
const r5 = n => Math.round(n / 5) * 5;

// traffic is 0 (quiet) to 1 (peak rush). Older callers pass rush: true, which means 1.
const trafficOf = ctx => (Number.isFinite(ctx.traffic) ? ctx.traffic : ctx.rush ? 1 : 0);

function surgeFactor(mode, rules, ctx) {
  const s = rules.surge;
  let f = 1;
  const tr = trafficOf(ctx);
  if (tr > 0) f *= 1 + ((mode === 'cng' ? s.rushCng : s.rushRickshaw) - 1) * tr;
  if (ctx.rainOn) f *= mode === 'cng' ? s.rainCng : s.rainRickshaw;
  else if (ctx.flood) f *= s.floodReported;
  return Math.min(f, s.cap);
}

function baseRange(mode, km, rules) {
  if (mode === 'rickshaw') {
    const r = rules.rickshaw;
    return { lo: r5(Math.max(r.minLo, km * r.loKm)), hi: r5(Math.max(r.minHi, km * r.hiKm)) };
  }
  const c = rules.cng;
  return { lo: r5(c.baseLo + km * c.loKm), hi: r5(c.baseHi + km * c.hiKm) };
}

// edge: { mode, km }. ctx: { rules, rush, rainOn, flood }
function legFare(edge, ctx) {
  const rules = ctx.rules || DEFAULT_RULES;
  const m = edge.mode;
  if (m === 'bus') {
    const r = rules.bus;
    const f = Math.max(r.floor, Math.round(edge.km * r.perKm));
    const s = Math.max(r.floor, Math.round(f * (1 - r.studentDiscount)));
    return {
      base: { lo: f, hi: f }, regular: { lo: f, hi: f }, student: { lo: s, hi: s },
      studentApplies: true, studentSaves: f - s,
      rule: `Bus: ৳${r.perKm}/km, minimum ৳${r.floor}. Students pay ${Math.round(r.studentDiscount * 100)}% off, never below ৳${r.floor}.`,
    };
  }
  if (m === 'leguna') {
    const r = rules.leguna;
    const f = Math.max(r.floor, Math.round(edge.km * r.perKm));
    return {
      base: { lo: f, hi: f }, regular: { lo: f, hi: f }, student: { lo: f, hi: f },
      studentApplies: false, studentSaves: 0, rule: 'Leguna: no student discount.',
    };
  }
  if (m === 'metro') {
    const r = rules.metro;
    const f = Math.min(r.max, Math.max(r.min, r5(edge.km * r.perKm)));
    return {
      base: { lo: f, hi: f }, regular: { lo: f, hi: f }, student: { lo: f, hi: f },
      studentApplies: false, studentSaves: 0, rule: 'MRT-6: distance-based fare, no student discount.',
    };
  }
  if (FLEX.has(m)) {
    const base = baseRange(m, edge.km, rules);
    const f = surgeFactor(m, rules, ctx);
    const cur = { lo: r5(base.lo * f), hi: r5(base.hi * f) };
    const why = [];
    const tr = trafficOf(ctx);
    if (tr >= 0.85) why.push('rush hour'); else if (tr >= 0.25) why.push('busy roads');
    if (ctx.rainOn) why.push('heavy rain');
    else if (ctx.flood) why.push('reported waterlogging');
    return {
      base, regular: cur, student: cur, studentApplies: false, studentSaves: 0, surge: f > 1 ? f : 1,
      rule: `${m === 'cng' ? 'CNG' : 'Rickshaw'}: not metered, so a range. No student discount.` +
        (why.length ? ` Surge x${f.toFixed(2)} (${why.join(' + ')}).` : ' No surge right now.'),
    };
  }
  return {
    base: { lo: 0, hi: 0 }, regular: { lo: 0, hi: 0 }, student: { lo: 0, hi: 0 },
    studentApplies: false, studentSaves: 0, rule: 'Walking is free.',
  };
}

// Plain-language fare rules for the chat assistant and Trust lab.
function explain(rules, topic) {
  const b = rules.bus;
  const T = {
    student: `Students get ${Math.round(b.studentDiscount * 100)}% off on buses only, and a bus fare never drops below ৳${b.floor}. Metro, leguna, rickshaw and CNG have no student discount.`,
    floor: `The minimum bus fare is ৳${b.floor}. A student fare is also never below ৳${b.floor}, so a ৳10 ride costs ৳10 for everyone.`,
    surge: `Rickshaw and CNG are not metered, so DhakaPath shows a range. Rush hour adds about ${Math.round((rules.surge.rushRickshaw - 1) * 100)}% and heavy rain about ${Math.round((rules.surge.rainRickshaw - 1) * 100)}% for rickshaws (CNG: ${Math.round((rules.surge.rushCng - 1) * 100)}% and ${Math.round((rules.surge.rainCng - 1) * 100)}%). The total is capped at x${rules.surge.cap}.`,
    metro: `MRT-6 fares depend on distance (about ৳${rules.metro.min} to ৳${rules.metro.max}) and have no student discount.`,
  };
  return T[topic] || null;
}

// Range of a fair fare for a flexible-mode trip of `km`, used by ride-share and fare checks.
function flexRange(mode, km, rules, ctx) {
  const e = { mode, km };
  const f = legFare(e, { rules, ...ctx });
  return { base: f.base, now: f.regular, surge: f.surge || 1 };
}

// Street distance between two places from the organizer MapData (falls back to straight line x 1.3).
function roadDistance(db, from, to) {
  const d = db.roadKm && db.roadKm[from] && db.roadKm[from][to];
  if (d) return { km: d, source: 'MapData street network' };
  const { km } = require('./geo');
  const a = db.hubs.find(h => h.id === from), b = db.hubs.find(h => h.id === to);
  return { km: Math.round(km(a, b) * 1.3 * 100) / 100, source: 'estimate' };
}

// Fair price for each way of making one trip, so a commuter can compare and is not overcharged.
function compareFares(db, from, to, ctx = {}) {
  const rules = db.rules;
  const { km, source } = roadDistance(db, from, to);
  const metro = db.lines.find(l => l.id === 'mrt6');
  let metroKm = null;
  if (metro && metro.stops.includes(from) && metro.stops.includes(to)) {
    const i = metro.stops.indexOf(from), j = metro.stops.indexOf(to);
    metroKm = metro.segs ? metro.segs.slice(Math.min(i, j), Math.max(i, j)).reduce((t, s) => t + s.km, 0) : km;
  }
  const c = { rules, traffic: ctx.traffic || 0, rainOn: !!ctx.rain };
  const item = (mode, label, k, note) => { const f = legFare({ mode, km: k }, c); return { mode, label, km: Math.round(k * 10) / 10, fare: f.regular, base: f.base, student: f.student, studentApplies: f.studentApplies, surge: f.surge || 1, note }; };
  const items = [item('bus', 'Bus', km, 'Fixed fare by distance')];
  if (metroKm) items.push(item('metro', 'MRT-6', metroKm, 'Both places are on the metro'));
  items.push(item('leguna', 'Leguna', km, 'Where a leguna runs'));
  items.push(item('cng', 'CNG', km, 'Not metered, agree before the ride'));
  if (km <= 6) items.push(item('rickshaw', 'Rickshaw', km, 'Not metered, agree before the ride'));
  const flex = items.find(i => i.mode === (km <= 6 ? 'rickshaw' : 'cng'));
  const offer = Math.round(((flex.fare.lo + flex.fare.hi) / 2) / 5) * 5;
  return {
    from, to, km: Math.round(km * 10) / 10, source, items,
    haggle: { mode: flex.mode, offer, tooMuch: flex.fare.hi + 10,
      en: `Offer ${offer} taka. More than ${flex.fare.hi + 10} is too much.`,
      banglish: `Bhai, ${offer} taka dibo.`, bn: `ভাই, ${offer} টাকা দেব।` },
  };
}

module.exports = { DEFAULT_RULES, legFare, explain, flexRange, FLEX, roadDistance, compareFares };
