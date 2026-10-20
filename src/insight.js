// Plain-language insights: why a route is recommended, and a short "Today in Dhaka" summary.
// Both are built from verified data first. If a free AI key is set, the AI rewrites the sentence,
// and the rewrite is only used when every number and place in it checks out.
const E = require('./engine');
const A = require('./alerts');
const llm = require('./llm');
const G = require('./grounding');

const ALERT_WORD = { waterlogging: 'waterlogging', gridlock: 'a bad jam', blockade: 'a blocked junction', construction: 'road work' };
const list = arr => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);

function whyFacts(db, result, o) {
  const g = E.getGraph(db);
  const name = h => g.hubMap[h].name;
  const sc = result.scenario || {};
  const opts = result.options;
  const q = result.query;
  const reasons = [];
  if ((sc.blocked || []).length) reasons.push(`it goes around the blocked ${list(sc.blocked.map(name))} junction`);
  const fastest = opts.every(x => x.totals.min.mid >= o.totals.min.mid);
  const cheapest = opts.every(x => E.costMid(x, q.student) >= E.costMid(o, q.student));
  const steadiest = opts.every(x => x.totals.min.hi - x.totals.min.mid >= o.totals.min.hi - o.totals.min.mid);
  if (fastest) reasons.push('it is the fastest');
  if (cheapest) reasons.push('it is the cheapest');
  if (steadiest && !fastest) reasons.push('its arrival time is the most predictable');
  if (o.transfers === 0) reasons.push('there are no changes');
  const metro = o.legs.some(l => l.mode === 'metro');
  if (metro && ((sc.traffic || 0) >= 0.55 || sc.rain)) reasons.push(`the metro runs above the ${sc.rain ? 'flooded roads' : 'traffic'}`);
  const myAlerts = new Set(o.legs.flatMap(l => l.alerts.map(a => a.id)));
  const dodged = [];
  opts.forEach(x => x.legs.forEach(l => l.alerts.forEach(a => { if (!myAlerts.has(a.id) && !dodged.find(d => d.id === a.id)) dodged.push(a); })));
  if (dodged.length) reasons.push(`it avoids ${list(dodged.slice(0, 2).map(a => `${ALERT_WORD[a.type]} at ${name(a.hub)}`))}`);
  const save = Math.round(E.costMid(o, false) - E.costMid(o, true));
  if (q.student && save > 0) reasons.push(`your student fare saves about ${save} taka`);
  if (!reasons.length) reasons.push('it has the best balance of time, cost and changes');
  const text = `${o.summary} is the best pick because ${list(reasons.slice(0, 3))}.`;
  return { text, reasons };
}

function allowed(result) {
  const fares = [], mins = [];
  for (const o of result.options) {
    ['regular', 'student', 'baseRegular'].forEach(k => fares.push(o.totals.fare[k].lo, o.totals.fare[k].hi));
    mins.push(o.totals.min.lo, o.totals.min.mid, o.totals.min.hi);
    fares.push(Math.round(E.costMid(o, false) - E.costMid(o, true)));
  }
  return { fares, mins };
}

async function whyRoute(db, result, o, lang = 'en', fast = false) {
  const base = whyFacts(db, result, o);
  if (fast || !llm.provider()) return { text: base.text, ai: false };
  const f = o.totals.fare.regular;
  const facts = `${base.text}\nRoute: ${o.summary}, ${o.totals.min.lo} to ${o.totals.min.hi} min, fare ${f.lo === f.hi ? f.lo : `${f.lo} to ${f.hi}`} taka.`;
  const ai = await llm.withDeadline(llm.answer('In one short friendly sentence, tell a commuter why this route is recommended.', facts, lang), 12000);
  if (ai && G.groundText(ai, allowed(result)).ok && ai.length < 260) return { text: ai.trim(), ai: true };
  return { text: base.text, ai: false, note: ai ? 'AI wording did not pass the checks' : undefined };
}

// ---- Today in Dhaka
let todayCache = { at: 0, key: '', value: null };

function todayFacts(db, now = Date.now()) {
  const d = new Date(now);
  const min = d.getHours() * 60 + d.getMinutes();
  const traffic = E.trafficAt(min);
  const label = E.trafficLabel(traffic);
  let calmAt = null;
  if (traffic >= 0.55) for (let m = Math.ceil((min + 1) / 15) * 15; m < min + 6 * 60; m += 15) { if (E.trafficAt(m) < 0.55) { calmAt = m; break; } }
  const act = A.activeAlerts(db, now, A.ACTIVE_MIN).sort((a, b) => b.conf - a.conf);
  const g = E.getGraph(db);
  const items = act.slice(0, 3).map(a => `${ALERT_WORD[a.type]} at ${g.hubMap[a.hub].name}`);
  let text = `${label} right now${calmAt ? `, easing around ${E.fmtClock(calmAt)}` : ''}. `;
  text += act.length ? `${act.length} problem${act.length > 1 ? 's' : ''} on the roads: ${list(items)}.` : 'No confirmed problems on the roads.';
  if (act.some(a => a.type === 'waterlogging')) text += ' Leave a little early if you pass through.';
  const w = require('./live').cachedWeather();
  if (w) text += ` ${w.summary}`;
  return { text, traffic, label, alerts: act.length, min };
}

// Answers instantly from data. The AI rewrite runs in the background and is served once it is ready.
let todayJob = null;
async function today(db, now = Date.now()) {
  const f = todayFacts(db, now);
  const key = `${f.label}|${f.alerts}|${f.text}`;
  if (todayCache.value && todayCache.key === key && now - todayCache.at < 5 * 60000) return todayCache.value;
  if (llm.provider() && !todayJob) {
    todayJob = (async () => {
      const ai = await llm.withDeadline(llm.answer('Rewrite this as a calm, friendly two-sentence update for Dhaka commuters. Keep every place and time exactly.', f.text, 'en'), 30000);
      if (ai && G.groundText(ai, { fares: [], mins: [] }).ok && ai.length < 280) todayCache = { at: Date.now(), key, value: { ...f, text: ai.trim(), ai: true } };
    })().finally(() => { todayJob = null; });
  }
  return { ...f, ai: false, pending: !!todayJob };
}

module.exports = { whyFacts, whyRoute, todayFacts, today };
