// Rule-based English + Banglish understanding. Works with no API key and is also the fallback for the AI parser.
const BN_DIGITS = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };

function norm(s) {
  let t = String(s || '').toLowerCase().replace(/[০-৯]/g, d => BN_DIGITS[d]);
  t = t.replace(/\s*(→|->|=>|–|—|>)\s*/g, ' to ').replace(/-/g, ' ');
  t = t.replace(/["“”']/g, '').replace(/[,.!?;()]/g, ' ').replace(/\s+/g, ' ');
  return ' ' + t.trim() + ' ';
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 9;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}

const PLACES = require('./places');

// Hub names first, then (optionally) gazetteer places that point at their nearest hub. A hub name always wins.
function aliasList(hubs, withPlaces) {
  const list = [];
  const taken = new Set();
  for (const h of hubs) {
    const names = new Set([h.name, h.id.replace(/-/g, ' '), ...(h.aliases || [])]);
    for (const a of names) { const al = norm(a).trim(); if (al && !taken.has(al)) { taken.add(al); list.push({ alias: al, hub: h.id }); } }
  }
  if (withPlaces) {
    for (const p of PLACES.index(hubs)) {
      if (!p.near) continue;
      for (const a of p.aliases) {
        const al = norm(a).trim();
        if (al && !taken.has(al)) { taken.add(al); list.push({ alias: al, hub: p.near.hub, place: p.name, placeId: p.id, km: p.near.km, outside: !!p.near.outside }); }
      }
    }
  }
  return list.sort((x, y) => y.alias.length - x.alias.length);
}

// Finds hub mentions as [{hub, start, end}] in normalized text t (which has leading/trailing space).
function matchHubs(t, hubs, opts = {}) {
  const used = new Array(t.length).fill(false);
  const found = [];
  const free = (s, e) => { for (let i = s; i < e; i++) if (used[i]) return false; return true; };
  const mark = (s, e) => { for (let i = s; i < e; i++) used[i] = true; };
  const list = aliasList(hubs, !!opts.places);
  for (const item of list) {
    const { alias, hub } = item;
    let from = 0;
    while (true) {
      const i = t.indexOf(alias, from);
      if (i < 0) break;
      const before = t[i - 1], after = t[i + alias.length];
      const wordEdge = (!before || before === ' ') && (!after || after === ' ' || /[a-z]/.test(after) === false || ['e', 't'].includes(after));
      // allow Banglish suffix like "motijheele" / "farmgatete": letter right after the name
      if (wordEdge && free(i, i + alias.length)) { found.push({ hub, start: i, end: i + alias.length, place: item.place || null, placeKm: item.km, outside: !!item.outside }); mark(i, i + alias.length); }
      from = i + alias.length;
    }
  }
  // typo tolerance for single words. Only hub names are fuzzy-matched (places must match exactly, or "going" would find "Tongi").
  const words = [...t.matchAll(/[a-z]{5,}/g)];
  for (const w of words) {
    const s = w.index, e = s + w[0].length;
    if (!free(s, e) || NOT_PLACES.has(w[0])) continue;
    let best = null;
    for (const item of list) {
      const { alias, hub, place } = item;
      if (alias.includes(' ') || (place && alias.length < 7)) continue;
      const dist = lev(w[0], alias);
      const lim = alias.length >= 8 && !place ? 2 : 1;
      if (dist <= lim && (!best || dist < best.dist)) best = { hub, dist, place: place || null, km: item.km, outside: !!item.outside };
    }
    if (best) { found.push({ hub: best.hub, start: s, end: e, place: best.place || null, placeKm: best.km, outside: !!best.outside }); mark(s, e); }
  }
  return found.sort((a, b) => a.start - b.start);
}

// Ordinary words that look a lot like a place name.
const NOT_PLACES = new Set(['going', 'where', 'there', 'metro', 'about', 'fares', 'route', 'routes', 'bhara', 'which', 'would', 'could', 'other', 'board', 'price', 'train', 'trains', 'stand', 'stops', 'light', 'right', 'north', 'south', 'cheap', 'fastest', 'today', 'thanks', 'check', 'tomar', 'amake']);

function resolveHub(str, hubs) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  const byId = hubs.find(h => h.id === s || h.name.toLowerCase() === s);
  if (byId) return byId.id;
  const m = matchHubs(norm(str), hubs);
  return m.length ? m[0].hub : null;
}

// Each marker also accepts Bangla script; [ঀ-৿]{0,2} allows a case ending such as "মতিঝিলে".
const AVOID_AFTER = /^(?:\s*(?:avoid|bad diye|bad dey|baad diye|baad dey|chhara|chara|skip|na jeye|diye na|diye jabo na|e jabo na|te jabo na|bad dite)|[ঀ-৿]{0,2}\s*(?:বাদ দিয়ে|এড়িয়ে|ছাড়া))/;
const AVOID_BEFORE = /(?:avoid|without|skip|except|bad diye|bad dey|bypass)\s*$/;
const FROM_AFTER = /^(?:\s*(?:theke|thekei|hote|from\b)|[ঀ-৿]{0,2}\s*(?:থেকে|হতে))/;
const TO_AFTER = /^(?:\s*(?:e|te|ey|tey|er dike|jabo|jete|jai|jachi|jacchi|jaite|jawa)\b|[ঀ-৿]{0,2}\s*(?:যাব|যেতে|যাই|যাচ্ছি))/;

const BN_WORDS = ['theke', 'jabo', 'jete', 'koto', 'takar', 'moddhe', 'modhe', 'kore', 'diye', 'chhara', 'chara', 'jol', 'brishti', 'bristi', 'ache', 'kothay', 'amar', 'ami', 'tumi', 'ki', 'hobe', 'nai', 'jacchi', 'jai', 'pouchabo', 'lagbe', 'korbo', 'kon', 'onno', 'bondho', 'jomeche', 'jomse', 'joma', 'hoyeche', 'hoy', 'jaite', 'chai', 'ekta', 'keno'];

function detectLang(t) {
  const words = new Set(t.trim().split(' '));
  return BN_WORDS.some(w => words.has(w)) || /[ঀ-৿]/.test(t) ? 'bn' : 'en';
}

function toMinutes(h, mi, ap) {
  h = Number(h); mi = Number(mi || 0);
  if (ap === 'pm' && h < 12) h += 12;
  else if (ap === 'am' && h === 12) h = 0;
  else if (!ap) { if (h >= 1 && h <= 4) h += 12; }
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function parseTime(t) {
  const noCur = t.replace(/\d+\s*(?:taka|takar|tk|bdt|৳|টাকা)/g, ' ');
  let m = noCur.match(/(?<!\d)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:tar|ta|er|r|টার|টা)?\s*(?:er\s*)?(?:moddhe\b|modhe\b|মধ্যে)/);
  if (m) return toMinutes(m[1], m[2], m[3]);
  m = noCur.match(/\b(?:by|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (m) return toMinutes(m[1], m[2], m[3]);
  m = noCur.match(/(?<!\d)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:tar|ta)?\s*(?:e|a)?\s*(?:pouch|pouc|pochh|reach|arrive)/);
  if (m) return toMinutes(m[1], m[2], m[3]);
  return null;
}

function parseBudget(t) {
  let m = t.match(/\b(?:under|within|max|maximum|budget|below|upto|up to)\s*(?:৳|tk|bdt|taka)?\s*(\d{2,4})\b/);
  if (m) return Number(m[1]);
  m = t.match(/(?<!\d)(\d{2,4})\s*(?:taka|takar|takay|tk|bdt|৳|টাকা)/);
  if (m) return Number(m[1]);
  m = t.match(/৳\s*(\d{2,4})/);
  return m ? Number(m[1]) : null;
}

function alertType(t) {
  if (/\b(?:jol|water|waterlog\w*|flood\w*|jomeche|jomse|joma)\b/.test(t) && /\b(?:jol|water|waterlog\w*|flood\w*)\b/.test(t)) return 'waterlogging';
  if (/\b(?:blockade|block|blocked|bondho|procession|michil|barrier|barricade)\b/.test(t)) return 'blockade';
  if (/\b(?:construction|kaj|road ?work|digging|repair)\b/.test(t)) return 'construction';
  if (/\b(?:jam|gridlock|traffic|standstill|slow|dhimey|dhimi|congested|congestion)\b/.test(t)) return 'gridlock';
  return null;
}

function severity(t) {
  if (/\b(?:knee|komor|bhishon|bhoyonkor|severe|heavy|standstill|totally|completely|ekdom|terrible|massive)\b/.test(t)) return 3;
  if (/\b(?:little|ektu|slight|halka|minor|small)\b/.test(t)) return 1;
  return 2;
}

// ---- extra signals: how the person wants to travel, what to sort by, and "from where I am"
const MODE_WORDS = {
  bus: 'bus|buses|বাস',
  metro: 'metro|mrt|metrorail|train|মেট্রো',
  rickshaw: 'rickshaw|rickshaws|ricksha|riksha|rikshaw|রিকশা',
  cng: 'cng|autorickshaw|baby taxi|babytaxi|সিএনজি',
  leguna: 'leguna|legunas|laguna|লেগুনা',
};
// Which mode the person asked for ("by bus") and which they want to skip ("no rickshaw", "bus chara").
function modePrefs(t) {
  const want = [], skip = [];
  for (const [m, w] of Object.entries(MODE_WORDS)) {
    const word = `(?:${w})[ঀ-৿]{0,2}(?=\\s|$)`;
    if (!new RegExp(`(?:^|\\s)${word}`).test(t)) continue;
    const neg = new RegExp(`(?:^|\\s)(?:no|without|avoid|skip|not|except)\\s+(?:the\\s+)?${word}|(?:^|\\s)${word}\\s+(?:chara|bad diye|bad dey|baad diye|na)(?=\\s|$)`);
    (neg.test(t) ? skip : want).push(m);
  }
  return { mode: want.length === 1 ? want[0] : null, noModes: skip };
}
function sortPref(t) {
  if (/\b(?:cheapest|cheap|cheaply|least expensive|lowest fare|budget friendly|sasto|sosta|kom khoroch|kom bhara|kom dam)\b/.test(t)) return 'cheapest';
  if (/\b(?:fastest|quickest|quick|fast|asap|in a hurry|hurry|taratari|druto|jaldi|tara tari|shobcheye druto)\b/.test(t)) return 'fastest';
  if (/\b(?:fewest changes|fewest transfers|no change|no changes|no transfer|direct|without changing|change chara|change charai|sojasuji)\b/.test(t)) return 'fewest';
  if (/\b(?:safest|most reliable|reliable route|least risky)\b/.test(t)) return 'safest';
  return null;
}
// "from here", "near me", "ami ekhane achi": the person means where they are right now
const HERE_RX = /\b(?:from here|from my location|from where i am|my location|my current location|current location|where i am|near me|nearby|around me|close to me|ami ekhane|ami ekhon|ekhan theke|ekhane theke|ekhan thekei|amar location|amar kache|amar kachhe|ekhane achi|ekhane ashi)\b|এখান থেকে|আমার লোকেশন|আমার কাছে|এখানে আছি/;
const NEAREST_RX = /\b(?:nearest|closest|nearby|near me|around me|kache|kachhe|kachakachi|nikoton|nikotbortee|nikotoborti|kache ache|close)\b|কাছে|কাছাকাছি/;

function nearbyKind(t) {
  if (!(NEAREST_RX.test(t) || HERE_RX.test(t))) return null;
  if (/\b(?:metro|mrt|station)\b|মেট্রো/.test(t)) return 'metro';
  if (/\b(?:bus|bus stop|bus stand|stop|stand|stoppage)\b|বাস/.test(t)) return 'bus';
  if (/\b(?:hub|place|area|stop|stops|where am i|ami kothay|kothay achi)\b/.test(t)) return 'any';
  return null;
}

const FARE_WORDS = /\b(?:fare|fares|bhara|bhaara|vara|ticket|how much|koto lagbe|koto taka|koto tk|koto hobe|price|charge|cost|costs|dam koto|dam)\b|ভাড়া|কত/;
const THANKS = /^\s*(?:thanks|thank you|thank u|thankyou|thx|ty|shukriya|dhonnobad|dhonyobad|dhanyabad|thanks a lot|many thanks|great|nice|cool|awesome|perfect|good|got it|ok thanks|okay thanks|okk|oky|ok|okay|nice one|bhalo|darun|shundor|sundor)\b|ধন্যবাদ|ধন্যবাদ|ধন্যবাদ/;
const BYE = /\b(?:bye|goodbye|good bye|see you|see ya|allah hafez|khoda hafez|tata|cya)\b/;
const ABOUT_BOT = /\b(?:who are you|what are you|your name|tumi ke|apni ke|tomar nam|ke tumi|are you a bot|are you ai|are you real|who made you|who built you)\b/;
const HELP_RX = /\b(?:what can you do|what do you do|how do you work|how does this work|how does it work|how to use|how do i use|help me|help|features|capabilities|commands|options|ki ki paro|ki korte paro|ki ki kaj|kivabe use|kibhabe use|tumi ki korte paro|apni ki korte paren|menu)\b/;
const WHERE_RX = /\b(?:where is|where s|whats near|what is near|tell me about|about|info on|information on|info about|describe|landmark|landmarks|kothay|koi|kothai|er bishoye|bishoye|ki ache|what is at|what s at)\b|কোথায়|সম্পর্কে/;
const NETWORK_RX = /\b(?:which bus|which buses|which line|which lines|what bus|what buses|what lines|bus to|buses to|bus for|any bus|is there a bus|is there bus|is there metro|is there a metro|any metro|metro to|metro station|metro stations|mrt station|mrt stations|metro stops|metro line|mrt line|lines at|lines serving|lines through|list stops|list hubs|all stops|all stations|all lines|how many stops|how many lines|how many hubs|kon bus|kon bus e|kon line|konta bus|bus ache|metro ache|stations)\b/;
const TIMING_RX = /\b(?:what time|timing|timings|timetable|time table|schedule|first train|last train|first bus|last bus|frequency|how often|opening hours|open hours|operating hours|service hours|running hours|kotay shuru|kokhon shuru|kokhon bondho|shesh train|prothom train|koyta porjonto|till what time|until what time|open now)\b/;

function classify(t, mentions, hasFromTo, ctx = {}) {
  const q = /\?|\bkoto\b|\bhow much\b|\bkeno\b|\bwhy\b|\bkon\b|\bwhat\b|\bki\b/.test(t);
  const hasMention = mentions && mentions.length > 0;
  if (THANKS.test(t) && t.trim().split(' ').length <= 5 && !hasMention) return 'smalltalk';
  if (BYE.test(t) && t.trim().split(' ').length <= 5) return 'smalltalk';
  if (ABOUT_BOT.test(t)) return 'about';
  if (/\b(?:reliable|reliability|trust|accurate|confidence|sure|sotti|vul|purano|stale|expire\\w*|outdated|how old|kotota)\b/.test(t)) return 'reliability';
  if (/\b(?:alternative|alternatives|reroute|detour|bikolpo|onno route|onno poth|other route|another route|ar kono|else)\b/.test(t)) return 'reroute';
  if (TIMING_RX.test(t) && !hasFromTo) return 'timing';
  if (HELP_RX.test(t) && !hasMention) return 'help';
  if (nearbyKind(t) && !hasFromTo && !ctx.hasDest) return 'nearby';
  if (FARE_WORDS.test(t) && hasFromTo && !/\b(?:minimum|floor|surge|rule|eligible|discount)\b/.test(t)) return 'fare_trip';
  if (/\b(?:student|half|chhatro|chatro|discount|minimum|floor|surge|rule|eligible|fare chart|fare rule)\b/.test(t) && !hasFromTo) return 'fare_question';
  if (NETWORK_RX.test(t) && !hasFromTo) return 'network';
  if (alertType(t) && !/\?/.test(t) && !hasFromTo) return 'report';
  if (hasFromTo || /\b(?:route|jabo|jete|ride|trip|go to|going to|want to go|need to go|have to go|wanna go|heading to|travel to|travelling to|get to|how to get|how do i get|how can i get|jaite|jacchi|jai|reach|take me|directions|direction|jete chai|jabo)\b/.test(t)) return 'route';
  if (WHERE_RX.test(t) && hasMention) return 'place_info';
  if (/\b(?:hi|hello|hey|salam|assalamu|assalamualaikum|good morning|good evening|good afternoon|start|namaskar)\b/.test(t) && t.split(' ').length < 6) return 'greeting';
  if (hasMention && mentions.length === 1 && t.trim().split(' ').length <= 4) return 'place_info';
  if (q) return 'fare_question';
  return 'other';
}

function fareTopic(t) {
  if (/\b(?:minimum|floor|min fare|10 taka|10 tk)\b/.test(t)) return 'floor';
  if (/\b(?:student|half|chhatro|chatro|discount)\b/.test(t)) return 'student';
  if (/\b(?:rickshaw|cng|surge|rain|brishti|rush|bristi)\b/.test(t)) return 'surge';
  if (/\b(?:metro|mrt)\b/.test(t)) return 'metro';
  return null;
}

function parse(text, hubs) {
  const t = norm(text);
  const ms = matchHubs(t, hubs, { places: true });
  const avoid = [];
  const rest = [];
  for (const m of ms) {
    const after = t.slice(m.end, m.end + 22);
    const before = t.slice(Math.max(0, m.start - 14), m.start);
    if (AVOID_AFTER.test(after) || AVOID_BEFORE.test(before)) avoid.push(m.hub); else rest.push(m);
  }
  let from = null, to = null, fromM = null, toM = null;
  const loose = [];
  for (const m of rest) {
    const after = t.slice(m.end, m.end + 14);
    const before = t.slice(Math.max(0, m.start - 10), m.start);
    if (FROM_AFTER.test(after) || /\bfrom\s*$/.test(before) || /^\s*to\b/.test(after)) { if (!from) { from = m.hub; fromM = m; } else loose.push(m); }
    else if (TO_AFTER.test(after) || /\b(?:to|towards|for)\s*$/.test(before)) { if (!to) { to = m.hub; toM = m; } else loose.push(m); }
    else loose.push(m);
  }
  for (const m of loose) {
    if (!from && m.hub !== to) { from = m.hub; fromM = m; }
    else if (!to && m.hub !== from) { to = m.hub; toM = m; }
  }
  // a lone hub with no markers is the destination
  if (from && !to && rest.length === 1 && !FROM_AFTER.test(t.slice(rest[0].end, rest[0].end + 14)) && !/\bfrom\s*$/.test(t.slice(Math.max(0, rest[0].start - 10), rest[0].start))) { to = from; toM = fromM; from = null; fromM = null; }

  const here = HERE_RX.test(t);
  const hasFromTo = !!((from || here) && to);
  const intent = classify(t, ms, hasFromTo || !!(to && /\b(?:jabo|jete|go to|route)\b/.test(t)), { hasDest: !!to });
  const mentioned = [...new Set(ms.map(m => m.hub))];
  const note = m => (m && m.place ? { place: m.place, hub: m.hub, km: m.placeKm, outside: !!m.outside } : null);
  const avoidNotes = ms.filter(m => avoid.includes(m.hub)).map(note).filter(Boolean);
  const hubM = rest[0] || ms.find(m => avoid.includes(m.hub)) || ms[0] || null;
  const { mode, noModes } = modePrefs(t);
  return {
    text: String(text || ''), lang: detectLang(t), intent,
    from, to, avoid: [...new Set(avoid)],
    fromPlace: fromM && fromM.place, toPlace: toM && toM.place,
    notes: [note(fromM), note(toM), ...avoidNotes].filter(Boolean),
    budget: parseBudget(t),
    student: /\b(?:student|chhatro|chatro|chhatra|half ?fare|half ?pass)\b/.test(t) || /ছাত্র/.test(t) ? true : null,
    arriveBy: parseTime(t),
    rain: /\b(?:rain|rains|rainy|raining|brishti|bristi|brishtir|monsoon)\b|বৃষ্টি/.test(t) || null,
    rush: /\b(?:rush|peak|office time|office)\b/.test(t) || null,
    alertType: alertType(t), severity: severity(t),
    hub: (hubM && hubM.hub) || null, hubPlace: hubM && hubM.place ? note(hubM) : null,
    mentions: mentioned, topic: fareTopic(t),
    mode, noModes, sort: sortPref(t), here, nearby: nearbyKind(t), fareWords: FARE_WORDS.test(t),
  };
}

module.exports = { norm, matchHubs, resolveHub, parse, detectLang, MODE_WORDS };
