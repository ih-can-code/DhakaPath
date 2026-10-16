// Conversational assistant (English + Banglish) with memory. Every number comes from the engine, never from the AI.
const nlp = require('./nlp');
const llm = require('./llm');
const E = require('./engine');
const A = require('./alerts');
const F = require('./fares');
const G = require('./grounding');

const sessions = new Map();
const tx = (lang, en, bn) => (lang === 'bn' ? bn : en);
const money = r => (r.lo === r.hi ? `৳${r.lo}` : `৳${r.lo}-${r.hi}`);

function session(id) {
  id = id || 'default';
  if (!sessions.has(id)) {
    if (sessions.size > 200) sessions.delete(sessions.keys().next().value);
    sessions.set(id, { last: null, pending: null, turns: 0 });
  }
  return sessions.get(id);
}

// Rules always run. If a free AI key is set, the AI result is merged in after being grounded against real hub ids.
async function understand(db, text, context) {
  const rules = nlp.parse(text, db.hubs);
  const ai = llm.provider() ? await llm.withDeadline(llm.understand(text, db.hubs, context), 3500) : null;
  if (!ai) return { ...rules, parser: 'rules', dropped: [] };
  const pick = (a, b) => (a != null ? a : b);
  return {
    ...rules,
    intent: ai.intent && ai.intent !== 'other' ? ai.intent : rules.intent,
    from: pick(ai.from, rules.from), to: pick(ai.to, rules.to), hub: pick(ai.hub, rules.hub),
    avoid: [...new Set([...rules.avoid, ...ai.avoid])],
    budget: pick(ai.budget, rules.budget), student: pick(ai.student, rules.student),
    arriveBy: pick(ai.arriveBy, rules.arriveBy), alertType: pick(ai.alertType, rules.alertType),
    severity: ai.severity || rules.severity, topic: pick(ai.topic, rules.topic),
    parser: 'ai+rules', dropped: ai.dropped,
  };
}

function legText(g, l) {
  const n = h => g.hubMap[h].name;
  const m = { metro: 'MRT-6', bus: 'Bus', leguna: 'Leguna', rickshaw: 'Rickshaw', cng: 'CNG', walk: 'Walk' }[l.mode];
  return `${m} ${n(l.from)} → ${n(l.to)}`;
}

function describe(db, o, p, lang) {
  const g = E.getGraph(db);
  const steps = o.legs.map((l, i) => `${i + 1}. ${legText(g, l)} (${Math.round(l.min.mid)} min, ${money(l.fare[p.student ? 'student' : 'regular'])})`).join('\n');
  const t = o.totals;
  const fare = money(t.fare[p.student ? 'student' : 'regular']);
  const other = money(t.fare[p.student ? 'regular' : 'student']);
  let s = tx(lang,
    `Best option: ${o.summary}. About ${t.min.lo}-${t.min.hi} min, fare ${fare}${p.student ? ` (student; regular ${other})` : ` (student ${other})`}.`,
    `Shobcheye bhalo: ${o.summary}. Somoy ${t.min.lo}-${t.min.hi} minute, bhara ${fare}${p.student ? ` (student; regular ${other})` : ` (student hole ${other})`}.`);
  if (Number.isFinite(o.leaveByMin)) s += tx(lang, ` Leave by ${E.fmtClock(o.leaveByMin)} to arrive by ${E.fmtClock(p.arriveBy)}.`, ` ${E.fmtClock(p.arriveBy)}-er moddhe pouchate ${E.fmtClock(o.leaveByMin)}-er moddhe berhon.`);
  return `${s}\n${steps}`;
}

function allowedFrom(result) {
  const fares = [], mins = [];
  for (const o of result.options) {
    for (const k of ['regular', 'student', 'baseRegular']) { fares.push(o.totals.fare[k].lo, o.totals.fare[k].hi); }
    mins.push(o.totals.min.lo, o.totals.min.mid, o.totals.min.hi);
    for (const l of o.legs) {
      for (const k of ['regular', 'student', 'base']) fares.push(l.fare[k].lo, l.fare[k].hi);
      mins.push(Math.round(l.min.lo), Math.round(l.min.mid), Math.round(l.min.hi));
    }
  }
  return { fares, mins };
}

async function narrate(db, result, p) {
  const lang = p.lang || 'en';
  if (!result.options.length) return { text: tx(lang, 'No route found. Try a bigger budget or fewer avoided hubs.', 'Kono route pawa jayni. Budget barao ba avoid kom koro.'), grounded: { checked: false } };
  const base = describe(db, result.options[0], p, lang);
  if (!llm.provider()) return { text: base, grounded: { checked: true, ok: true, usedAI: false, issues: [] } };
  const ai = await llm.withDeadline(llm.answer(p.text || 'Summarise the best route.', base, lang), 3000);
  if (!ai) return { text: base, grounded: { checked: true, ok: true, usedAI: false, issues: [] } };
  const chk = G.groundText(ai, allowedFrom(result));
  return chk.ok
    ? { text: `${ai.trim()}\n${base.split('\n').slice(1).join('\n')}`, grounded: { checked: true, ok: true, usedAI: true, issues: [] } }
    : { text: base, grounded: { checked: true, ok: false, usedAI: true, issues: chk.issues, note: 'AI wording rejected, showing verified text.' } };
}

function cardsOf(result, q) {
  return result.options.slice(0, 3).map(o => ({ id: o.id, summary: o.summary, time: `${o.totals.min.lo}-${o.totals.min.hi} min`, fare: money(o.totals.fare[q.student ? 'student' : 'regular']), tags: o.tags, transfers: o.transfers }));
}

async function doSearch(db, s, p, req, now, extra = {}) {
  const lang = p.lang;
  let from = p.from, to = p.to;
  let carried = '';
  if (to && !from && s.last && s.last.q.from && s.last.q.from !== to) { from = s.last.q.from; carried = tx(lang, ` (starting from ${db.hubs.find(h => h.id === from).name}, as before)`, ` (${db.hubs.find(h => h.id === from).name} theke, ager moto)`); }
  if (from && !to && s.last && s.last.q.to && s.last.q.to !== from) to = s.last.q.to;
  if (!from || !to) {
    return { reply: tx(lang, 'Where are you going from and to? For example: "Mirpur to Motijheel".', 'Kothay theke kothay jabe? Jemon: "Mirpur theke Motijheel".'), cards: [], chips: [] };
  }
  const sc = req.scenario || {};
  const q = {
    from, to,
    avoid: [...new Set([...(p.avoid || []), ...(extra.avoid || [])])],
    budget: p.budget || undefined,
    student: p.student != null ? p.student : s.last ? s.last.q.student : !!req.student,
    arriveBy: Number.isFinite(p.arriveBy) ? p.arriveBy : Number.isFinite(req.arriveBy) ? req.arriveBy : s.last && s.last.q.arriveBy,
    sort: 'best',
    scenario: { ...sc, rain: !!sc.rain || !!p.rain, rush: !!sc.rush || !!p.rush },
    useAlerts: req.useAlerts !== false,
  };
  const result = E.search(db, q, now);
  s.last = { q, result };
  if (!result.options.length) {
    return { reply: tx(lang, 'No route found with those limits. Try a bigger budget or avoid fewer hubs.', 'Ei shorto e kono route nai. Budget barao ba avoid kom koro.'), cards: [], chips: [], query: q };
  }
  const n = await narrate(db, result, { ...p, student: q.student, arriveBy: q.arriveBy });
  const g = E.getGraph(db);
  const notes = [];
  if (q.avoid.length) notes.push(tx(lang, `Avoiding ${q.avoid.map(h => g.hubMap[h].name).join(', ')}.`, `${q.avoid.map(h => g.hubMap[h].name).join(', ')} avoid kora hoyeche.`));
  if (q.budget) notes.push(tx(lang, `Budget ৳${q.budget} applied.`, `Budget ৳${q.budget} dhora hoyeche.`));
  const best = result.options[0];
  const nm = h => g.hubMap[h].name;
  const short = tx(lang,
    `${result.options.length} way${result.options.length === 1 ? '' : 's'} from ${nm(q.from)} to ${nm(q.to)}. Best is ${best.summary}, ${best.totals.min.lo}-${best.totals.min.hi} min.`,
    `${nm(q.from)} theke ${nm(q.to)} jabar ${result.options.length} ta upay. Shobcheye bhalo ${best.summary}, ${best.totals.min.lo}-${best.totals.min.hi} minute.`) + (carried ? carried : '') + (notes.length ? ' ' + notes.join(' ') : '');
  return { reply: n.text + (carried ? carried : '') + (notes.length ? '\n' + notes.join(' ') : ''), short, cards: cardsOf(result, q), chips: best.proofs, query: q, result, grounded: n.grounded };
}

function reportFlow(db, s, p, req, now, save) {
  const lang = p.lang;
  const d = s.pending && s.pending.kind === 'report' ? s.pending.draft : { hub: null, type: null, severity: null, text: p.text };
  if (p.hub && !d.hub) d.hub = p.hub;
  if (p.alertType && !d.type) d.type = p.alertType;
  if (p.alertType || p.intent === 'report') d.severity = d.severity || p.severity;
  if (!d.hub) { s.pending = { kind: 'report', draft: d }; return { reply: tx(lang, 'Which hub is it at? (Motijheel, Farmgate, Malibagh …)', 'Kon hub e? (Motijheel, Farmgate, Malibagh …)'), cards: [], chips: [] }; }
  if (!d.type) { s.pending = { kind: 'report', draft: d }; return { reply: tx(lang, 'What is happening there: waterlogging, gridlock, blockade or construction?', 'Ki hocche: jol jomeche, jam, rasta bondho, na construction?'), cards: [], chips: [] }; }
  // ask before filing, so a misheard word never becomes a public alert
  d.severity = d.severity || 2;
  s.pending = { kind: 'confirm', draft: d };
  const name = db.hubs.find(h => h.id === d.hub).name;
  const sev = ['', 'minor', 'medium', 'severe'][d.severity];
  return {
    reply: tx(lang, `Report ${TYPE_WORD[d.type]} at ${name} (${sev})? Say yes to send it.`, `${name} e ${TYPE_WORD[d.type]} (${sev}) report korbo? Pathate "ha" bolo.`),
    cards: [], chips: [], draft: { ...d, hubName: name, severityWord: sev },
  };
}

const TYPE_WORD = { waterlogging: 'waterlogging', gridlock: 'a bad jam', blockade: 'a blocked junction', construction: 'road work' };
const YES = /^\s*(?:yes|yeah|yep|y|ok|okay|sure|send|send it|confirm|ha|haa|han|hya|hyan|ji|thik|thik ache|pathao|হ্যাঁ|হা|ঠিক আছে|পাঠাও)\b/;
const NO = /\b(?:no|nope|cancel|thak|thaak|na|naa|forget|nevermind|na thak|না|থাক)\b/;

function submitDraft(db, s, d, req, now, save, lang) {
  s.pending = null;
  const r = A.submit(db, { type: d.type, hub: d.hub, severity: d.severity || 2, text: d.text, by: req.uid || 'chat-user' }, now);
  if (r.ok) save();
  const name = db.hubs.find(h => h.id === d.hub).name;
  let reply;
  if (!r.ok) reply = tx(lang, `I could not save that report: ${r.message}`, `Report save kora gelo na: ${r.message}`);
  else if (r.merged) reply = tx(lang, `Thanks. ${r.message}`, `Dhonnobad. ${r.message}`);
  else reply = tx(lang, `Report saved: ${TYPE_WORD[d.type]} at ${name}. ${r.message}`, `Report save hoyeche: ${name} e ${TYPE_WORD[d.type]}. ${r.message}`);
  if (r.flags && r.flags.length) reply += '\n' + r.flags.map(f => '• ' + f.msg).join('\n');
  return { reply, cards: [], chips: r.flags ? r.flags.map(f => ({ warn: true, text: f.msg })) : [], mutated: r.ok, alert: r.alert };
}

async function rerouteFlow(db, s, p, req, now) {
  const lang = p.lang;
  const g = E.getGraph(db);
  const avoid = p.avoid.length ? p.avoid : p.hub ? [p.hub] : [];
  if (!avoid.length) return { reply: tx(lang, 'Which hub is blocked or congested?', 'Kon hub e jam ba bondho?'), cards: [], chips: [] };
  const base = s.last && !p.from && !p.to ? s.last : null;
  if (!base && !(p.from && p.to)) return { reply: tx(lang, 'Tell me your trip first, for example "Mirpur to Motijheel", then I can route around it.', 'Age bolo kothay theke kothay jabe, tarpor oi hub bad diye route dibo.'), cards: [], chips: [] };
  const before = base ? base.result.options[0] : null;
  const names = avoid.map(h => g.hubMap[h].name).join(', ');
  const out = await doSearch(db, s, { ...p, from: p.from || base.q.from, to: p.to || base.q.to, avoid: [] }, req, now, { avoid });
  if (!s.last || !s.last.result.options.length) return out;
  const after = s.last.result.options[0];
  // same rule as the router: an elevated metro passing over a hub does not count, boarding or alighting there does
  const touched = before && before.legs.some(l => l.stops.some((x, k) => avoid.includes(x) && (l.mode !== 'metro' || k === 0 || k === l.stops.length - 1)));
  let head = '';
  if (before) {
    const dt = after.totals.min.mid - before.totals.min.mid;
    head = touched
      ? tx(lang, `Your earlier route passed ${names}. The detour is ${dt >= 0 ? '+' : ''}${dt} min.\n`, `Ager route ${names} diye jeto. Notun route e ${dt >= 0 ? '+' : ''}${dt} minute.\n`)
      : tx(lang, `Your earlier route did not pass ${names}, so it stays about the same.\n`, `Ager route ${names} diye jeto na, tai prai ek e thakche.\n`);
  }
  return { ...out, reply: head + out.reply, short: head.trim() + (out.short ? ' ' + out.short : '') };
}

function reliabilityFlow(db, s, p, now) {
  const lang = p.lang;
  const g = E.getGraph(db);
  const hubs = p.mentions.length ? p.mentions : [];
  const all = A.all(db, now).filter(a => a.status === 'open' && a.conf >= A.WEAK_MIN);
  const list = hubs.length ? all.filter(a => hubs.includes(a.hub)) : all.sort((a, b) => b.conf - a.conf).slice(0, 4);
  if (!list.length) return { reply: tx(lang, `No active alerts${hubs.length ? ' at ' + hubs.map(h => g.hubMap[h].name).join(', ') : ''}. Expired reports are hidden.`, 'Ekhon kono active alert nai. Purano report gulo lukano ache.'), cards: [], chips: [] };
  const lines = list.map(a => tx(lang,
    `• ${a.type} at ${g.hubMap[a.hub].name}: ${Math.round(a.conf * 100)}% (${a.label}). Reported ${a.ageMin} min ago, last confirmed ${a.sinceVerifiedMin} min ago, ${a.confirms.length} confirmation${a.confirms.length === 1 ? '' : 's'}.`,
    `• ${g.hubMap[a.hub].name} e ${a.type}: ${Math.round(a.conf * 100)}% (${a.label}). ${a.ageMin} minute age report, ${a.sinceVerifiedMin} minute age confirm, ${a.confirms.length} jon confirm koreche.`));
  const how = tx(lang, `\nHow it works: each confirmation raises confidence, and confidence halves every ${list[0].halfLifeMin} min (for ${list[0].type}) without a fresh confirmation. Flagged or unconfirmed reports stay out of route calculations.`, `\nKivabe kaj kore: confirm barle confidence bare, ar confirm na hole ${list[0].halfLifeMin} minute e adha hoye jay.`);
  return { reply: lines.join('\n') + how, cards: [], chips: list.map(a => ({ ok: a.conf >= 0.6, warn: a.conf < 0.6, text: `${a.type} at ${g.hubMap[a.hub].name}: ${Math.round(a.conf * 100)}%` })) };
}

async function fareFlow(db, s, p, now) {
  const lang = p.lang;
  const topic = p.topic;
  const parts = [];
  if (topic) parts.push(F.explain(db.rules, topic));
  else ['student', 'floor', 'surge', 'metro'].forEach(t => parts.push(F.explain(db.rules, t)));
  if (s.last && s.last.result.options.length && (!topic || topic === 'student' || topic === 'floor' || p.student != null)) {
    const o = s.last.result.options[0];
    const g = E.getGraph(db);
    const lines = o.legs.filter(l => l.mode !== 'walk').map(l => `${legText(g, l)}: regular ${money(l.fare.regular)}, student ${money(l.fare.student)}${l.studentApplies ? '' : ' (no discount on this mode)'}`);
    parts.push(tx(lang, 'On your last trip:', 'Tomar ager trip e:') + '\n' + lines.join('\n') + `\n${tx(lang, 'Total', 'Mot')}: ${tx(lang, 'regular', 'regular')} ${money(o.totals.fare.regular)}, student ${money(o.totals.fare.student)}.`);
  }
  if (!parts.filter(Boolean).length) return null;
  return { reply: parts.filter(Boolean).join('\n\n'), cards: [], chips: [] };
}

const HELP = {
  en: 'I can: find multi-leg routes and compare fares ("Mirpur to Motijheel, student, under 80 taka"), take live reports ("Farmgate e jol jomeche"), reroute around a hub ("avoid Farmgate"), and explain fare rules or how reliable an alert is.',
  bn: 'Ami ja pari: route khuje fare tulona ("Mirpur theke Motijheel, student, 80 takar moddhe"), live report neya ("Farmgate e jol jomeche"), kono hub bad diye route deya ("Farmgate avoid kore"), ar fare rule/alert reliability bujhano.',
};

async function handle(db, req, deps = {}) {
  const now = req.now || Date.now();
  const save = deps.save || (() => {});
  const text = String(req.message || '').slice(0, 400).trim();
  const s = session(req.sessionId);
  s.turns++;
  if (!text) return { reply: HELP.en, cards: [], chips: [], parser: 'rules' };

  if (s.pending && s.pending.kind === 'confirm') {
    const t = nlp.norm(text);
    const lang = nlp.detectLang(t);
    if (YES.test(t)) return { ...submitDraft(db, s, s.pending.draft, req, now, save, lang), parser: 'rules', intent: 'report' };
    if (NO.test(t)) { s.pending = null; return { reply: tx(lang, 'Okay, not sent.', 'Thik ache, pathano holo na.'), cards: [], chips: [], parser: 'rules' }; }
    s.pending = null; // anything else: treat it as a new message
  }

  const ctx = s.last ? { from: s.last.q.from, to: s.last.q.to, avoid: s.last.q.avoid, student: s.last.q.student } : {};
  const p = await understand(db, text, ctx);
  if (s.pending && /\b(?:cancel|thak|thaak|na|forget|nevermind)\b/.test(nlp.norm(text)) && !p.alertType) { s.pending = null; return { reply: tx(p.lang, 'Okay, cancelled.', 'Thik ache, cancel.'), cards: [], chips: [], parser: p.parser }; }

  let out = null;
  let intent = p.intent;
  if (s.pending && s.pending.kind === 'report' && (p.hub || p.alertType || intent === 'other')) intent = 'report';

  if (intent === 'report') out = reportFlow(db, s, p, req, now, save);
  else if (intent === 'reroute') out = await rerouteFlow(db, s, p, req, now);
  else if (intent === 'route') out = await doSearch(db, s, p, req, now);
  else if (intent === 'reliability') out = reliabilityFlow(db, s, p, now);
  else if (intent === 'fare_question') out = await fareFlow(db, s, p, now);
  else if (intent === 'greeting') out = { reply: HELP[p.lang], cards: [], chips: [] };

  if (!out && llm.provider()) {
    const g = E.getGraph(db);
    const facts = `Hubs: ${db.hubs.map(h => h.name).join(', ')}.\n${['student', 'floor', 'surge', 'metro'].map(t => F.explain(db.rules, t)).join('\n')}`;
    const ai = await llm.withDeadline(llm.answer(text, facts, p.lang), 5000);
    if (ai && G.groundText(ai, { fares: [10, 20, 100, 50, 25, 60, 40, 35, 16, 15], mins: [] }).ok) out = { reply: ai.trim(), cards: [], chips: [], grounded: { checked: true, ok: true, usedAI: true, issues: [] } };
  }
  if (!out) out = { reply: tx(p.lang, `I did not catch that. ${HELP.en}`, `Bujhte parini. ${HELP.bn}`), cards: [], chips: [] };

  return {
    ...out, parser: p.parser, intent, dropped: p.dropped,
    parsed: { from: p.from, to: p.to, avoid: p.avoid, budget: p.budget, student: p.student, arriveBy: p.arriveBy, hub: p.hub, alertType: p.alertType, lang: p.lang },
    ai: llm.provider(),
  };
}

module.exports = { handle, understand, narrate, describe, session };
