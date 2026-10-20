// Run: node test/smoke.js  (uses an in-memory seed, never touches data/db.json)
const assert = require('assert');
const { seed } = require('../src/data');
const E = require('../src/engine');
const A = require('../src/alerts');

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; } };

const now = Date.now();
const db = seed(now);

t('finds multi-leg routes Mirpur -> Motijheel', () => {
  const r = E.search(db, { from: 'mirpur', to: 'motijheel', sort: 'best', student: false }, now);
  assert(r.options.length >= 2, 'expected 2+ options, got ' + r.options.length);
  assert(r.options.every(o => o.legs.length <= 4));
});

t('student bus fare is half with a 10 BDT floor', () => {
  const r = E.search(db, { from: 'mirpur', to: 'motijheel', sort: 'cheapest', student: true }, now);
  const bus = r.options.find(o => o.legs.length === 1 && o.legs[0].mode === 'bus');
  assert(bus, 'direct bus option missing');
  const f = bus.legs[0].fare;
  assert.strictEqual(f.student.lo, Math.max(10, Math.round(f.regular.lo * 0.5)));
});

t('metro has no student discount', () => {
  const r = E.search(db, { from: 'mirpur', to: 'motijheel', sort: 'fastest', student: true }, now);
  const m = r.options.find(o => o.legs.length === 1 && o.legs[0].mode === 'metro');
  assert(m && m.legs[0].fare.student.lo === m.legs[0].fare.regular.lo);
});

t('avoid hub removes routes through it', () => {
  const r = E.search(db, { from: 'mirpur', to: 'motijheel', avoid: ['farmgate'], sort: 'best' }, now);
  assert(r.options.length > 0);
  // road legs never pass the hub; metro may run over it but nobody boards or alights there
  assert(r.options.every(o => !o.legs.some(l => (l.mode !== 'metro' && l.stops.includes('farmgate')) || (l.mode === 'metro' && (l.from === 'farmgate' || l.to === 'farmgate')))));
  assert(r.options.some(o => o.legs.length === 1 && o.legs[0].mode === 'metro'), 'direct metro should survive avoiding Farmgate');
});

t('budget filter works', () => {
  const r = E.search(db, { from: 'mirpur', to: 'motijheel', budget: 60, sort: 'best' }, now);
  r.options.forEach(o => assert((o.totals.fare.regular.lo + o.totals.fare.regular.hi) / 2 <= 60));
});

t('blocked hub breaks road legs and creates a detour', () => {
  const s = E.simulate(db, { from: 'mirpur', to: 'motijheel', student: true, scenario: { blocked: ['farmgate'] }, useAlerts: false }, now);
  assert(s.scenario.options.length > 0, 'no detour found');
  assert(s.scenario.options.every(o => !o.legs.some(l => ['bus', 'cng', 'rickshaw', 'leguna'].includes(l.mode) && l.stops.includes('farmgate'))));
});

t('rain widens ranges and raises rickshaw fares', () => {
  const a = E.search(db, { from: 'dhanmondi', to: 'shahbagh', sort: 'best', useAlerts: false }, now).options[0];
  const b = E.search(db, { from: 'dhanmondi', to: 'shahbagh', sort: 'best', useAlerts: false, scenario: { rain: true } }, now).options[0];
  assert(b.totals.min.hi > a.totals.min.hi);
});

t('alert confidence decays over time', () => {
  const fresh = db.alerts.find(x => x.id === 'a1');
  const later = A.confidence(fresh, now + 24 * 3600000);
  assert(A.confidence(fresh, now) > later);
  assert(A.label(later) === 'Expired');
  const old = db.alerts.find(x => x.id === 'a4');
  assert(A.label(A.confidence(old, now)) === 'Expired', 'old seeded gridlock should already be expired');
});

t('confirm raises confidence, own report cannot be confirmed', () => {
  const a = db.alerts.find(x => x.id === 'a5');
  const before = A.confidence(a, now);
  assert(!A.confirm(db, 'a5', a.reporter, now).ok);
  assert(A.confirm(db, 'a5', 'user-x', now).ok);
  assert(A.confidence(a, now) > before);
});

t('sanity: absurd fare is rejected, plausible fare accepted', () => {
  assert.strictEqual(A.validateFare(db, { mode: 'rickshaw', from: 'farmgate', to: 'science-lab', paid: 900 }).verdict, 'rejected');
  assert.strictEqual(A.validateFare(db, { mode: 'rickshaw', from: 'farmgate', to: 'science-lab', paid: 50 }).verdict, 'plausible');
  assert.strictEqual(A.validateFare(db, { mode: 'bus', from: 'mirpur', to: 'motijheel', paid: 3 }).verdict, 'rejected');
});

t('sanity: report with unknown hub is blocked; metro text at non-metro hub is flagged', () => {
  assert(A.submit(db, { type: 'gridlock', hub: 'nowhere', severity: 2, by: 'u1' }, now).blocked);
  const r = A.submit(db, { type: 'gridlock', hub: 'badda', severity: 2, text: 'metro stopped here', by: 'u2' }, now);
  assert(r.flags.some(f => f.code === 'no_metro_here'));
});

t('time of day drives traffic: rush hour is slower than night', () => {
  const at = m => E.search(db, { from: 'dhanmondi', to: 'motijheel', arriveBy: m, sort: 'best', useAlerts: false }, now);
  const night = at(180), rush = at(480);
  assert.strictEqual(night.scenario.traffic, 0);
  assert.strictEqual(rush.scenario.trafficLabel, 'Rush hour');
  assert(rush.options[0].totals.min.hi > night.options[0].totals.min.hi);
});

t('organizer data is loaded: 16 MRT-6 stations, both bus routes, street-measured walks', () => {
  const metro = db.lines.find(l => l.id === 'mrt6');
  assert.strictEqual(metro.stops.length, 16);
  assert(db.lines.some(l => l.id === 'o-bikolpo') && db.lines.some(l => l.id === 'o-uttara_bus'));
  assert(db.walks.length > 20 && db.walks.every(w => w.geom.length >= 2));
  const r = E.search(db, { from: 'dhanmondi', to: 'uttara', sort: 'best', useAlerts: false }, now);
  assert(r.options[0].legs.some(l => l.lineId === 'o-bikolpo') && r.options[0].legs.some(l => l.mode === 'metro'), 'Dhanmondi to Uttara should use Bikolpo then MRT-6');
  assert(r.options[0].legs.every(l => Array.isArray(l.geom) && l.geom.length >= 2), 'legs carry street shapes');
});

t('fair prices use MapData street distance and give a haggling line', () => {
  const F = require('../src/fares');
  const c = F.compareFares(db, 'science-lab', 'dhanmondi', { rain: true, traffic: 1 });
  assert.strictEqual(c.source, 'MapData street network');
  assert(c.items.some(i => i.mode === 'rickshaw') && c.items.some(i => i.mode === 'bus'));
  assert(/taka dibo/.test(c.haggle.banglish) && c.haggle.tooMuch > c.haggle.offer);
  const m = F.compareFares(db, 'mirpur', 'motijheel');
  assert(m.items.some(i => i.mode === 'metro'), 'both on MRT-6, so metro fare is listed');
});

t('every bus and leguna line follows real streets', () => {
  db.lines.filter(l => l.mode !== 'metro').forEach(l => assert(Array.isArray(l.segs) && l.segs.length === l.stops.length - 1, l.id));
});

t('news parser reads RSS items and drops non-road stories when filtering', () => {
  const L = require('../src/live');
  const xml = '<rss><channel><item><title>Waterlogging cripples traffic in Farmgate - The Daily Star</title><link>https://example.com/a</link><pubDate>Thu, 16 Oct 2026 10:00:00 GMT</pubDate></item><item><title>Cricket team wins</title><link>https://example.com/b</link></item></channel></rss>';
  const items = L.parseRSS(xml, { name: 'Google News' });
  assert.strictEqual(items[0].source, 'The Daily Star');
  assert.strictEqual(L.parseRSS(xml, { name: 'Dhaka Tribune', filter: true }).length, 1);
});

t('parses Banglish and Bangla script trip requests', () => {
  const nlp = require('../src/nlp');
  const a = nlp.parse('Mirpur 10 theke Motijheel jabo, 80 takar moddhe, Farmgate avoid kore', db.hubs);
  assert.deepStrictEqual([a.from, a.to, a.budget, a.avoid[0]], ['mirpur', 'motijheel', 80, 'farmgate']);
  const b = nlp.parse('মিরপুর থেকে মতিঝিল যাবো, ৮০ টাকার মধ্যে, ছাত্র, ৮টার মধ্যে', db.hubs);
  assert.deepStrictEqual([b.from, b.to, b.budget, b.student, b.arriveBy], ['mirpur', 'motijheel', 80, true, 480]);
});

t('recognises Dhaka areas that are not stops and maps them to the nearest stop', () => {
  const nlp = require('../src/nlp');
  const a = nlp.parse('Gulshan to Dhanmondi', db.hubs);
  assert.strictEqual(a.fromPlace, 'Gulshan');
  assert(db.hubs.some(h => h.id === a.from), 'place resolves to a real hub');
  const b = nlp.parse('গুলশান থেকে এয়ারপোর্ট', db.hubs);
  assert(b.fromPlace === 'Gulshan' && b.toPlace === 'Airport', 'Bangla script place names');
  const c = nlp.parse('going to Motijheel', db.hubs);
  assert.strictEqual(c.to, 'motijheel');
  assert(!c.toPlace, 'the word "going" must not be read as Tongi');
  assert(nlp.parse('Savar to Motijheel', db.hubs).notes.some(n => n.outside), 'places far outside the city are flagged');
  assert.strictEqual(nlp.parse('guslhan to banani', db.hubs).fromPlace, 'Gulshan', 'swapped letters are forgiven');
});

t('reads travel mode, sort and "from here" preferences', () => {
  const nlp = require('../src/nlp');
  const a = nlp.parse('Mirpur to Motijheel by bus, no metro, cheapest', db.hubs);
  assert.deepStrictEqual([a.mode, a.noModes, a.sort], ['bus', ['metro'], 'cheapest']);
  const b = nlp.parse('from here to Motijheel', db.hubs);
  assert(b.here && b.to === 'motijheel' && b.intent === 'route');
  assert.strictEqual(nlp.parse('nearest metro station', db.hubs).intent, 'nearby');
  assert.strictEqual(nlp.parse('what can you do', db.hubs).intent, 'help');
  assert.strictEqual(nlp.parse('thanks', db.hubs).intent, 'smalltalk');
});

t('search honours a required and an excluded travel mode', () => {
  const must = E.search(db, { from: 'mirpur', to: 'motijheel', mode: 'bus', useAlerts: false }, now);
  assert(must.options.length && must.options.every(o => o.legs.some(l => l.mode === 'bus')));
  const skip = E.search(db, { from: 'mirpur', to: 'motijheel', noModes: ['metro'], useAlerts: false }, now);
  assert(skip.options.length && skip.options.every(o => o.legs.every(l => l.mode !== 'metro')));
});

console.log(`\n${pass} checks passed`);
