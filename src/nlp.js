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
  }
  return d[m][n];
}

function aliasList(hubs) {
  const list = [];
  for (const h of hubs) {
    const names = new Set([h.name, h.id.replace(/-/g, ' '), ...(h.aliases || [])]);
    for (const a of names) list.push({ alias: norm(a).trim(), hub: h.id });
  }
  return list.sort((x, y) => y.alias.length - x.alias.length);
}

// Finds hub mentions as [{hub, start, end}] in normalized text t (which has leading/trailing space).
function matchHubs(t, hubs) {
  const used = new Array(t.length).fill(false);
  const found = [];
  const free = (s, e) => { for (let i = s; i < e; i++) if (used[i]) return false; return true; };
  const mark = (s, e) => { for (let i = s; i < e; i++) used[i] = true; };
  const list = aliasList(hubs);
  for (const { alias, hub } of list) {
    let from = 0;
    while (true) {
      const i = t.indexOf(alias, from);
      if (i < 0) break;
      const before = t[i - 1], after = t[i + alias.length];
      const wordEdge = (!before || before === ' ') && (!after || after === ' ' || /[a-z]/.test(after) === false || ['e', 't'].includes(after));
      // allow Banglish suffix like "motijheele" / "farmgatete": letter right after the name
      if (wordEdge && free(i, i + alias.length)) { found.push({ hub, start: i, end: i + alias.length }); mark(i, i + alias.length); }
      from = i + alias.length;
    }
  }
  // typo tolerance for single words
  const words = [...t.matchAll(/[a-z]{5,}/g)];
  for (const w of words) {
    const s = w.index, e = s + w[0].length;
    if (!free(s, e)) continue;
    let best = null;
    for (const { alias, hub } of list) {
      if (alias.includes(' ')) continue;
      const dist = lev(w[0], alias);
      const lim = alias.length >= 8 ? 2 : 1;
      if (dist <= lim && (!best || dist < best.dist)) best = { hub, dist };
    }
    if (best) { found.push({ hub: best.hub, start: s, end: e }); mark(s, e); }
  }
  return found.sort((a, b) => a.start - b.start);
}

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

function classify(t, mentions, hasFromTo) {
  const q = /\?|\bkoto\b|\bhow much\b|\bkeno\b|\bwhy\b|\bkon\b|\bwhat\b|\bki\b/.test(t);
  if (/\b(?:reliable|reliability|trust|accurate|confidence|sure|sotti|vul|purano|stale|expire\w*|outdated|how old|kotota)\b/.test(t)) return 'reliability';
  if (/\b(?:student|half|chhatro|chatro|discount|minimum|floor|surge|rule|eligible|fare chart|fare rule)\b/.test(t) && !hasFromTo) return 'fare_question';
  if (/\b(?:alternative|alternatives|reroute|detour|bikolpo|onno route|onno poth|other route|another route|ar kono|else)\b/.test(t)) return 'reroute';
  if (alertType(t) && !/\?/.test(t) && !hasFromTo) return 'report';
  if (hasFromTo || /\b(?:route|jabo|jete|ride|trip|go to|get to|how to get|jaite|jacchi|jai)\b/.test(t)) return 'route';
  if (/\b(?:hi|hello|hey|salam|assalamu|help|start)\b/.test(t) && t.split(' ').length < 6) return 'greeting';
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
  const ms = matchHubs(t, hubs);
  const avoid = [];
  const rest = [];
  for (const m of ms) {
    const after = t.slice(m.end, m.end + 22);
    const before = t.slice(Math.max(0, m.start - 14), m.start);
    if (AVOID_AFTER.test(after) || AVOID_BEFORE.test(before)) avoid.push(m.hub); else rest.push(m);
  }
  let from = null, to = null;
  const loose = [];
  for (const m of rest) {
    const after = t.slice(m.end, m.end + 14);
    const before = t.slice(Math.max(0, m.start - 10), m.start);
    if (FROM_AFTER.test(after) || /\bfrom\s*$/.test(before) || /^\s*to\b/.test(after)) { if (!from) from = m.hub; else loose.push(m); }
    else if (TO_AFTER.test(after) || /\b(?:to|towards|for)\s*$/.test(before)) { if (!to) to = m.hub; else loose.push(m); }
    else loose.push(m);
  }
  for (const m of loose) {
    if (!from && m.hub !== to) from = m.hub;
    else if (!to && m.hub !== from) to = m.hub;
  }
  // a lone hub with no markers is the destination
  if (from && !to && rest.length === 1 && !FROM_AFTER.test(t.slice(rest[0].end, rest[0].end + 14)) && !/\bfrom\s*$/.test(t.slice(Math.max(0, rest[0].start - 10), rest[0].start))) { to = from; from = null; }

  const hasFromTo = !!(from && to);
  const intent = classify(t, ms, hasFromTo || (to && /\b(?:jabo|jete|go to|route)\b/.test(t)));
  const mentioned = [...new Set(ms.map(m => m.hub))];
  return {
    text: String(text || ''), lang: detectLang(t), intent,
    from, to, avoid: [...new Set(avoid)],
    budget: parseBudget(t),
    student: /\b(?:student|chhatro|chatro|chhatra|half ?fare|half ?pass)\b/.test(t) || /ছাত্র/.test(t) ? true : null,
    arriveBy: parseTime(t),
    rain: /\b(?:rain|raining|brishti|bristi|brishtir|monsoon)\b/.test(t) || null,
    rush: /\b(?:rush|peak|office time|office)\b/.test(t) || null,
    alertType: alertType(t), severity: severity(t),
    hub: (rest[0] && rest[0].hub) || avoid[0] || mentioned[0] || null,
    mentions: mentioned, topic: fareTopic(t),
  };
}

module.exports = { norm, matchHubs, resolveHub, parse, detectLang };
