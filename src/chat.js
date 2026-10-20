// Conversational assistant (English + Banglish) with memory. Every number comes from the engine, never from the AI.
const nlp = require('./nlp');
const llm = require('./llm');
const E = require('./engine');
const A = require('./alerts');
const F = require('./fares');
const G = require('./grounding');
const PL = require('./places');

const sessions = new Map();
const tx = (lang, en, bn) => (lang === 'bn' ? bn : en);
const money = r => (r.lo === r.hi ? `৳${r.lo}` : `৳${r.lo}-${r.hi}`);


// ---------------- small helpers: names, lines, location ----------------
const hubOf = (db, id) => db.hubs.find(h => h.id === id);
const hn = (db, id) => (hubOf(db, id) ? hubOf(db, id).name : id);
const linesAt = (db, id) => db.lines.filter(l => l.status !== 'unverified' && l.stops.includes(id));
const modeName = m => ({ metro: 'MRT-6', bus: 'Bus', leguna: 'Leguna', rickshaw: 'Rickshaw', cng: 'CNG', walk: 'Walk' }[m] || m);
const walkMin = km => Math.max(1, Math.round((km * 1.25 / 4.5) * 60));

// Where the person is, from the browser's location (sent only with chat messages, never stored).
function hereInfo(db, loc) {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;
  const near = PL.nearestHub(db.hubs, loc.lat, loc.lng);
  return near ? { ...near, loc, inDhaka: near.km <= 25 } : null;
}
function rankHubs(db, loc) {
  const { km } = require('./geo');
  return db.hubs.map(h => ({ id: h.id, name: h.name, km: Math.round(km(loc, h) * 10) / 10, major: h.major !== false })).sort((a, b) => a.km - b.km);
}
const needLocation = lang => ({
  reply: tx(lang, 'I need to know where you are for that. Tap the location button (the target icon), allow location access, and ask again. Your location is only used to find the nearest stop and is never saved.',
    'Apni kothay ta jante hobe. Location button (target icon) e tap kore allow koro, tarpor abar jiggesh koro. Location shudhu kache-r stop khujte lage, save hoy na.'),
  cards: [], chips: [], needLocation: true,
});
const outsideDhaka = (db, here, lang) => ({
  reply: tx(lang, `Your location looks like it is outside Dhaka (about ${Math.round(here.km)} km from the nearest stop), so I cannot start a trip from there.`, `Apnar location Dhaka-r baire mone hocche (kache-r stop theke prai ${Math.round(here.km)} km), tai ekhan theke trip shuru kora jabe na.`),
  cards: [], chips: [],
});

// Honest notes when a place is not a stop itself: "Gulshan is not a stop, so I used Badda (1.4 km away)".
function placeNotes(db, p, lang) {
  const seen = new Set(), out = [];
  for (const n of p.notes || []) {
    if (seen.has(n.place)) continue;
    seen.add(n.place);
    out.push(n.outside
      ? tx(lang, `${n.place} is outside the area DhakaPath covers (the nearest stop, ${hn(db, n.hub)}, is about ${n.km} km away).`, `${n.place} DhakaPath-er area-r baire (kache-r stop ${hn(db, n.hub)} prai ${n.km} km dure).`)
      : tx(lang, `${n.place} is not a stop itself, so I used the nearest stop, ${hn(db, n.hub)} (about ${n.km} km away).`, `${n.place} nijei stop na, tai kache-r stop ${hn(db, n.hub)} dhorechi (prai ${n.km} km).`));
  }
  return out;
}
const outsideNote = (p, ids) => (p.notes || []).find(n => n.outside && ids.includes(n.hub));

// Works out the trip from the message, the person's location and the last trip. Returns { from, to, carried } or { reply }.
function resolveTrip(db, s, p, here) {
  const lang = p.lang;
  let from = p.from, to = p.to, carried = '';
  if (!from && p.here) {
    if (!here) return needLocation(lang);
    if (!here.inDhaka) return outsideDhaka(db, here, lang);
    from = here.hub;
    carried = tx(lang, ` (starting from ${hn(db, from)}, about ${here.km} km from you)`, ` (${hn(db, from)} theke, apnar theke prai ${here.km} km)`);
  } else if (to && !from && here && here.inDhaka && here.hub !== to) {
    from = here.hub;
    carried = tx(lang, ` (starting from ${hn(db, from)}, the stop nearest to you)`, ` (${hn(db, from)} theke, apnar kache-r stop)`);
  } else if (to && !from && s.last && s.last.q.from && s.last.q.from !== to) {
    from = s.last.q.from;
    carried = tx(lang, ` (starting from ${hn(db, from)}, as before)`, ` (${hn(db, from)} theke, ager moto)`);
  }
  if (from && !to && s.last && s.last.q.to && s.last.q.to !== from) to = s.last.q.to;
  if (!from && !to && p.followup && s.last) { from = s.last.q.from; to = s.last.q.to; }
  if (!from || !to) {
    return { reply: tx(lang, 'Where are you going from and to? For example: "Mirpur to Motijheel", "Gulshan to Dhanmondi", or "from here to Farmgate".', 'Kothay theke kothay jabe? Jemon: "Mirpur theke Motijheel" ba "ekhan theke Farmgate".'), cards: [], chips: [], suggest: ['Mirpur to Motijheel', 'Uttara to Farmgate', 'From here to Motijheel'] };
  }
  if (from === to) {
    return { reply: tx(lang, `${hn(db, from)} is both your start and your destination (or the nearest stop to both). Try a place farther away.`, `${hn(db, from)} e shuru ar shesh ek. Aro dure kothao bolo.`), cards: [], chips: [] };
  }
  const out = outsideNote(p, [from, to]);
  if (out) return { reply: placeNotes(db, p, lang).join(' ') + tx(lang, ' I cannot plan trips that far outside Dhaka.', ' Eto dure trip plan kora jay na.'), cards: [], chips: [] };
  return { from, to, carried };
}

function session(id) {
  id = id || 'default';
  if (!sessions.has(id)) {
    if (sessions.size > 200) sessions.delete(sessions.keys().next().value);
    sessions.set(id, { last: null, pending: null, turns: 0 });
  }
  return sessions.get(id);
}

const RULE_ONLY = new Set(['smalltalk', 'about', 'help', 'nearby', 'network', 'timing', 'fare_trip', 'place_info']);

// Rules always run. If a free AI key is set, the AI result is merged in after being grounded against real hub ids.
async function understand(db, text, context) {
  const rules = nlp.parse(text, db.hubs);
  const ai = llm.provider() ? await llm.withDeadline(llm.understand(text, db.hubs, context), 3500) : null;
  if (!ai) return { ...rules, parser: 'rules', dropped: [] };
  const pick = (a, b) => (a != null ? a : b);
  return {
    ...rules,
    intent: RULE_ONLY.has(rules.intent) ? rules.intent : ai.intent && ai.intent !== 'other' ? ai.intent : rules.intent,
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
  const word = { cheapest: 'Cheapest option', fastest: 'Fastest option', fewest: 'Fewest changes', safest: 'Most reliable option' }[p.sort] || 'Best option';
  const wordBn = { cheapest: 'Shobcheye sasti', fastest: 'Shobcheye druto', fewest: 'Shobcheye kom change', safest: 'Shobcheye nirbhorjogyo' }[p.sort] || 'Shobcheye bhalo';
  let s = tx(lang,
    `${word}: ${o.summary}. About ${t.min.lo}-${t.min.hi} min, fare ${fare}${p.student ? ` (student; regular ${other})` : ` (student ${other})`}.`,
    `${wordBn}: ${o.summary}. Somoy ${t.min.lo}-${t.min.hi} minute, bhara ${fare}${p.student ? ` (student; regular ${other})` : ` (student hole ${other})`}.`);
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

async function doSearch(db, s, p, req, now, extra = {}, here = null) {
  const lang = p.lang;
  const trip = resolveTrip(db, s, p, here);
  if (!trip.from) return trip;
  const { from, to, carried } = trip;
  const sc = req.scenario || {};
  const q = {
    from, to,
    avoid: [...new Set([...(p.avoid || []), ...(extra.avoid || [])])],
    budget: p.budget || undefined,
    student: p.student != null ? p.student : s.last ? s.last.q.student : !!req.student,
    arriveBy: Number.isFinite(p.arriveBy) ? p.arriveBy : Number.isFinite(req.arriveBy) ? req.arriveBy : s.last && s.last.q.arriveBy,
    sort: p.sort || (p.followup && s.last && s.last.q.sort) || 'best',
    mode: p.mode || undefined, noModes: p.noModes || [],
    scenario: { ...sc, rain: !!sc.rain || !!p.rain, rush: !!sc.rush || !!p.rush },
    useAlerts: req.useAlerts !== false,
  };
  let result = E.search(db, q, now);
  const notes = placeNotes(db, p, lang);
  // a mode that no route can use is not a dead end: say so and show the best overall instead
  if (!result.options.length && (q.mode || q.noModes.length)) {
    const wanted = q.mode ? modeName(q.mode) : 'that kind of transport';
    const fb = E.search(db, { ...q, mode: undefined, noModes: [] }, now);
    if (fb.options.length) {
      notes.push(tx(lang, `No route fits ${q.mode ? 'using' : 'without'} ${q.mode ? wanted : q.noModes.map(modeName).join(', ')}, so here is the best overall.`, `${q.mode ? wanted + ' diye' : q.noModes.map(modeName).join(', ') + ' chara'} kono route nai, tai shobcheye bhalo ta dekhachchi.`));
      q.mode = undefined; q.noModes = []; result = fb;
    }
  }
  s.last = { q, result };
  if (!result.options.length) {
    return { reply: tx(lang, 'No route found with those limits. Try a bigger budget or avoid fewer hubs.', 'Ei shorto e kono route nai. Budget barao ba avoid kom koro.'), cards: [], chips: [], query: q, suggest: ['Cheapest way', 'Fastest way', 'What if it rains?'] };
  }
  const n = await narrate(db, result, { ...p, student: q.student, arriveBy: q.arriveBy, sort: q.sort !== 'best' ? q.sort : null });
  const g = E.getGraph(db);
  if (q.avoid.length) notes.push(tx(lang, `Avoiding ${q.avoid.map(h => g.hubMap[h].name).join(', ')}.`, `${q.avoid.map(h => g.hubMap[h].name).join(', ')} avoid kora hoyeche.`));
  if (q.budget) notes.push(tx(lang, `Budget ৳${q.budget} applied.`, `Budget ৳${q.budget} dhora hoyeche.`));
  if (q.mode) notes.push(tx(lang, `Showing routes that use ${modeName(q.mode)}.`, `${modeName(q.mode)} ache emon route dekhachchi.`));
  if (q.noModes.length) notes.push(tx(lang, `Skipping ${q.noModes.map(modeName).join(', ')}.`, `${q.noModes.map(modeName).join(', ')} bad deya hoyeche.`));
  const best = result.options[0];
  const nm = h => g.hubMap[h].name;
  const lead = { cheapest: 'Cheapest', fastest: 'Fastest', fewest: 'Fewest changes', safest: 'Most reliable' }[q.sort] || 'Best';
  const short = tx(lang,
    `${result.options.length} way${result.options.length === 1 ? '' : 's'} from ${nm(q.from)} to ${nm(q.to)}. ${lead} is ${best.summary}, ${best.totals.min.lo}-${best.totals.min.hi} min.`,
    `${nm(q.from)} theke ${nm(q.to)} jabar ${result.options.length} ta upay. ${lead === 'Best' ? 'Shobcheye bhalo' : lead} ${best.summary}, ${best.totals.min.lo}-${best.totals.min.hi} minute.`) + (carried || '') + (notes.length ? ' ' + notes.join(' ') : '');
  const suggest = [q.sort !== 'cheapest' && 'Cheapest way', q.sort !== 'fastest' && 'Fastest way', !q.scenario.rain && 'What if it rains?', 'Fare by rickshaw'].filter(Boolean).slice(0, 4);
  return { reply: n.text + (carried || '') + (notes.length ? '\n' + notes.join(' ') : ''), short, cards: cardsOf(result, q), chips: best.proofs, query: q, result, grounded: n.grounded, suggest };
}

// Fair prices for every way of making a trip, with the haggling line. Never touches the route search UI.
async function fareTripFlow(db, s, p, req, now, here) {
  const lang = p.lang;
  const trip = resolveTrip(db, s, p, here);
  if (!trip.from) return trip;
  const { from, to, carried } = trip;
  const sc = req.scenario || {};
  const arriveBy = Number.isFinite(p.arriveBy) ? p.arriveBy : Number.isFinite(req.arriveBy) ? req.arriveBy : null;
  const rain = !!sc.rain || !!p.rain;
  const c = F.compareFares(db, from, to, { rain, traffic: arriveBy != null ? E.trafficAt(arriveBy) : 0 });
  const student = p.student != null ? p.student : s.last ? s.last.q.student : !!req.student;
  const line = i => `• ${i.label}: ${money(i.fare)} for about ${i.km} km${student && i.studentApplies ? ` (student ${money(i.student)})` : ''}${i.surge > 1 ? ' (includes rain/rush surge)' : ''}`;
  const pick = p.mode ? c.items.find(i => i.mode === p.mode) : null;
  let head = tx(lang, `Fair prices from ${hn(db, from)} to ${hn(db, to)} (about ${c.km} km by road${c.source === 'estimate' ? ', estimated' : ''})${carried}:`, `${hn(db, from)} theke ${hn(db, to)} (prai ${c.km} km) er nayyo bhara${carried}:`);
  let lines;
  if (pick) {
    lines = [line(pick), tx(lang, 'Other ways:', 'Onno upay:'), ...c.items.filter(i => i !== pick).map(line)];
  } else {
    lines = c.items.map(line);
    if (p.mode) lines.unshift(tx(lang, `${modeName(p.mode)} does not serve this exact trip directly, here is what does:`, `${modeName(p.mode)} ei trip e sora-sori nai, ja ache:`));
  }
  const notes = placeNotes(db, p, lang);
  const tip = tx(lang, `Haggling tip: say "${c.haggle.banglish}" Anything above ৳${c.haggle.tooMuch} is too much.`, `Dor kosakosi: bolo "${c.haggle.banglish}" ৳${c.haggle.tooMuch} er beshi hole beshi.`);
  // keep the trip in memory so "now by bus?" or "cheapest way" work next
  const q = { from, to, avoid: [], student, arriveBy: arriveBy == null ? undefined : arriveBy, sort: 'best', scenario: { rain, rush: false }, useAlerts: true };
  s.last = { q, result: E.search(db, q, now) };
  return { reply: [head, ...lines, tip, ...notes].join('\n'), cards: [], chips: [], suggest: ['Show me the routes', 'Cheapest way', 'What if it rains?'] };
}

function reportFlow(db, s, p, req, now, save) {
  const lang = p.lang;
  const d = s.pending && s.pending.kind === 'report' ? s.pending.draft : { hub: null, type: null, severity: null, text: p.text };
  if (p.hub && !d.hub) { d.hub = p.hub; if (p.hubPlace) d.placeNote = placeNotes(db, { notes: [p.hubPlace], lang }, lang)[0]; }
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
    reply: tx(lang, `Report ${TYPE_WORD[d.type]} at ${name} (${sev})? Say yes to send it.`, `${name} e ${TYPE_WORD[d.type]} (${sev}) report korbo? Pathate "ha" bolo.`) + (d.placeNote ? `\n${d.placeNote}` : ''),
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

async function rerouteFlow(db, s, p, req, now, here = null) {
  const lang = p.lang;
  const g = E.getGraph(db);
  const avoid = p.avoid.length ? p.avoid : p.hub ? [p.hub] : [];
  if (!avoid.length) return { reply: tx(lang, 'Which hub is blocked or congested?', 'Kon hub e jam ba bondho?'), cards: [], chips: [] };
  const base = s.last && !p.from && !p.to ? s.last : null;
  if (!base && !(p.from && p.to)) return { reply: tx(lang, 'Tell me your trip first, for example "Mirpur to Motijheel", then I can route around it.', 'Age bolo kothay theke kothay jabe, tarpor oi hub bad diye route dibo.'), cards: [], chips: [] };
  const before = base ? base.result.options[0] : null;
  const names = avoid.map(h => g.hubMap[h].name).join(', ');
  const out = await doSearch(db, s, { ...p, from: p.from || base.q.from, to: p.to || base.q.to, avoid: [] }, req, now, { avoid }, here);
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


// ---------------- conversation flows beyond routes and fares ----------------
function smalltalkFlow(p) {
  const lang = p.lang;
  const t = nlp.norm(p.text);
  if (/\b(?:bye|goodbye|good bye|see you|see ya|allah hafez|khoda hafez|tata|cya)\b/.test(t)) return { reply: tx(lang, 'Bye! Stay safe on the roads, and check the Live tab before you head out.', 'Bye! Rastay shabdhane thakio, berobar age Live tab ta dekhe nio.'), cards: [], chips: [] };
  return { reply: tx(lang, 'You are welcome! Ask me for another route, a fare, or what the roads are like right now.', 'Welcome! Aro route, bhara, ba rastar obostha jiggesh korte paro.'), cards: [], chips: [], suggest: ['Mirpur to Motijheel', 'Student fare koto?', 'Nearest metro station'] };
}
const aboutFlow = p => ({ reply: tx(p.lang, `I am the DhakaPath assistant. I find bus, MRT-6, leguna, rickshaw and CNG routes, work out fair fares, take live road reports and tell you what is happening on Dhaka's roads. ${HELP.en}`, `Ami DhakaPath assistant. ${HELP.bn}`), cards: [], chips: [], suggest: ['Mirpur to Motijheel', 'Nearest metro station', 'Farmgate e jol jomeche'] });
const helpFlow = p => ({ reply: HELP[p.lang], cards: [], chips: [], suggest: ['Gulshan to Dhanmondi, student', 'Nearest metro station', 'Fare from Mirpur to Motijheel', 'Which bus goes to Farmgate?'] });

function nearbyFlow(db, p, req, here) {
  const lang = p.lang;
  if (!here) return needLocation(lang);
  if (!here.inDhaka) return outsideDhaka(db, here, lang);
  const metro = new Set(db.lines.filter(l => l.mode === 'metro').flatMap(l => l.stops));
  const bus = new Set(db.lines.filter(l => l.mode === 'bus' && l.status !== 'unverified').flatMap(l => l.stops));
  let pool = rankHubs(db, req.loc);
  const kind = p.nearby === 'metro' ? 'MRT-6 stations' : p.nearby === 'bus' ? 'bus stops' : 'stops';
  if (p.nearby === 'metro') pool = pool.filter(r => metro.has(r.id));
  else if (p.nearby === 'bus') pool = pool.filter(r => bus.has(r.id));
  const top = pool.slice(0, 3);
  if (!top.length) return { reply: tx(lang, 'I could not find any stops near you.', 'Kache kono stop pelam na.'), cards: [], chips: [] };
  const lines = top.map((r, i) => {
    const served = [...new Set(linesAt(db, r.id).map(l => modeName(l.mode)))];
    return `${i + 1}. ${r.name}, ${r.km} km (about ${walkMin(r.km)} min walk)${served.length ? ': ' + served.join(', ') : ''}`;
  });
  return {
    reply: tx(lang, `Nearest ${kind} to you:\n${lines.join('\n')}`, `Apnar kache-r ${kind}:\n${lines.join('\n')}`),
    cards: [], chips: [], suggest: ['From here to Motijheel', `Go from ${top[0].name} to ${top[0].id === 'motijheel' ? 'Farmgate' : 'Motijheel'}`],
  };
}

function placeInfoFlow(db, p) {
  const lang = p.lang;
  const id = p.hub;
  if (!id) return null;
  const h = hubOf(db, id);
  const st = E.hubStatuses(db, Date.now())[id] || { status: 'Clear', alerts: [] };
  const lm = (db.landmarks || {})[id] || {};
  const served = linesAt(db, id);
  const modes = [...new Set(served.map(l => modeName(l.mode)))];
  const conn = db.connectors.filter(c => c.from === id || c.to === id).length;
  const parts = [];
  if (p.hubPlace) {
    parts.push(placeNotes(db, { notes: [p.hubPlace], lang }, lang)[0]);
    if (p.hubPlace.outside) return { reply: parts[0], cards: [], chips: [] };
  } else if (lm.general) parts.push(`${h.name}: ${lm.general}.`);
  else parts.push(`${h.name} is a stop in the DhakaPath network.`);
  if (p.hubPlace && lm.general) parts.push(`${h.name}: ${lm.general}.`);
  parts.push(modes.length ? tx(lang, `Served by ${modes.join(', ')} (${served.length} line${served.length === 1 ? '' : 's'}).`, `${modes.join(', ')} ache (${served.length} ta line).`) : tx(lang, 'No bus or metro line stops here yet; rickshaw and CNG links connect it.', 'Ekhane bus/metro nai; rickshaw ar CNG link ache.'));
  if (conn) parts.push(tx(lang, `${conn} rickshaw/CNG link${conn === 1 ? '' : 's'} start or end here.`, `${conn} ta rickshaw/CNG link ache.`));
  parts.push(st.status === 'Clear' ? tx(lang, 'Roads are clear right now.', 'Ekhon rasta clear.') : tx(lang, `Right now: ${st.status.toLowerCase()} (${st.alerts.length} active alert${st.alerts.length === 1 ? '' : 's'}).`, `Ekhon: ${st.status} (${st.alerts.length} ta alert).`));
  return { reply: parts.join(' '), cards: [], chips: [], suggest: [`Go from ${id === 'farmgate' ? 'Motijheel' : 'Farmgate'} to ${p.hubPlace ? p.hubPlace.place : h.name}`, `Which bus goes to ${h.name}?`] };
}

function networkFlow(db, p) {
  const lang = p.lang;
  const t = nlp.norm(p.text);
  const metro = db.lines.find(l => l.id === 'mrt6') || db.lines.find(l => l.mode === 'metro');
  const asksMetroList = /\b(?:metro|mrt)\b/.test(t) && /\b(?:stations|station|stops|line)\b/.test(t) && !p.hub;
  if (asksMetroList && metro) {
    return { reply: tx(lang, `MRT-6 has ${metro.stops.length} stations, north to south: ${metro.stops.map(x => hn(db, x)).join(', ')}.`, `MRT-6 e ${metro.stops.length} ta station, uttor theke dokkhin: ${metro.stops.map(x => hn(db, x)).join(', ')}.`), cards: [], chips: [], suggest: ['Nearest metro station', 'Uttara to Motijheel by metro'] };
  }
  if (p.hub) {
    const id = p.hub, h = hubOf(db, id);
    const served = linesAt(db, id);
    const wanted = p.mode ? served.filter(l => l.mode === p.mode) : served;
    const intro = p.hubPlace ? placeNotes(db, { notes: [p.hubPlace], lang }, lang)[0] + ' ' : '';
    if (p.mode && !wanted.length) {
      return { reply: intro + tx(lang, `No ${modeName(p.mode)} line stops at ${h.name}. ${served.length ? 'Lines that do: ' + served.map(l => l.name).join(', ') + '.' : 'Rickshaw and CNG links connect it.'}`, `${h.name} e ${modeName(p.mode)} nai. ${served.length ? 'Ja ache: ' + served.map(l => l.name).join(', ') + '.' : ''}`), cards: [], chips: [] };
    }
    if (!wanted.length) return { reply: intro + tx(lang, `No bus, metro or leguna line stops at ${h.name}. Rickshaw and CNG links connect it to nearby stops.`, `${h.name} e bus/metro/leguna nai. Rickshaw ar CNG link ache.`), cards: [], chips: [] };
    const list = wanted.slice(0, 8).map(l => `• ${l.name} (${modeName(l.mode)}, ${l.stops.length} stops)`);
    return { reply: intro + tx(lang, `${h.name} is served by:\n${list.join('\n')}${wanted.length > 8 ? `\n…and ${wanted.length - 8} more.` : ''}`, `${h.name} e ja ache:\n${list.join('\n')}`), cards: [], chips: [], suggest: [`Go from ${id === 'farmgate' ? 'Motijheel' : 'Farmgate'} to ${p.hubPlace ? p.hubPlace.place : h.name}`] };
  }
  const by = m => db.lines.filter(l => l.mode === m && l.status !== 'unverified').length;
  return { reply: tx(lang, `The network has ${db.hubs.length} places, ${by('metro')} MRT line, ${by('bus')} bus lines, ${by('leguna')} leguna lines and ${db.connectors.length} rickshaw/CNG links. Ask "which bus goes to Farmgate?" or "metro stations".`, `Network e ${db.hubs.length} ta jayga, ${by('metro')} MRT, ${by('bus')} bus, ${by('leguna')} leguna ar ${db.connectors.length} ta rickshaw/CNG link ache.`), cards: [], chips: [], suggest: ['Metro stations', 'Which bus goes to Farmgate?'] };
}

function timingFlow(db, p) {
  const lang = p.lang;
  const metro = db.lines.find(l => l.id === 'mrt6');
  return {
    reply: tx(lang,
      `I do not have official timetables, so I will not guess when the first or last MRT-6 train or bus runs. For MRT-6, check the official DMTCL notices; bus times vary by operator. What I can tell you: traffic follows a rush-hour curve (heaviest around 8-9 AM and 5-7 PM, an assumed shape), and every route shows a time range${metro ? ` (MRT-6 has ${metro.stops.length} stations)` : ''}. Use "Leave by" in a route to plan around it.`,
      `Amar kache official timetable nai, tai MRT-6 ba bus kokhon shuru/shesh ta anumaan korbo na. MRT-6 er jonno DMTCL-er notice dekho. Rush hour prai shokal 8-9 ar bikel 5-7.`),
    cards: [], chips: [], suggest: ['Uttara to Motijheel by metro', 'Metro stations'],
  };
}

const HELP = {
  en: 'I can: find routes in English, Banglish or Bangla ("Gulshan to Dhanmondi, student, under 80 taka"), compare fares ("rickshaw fare Mirpur to Motijheel"), find the stop nearest to you ("nearest metro station", "from here to Motijheel"), take live reports ("Farmgate e jol jomeche"), reroute around a hub ("avoid Farmgate"), say which lines serve a place, and explain fare rules or how reliable an alert is.',
  bn: 'Ami ja pari: route khuje fare tulona ("Gulshan theke Dhanmondi, student, 80 takar moddhe"), nayyo bhara bola ("Mirpur theke Motijheel rickshaw bhara"), apnar kache-r stop khuje deya ("nearest metro station", "ekhan theke Motijheel"), live report neya ("Farmgate e jol jomeche"), kono hub bad diye route deya, kon line kothay jay bola, ar fare rule/alert reliability bujhano.',
};

async function handle(db, req, deps = {}) {
  const now = req.now || Date.now();
  const save = deps.save || (() => {});
  const text = String(req.message || '').slice(0, 400).trim();
  const s = session(req.sessionId);
  s.turns++;
  const here = hereInfo(db, req.loc);
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

  // short follow-ups such as "cheapest way", "what if it rains?" or "fare by rickshaw" refer to the last trip
  const noPlace = !p.from && !p.to && !p.here && !p.mentions.length;
  if (s.last && noPlace && !s.pending) {
    if (['other', 'fare_question', 'route', 'greeting'].includes(intent) && p.fareWords && p.mode) { intent = 'fare_trip'; p.followup = true; }
    else if (['other', 'fare_question', 'route'].includes(intent) && !p.fareWords && (p.sort || p.mode || p.noModes.length || p.rain || p.rush || p.budget || Number.isFinite(p.arriveBy))) { intent = 'route'; p.followup = true; }
    else if (intent === 'route') p.followup = true;
  }
  if (s.last && intent === 'fare_trip' && noPlace) p.followup = true;

  if (intent === 'smalltalk') out = smalltalkFlow(p);
  else if (intent === 'about') out = aboutFlow(p);
  else if (intent === 'help') out = helpFlow(p);
  else if (intent === 'nearby') out = nearbyFlow(db, p, req, here);
  else if (intent === 'timing') out = timingFlow(db, p);
  else if (intent === 'network') out = networkFlow(db, p);
  else if (intent === 'place_info') out = placeInfoFlow(db, p);
  else if (intent === 'fare_trip') out = await fareTripFlow(db, s, p, req, now, here);
  else if (intent === 'report') out = reportFlow(db, s, p, req, now, save);
  else if (intent === 'reroute') out = await rerouteFlow(db, s, p, req, now, here);
  else if (intent === 'route') out = await doSearch(db, s, p, req, now, {}, here);
  else if (intent === 'reliability') out = reliabilityFlow(db, s, p, now);
  else if (intent === 'fare_question') out = await fareFlow(db, s, p, now);
  else if (intent === 'greeting') out = { reply: HELP[p.lang], cards: [], chips: [], suggest: ['Mirpur to Motijheel', 'Nearest metro station', 'Student fare koto?'] };

  if (!out && llm.provider()) {
    const g = E.getGraph(db);
    const facts = `Hubs: ${db.hubs.map(h => h.name).join(', ')}.\n${['student', 'floor', 'surge', 'metro'].map(t => F.explain(db.rules, t)).join('\n')}`;
    const ai = await llm.withDeadline(llm.answer(text, facts, p.lang), 5000);
    if (ai && G.groundText(ai, { fares: [10, 20, 100, 50, 25, 60, 40, 35, 16, 15], mins: [] }).ok) out = { reply: ai.trim(), cards: [], chips: [], grounded: { checked: true, ok: true, usedAI: true, issues: [] } };
  }
  if (!out) out = { reply: tx(p.lang, `I did not catch that. ${HELP.en}`, `Bujhte parini. ${HELP.bn}`), cards: [], chips: [], suggest: ['Mirpur to Motijheel', 'Nearest metro station', 'What can you do?'] };

  return {
    ...out, parser: p.parser, intent, dropped: p.dropped,
    parsed: { from: p.from, to: p.to, avoid: p.avoid, budget: p.budget, student: p.student, arriveBy: p.arriveBy, hub: p.hub, alertType: p.alertType, lang: p.lang, fromPlace: p.fromPlace || null, toPlace: p.toPlace || null, mode: p.mode || null, noModes: p.noModes || [], sort: p.sort || null, here: !!p.here },
    here: here ? { hub: here.hub, name: here.name, km: here.km, inDhaka: here.inDhaka } : null,
    ai: llm.provider(),
  };
}

module.exports = { handle, understand, narrate, describe, session };
