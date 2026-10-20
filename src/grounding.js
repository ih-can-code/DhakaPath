// Grounding: checks AI-produced travel plans and text against the real network. Rule-based, no AI involved.
const { km } = require('./geo');
const F = require('./fares');
const E = require('./engine');
const nlp = require('./nlp');

const OUTSIDE = ['gulshan', 'bashundhara', 'tejgaon', 'rampura', 'gazipur', 'savar', 'keraniganj', 'narayanganj', 'cantonment', 'kamalapur', 'sayedabad', 'gabtoli', 'airport', 'khilgaon', 'tongi', 'demra', 'cox', 'chittagong', 'sylhet'];

// plan: { legs: [{ mode, line, from, to, fare }] }
function groundPlan(db, plan) {
  const g = E.getGraph(db);
  const legs = (plan && Array.isArray(plan.legs) ? plan.legs : []).map(leg => {
    const issues = [];
    const from = nlp.resolveHub(leg.from, db.hubs);
    const to = nlp.resolveHub(leg.to, db.hubs);
    if (!from) issues.push(`Hub "${leg.from}" is not in the network.`);
    if (!to) issues.push(`Hub "${leg.to}" is not in the network.`);
    const mode = String(leg.mode || '').toLowerCase();
    if (!['bus', 'metro', 'leguna', 'rickshaw', 'cng', 'walk'].includes(mode)) issues.push(`Mode "${leg.mode}" does not exist.`);
    let edge = null;
    if (from && to && issues.length === 0) {
      if (['bus', 'metro', 'leguna'].includes(mode)) {
        const q = String(leg.line || '').toLowerCase().trim();
        const line = db.lines.find(l => l.status !== 'unverified' && (l.id.toLowerCase() === q || l.name.toLowerCase() === q || (q && l.name.toLowerCase().includes(q))));
        if (!line) issues.push(`Line "${leg.line}" does not exist.`);
        else if (line.mode !== mode) issues.push(`"${line.name}" is a ${line.mode} line, not ${mode}.`);
        else {
          if (!line.stops.includes(from)) issues.push(`"${line.name}" does not stop at ${g.hubMap[from].name}.`);
          if (!line.stops.includes(to)) issues.push(`"${line.name}" does not stop at ${g.hubMap[to].name}.`);
          if (!issues.length) edge = g.edges.find(e => e.lineId === line.id && e.from === from && e.to === to);
        }
      } else if (mode === 'walk') {
        edge = g.edges.find(e => e.mode === 'walk' && e.from === from && e.to === to);
        if (!edge) issues.push(`${g.hubMap[from].name} to ${g.hubMap[to].name} is too far to walk.`);
      } else {
        edge = g.edges.find(e => e.mode === mode && e.from === from && e.to === to);
        if (!edge) issues.push(`No ${mode} link between ${g.hubMap[from].name} and ${g.hubMap[to].name} in the network.`);
      }
    }
    let expected = null;
    if (edge && leg.fare != null && leg.fare !== '') {
      const f = F.legFare(edge, { rules: db.rules, rush: true, rainOn: true });
      const b = F.legFare(edge, { rules: db.rules });
      expected = { lo: b.base.lo, hi: Math.max(b.base.hi, f.regular.hi) };
      const fare = Number(leg.fare);
      if (!(fare >= expected.lo * 0.8 - 2 && fare <= expected.hi * 1.25 + 2)) issues.push(`Fare ৳${leg.fare} does not match the fare rule (৳${expected.lo}-${expected.hi}).`);
    }
    return { input: leg, ok: issues.length === 0, issues, expected, edgeId: edge ? edge.id : null };
  });
  const ok = legs.length > 0 && legs.every(l => l.ok);
  return { ok, legs, verified: legs.filter(l => l.ok).length, total: legs.length };
}

// allowed: { fares: number[], mins: number[] }. Checks numbers and places in free text produced by an AI.
function groundText(text, allowed) {
  const issues = [];
  const low = String(text || '').toLowerCase();
  const nums = s => s.split(/[–-]/).map(Number).filter(Number.isFinite);
  for (const m of low.matchAll(/(?:৳|bdt\s?|tk\.?\s?)(\d+(?:\s?[–-]\s?\d+)?)|(\d+(?:\s?[–-]\s?\d+)?)\s*(?:taka|tk|bdt)\b/g)) {
    for (const n of nums((m[1] || m[2]).replace(/\s/g, ''))) {
      if (!allowed.fares.some(a => Math.abs(a - n) <= 2)) issues.push(`Fare ৳${n} is not in the verified data.`);
    }
  }
  for (const m of low.matchAll(/(\d+(?:\s?[–-]\s?\d+)?)\s*min/g)) {
    for (const n of nums(m[1].replace(/\s/g, ''))) {
      if (!allowed.mins.some(a => Math.abs(a - n) <= 1)) issues.push(`${n} minutes is not in the verified data.`);
    }
  }
  for (const p of OUTSIDE) if (new RegExp(`\\b${p}\\b`).test(low) && !(allowed.places || []).includes(p)) issues.push(`"${p}" is outside the DhakaPath network.`);
  return { ok: issues.length === 0, issues };
}

// A deliberately wrong plan for the live "hallucination test".
function fakePlan() {
  return {
    note: 'Pretend an AI wrote this plan.',
    legs: [
      { mode: 'bus', line: 'Express 99', from: 'Mirpur', to: 'Gulshan', fare: 15 },
      { mode: 'metro', line: 'MRT Line-6', from: 'Mirpur', to: 'Motijheel', fare: 60 },
      { mode: 'rickshaw', line: '', from: 'Uttara', to: 'Jatrabari', fare: 20 },
    ],
  };
}

// Built from the live graph so the fares always match the current fare rules.
function realPlan(db) {
  const g = E.getGraph(db);
  const mk = (id, mode, line, from, to) => {
    const e = g.byId[`${id}:${from}>${to}`];
    return { mode, line, from: g.hubMap[from].name, to: g.hubMap[to].name, fare: e ? F.legFare(e, { rules: db.rules }).regular.lo : undefined };
  };
  return {
    note: 'A plan that matches the network.',
    legs: [mk('mrt6', 'metro', 'MRT Line-6', 'mirpur', 'farmgate'), mk('b-mirpur-moti', 'bus', 'Mirpur-Motijheel Express', 'farmgate', 'motijheel')],
  };
}

module.exports = { groundPlan, groundText, fakePlan, realPlan, OUTSIDE };
