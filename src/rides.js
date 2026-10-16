// Ride-share board: commuters at the same hub split a rickshaw/CNG. The bot calculates per-person cost.
const { km } = require('./geo');
const F = require('./fares');
const E = require('./engine');

const uid = () => 'r' + Math.random().toString(36).slice(2, 7);
const money = r => (r.lo === r.hi ? `৳${r.lo}` : `৳${r.lo}-${r.hi}`);

function fareFor(db, ride) {
  const a = db.hubs.find(h => h.id === ride.hub);
  const b = db.hubs.find(h => h.id === ride.dest);
  const road = km(a, b) * E.ROAD_FACTOR[ride.mode === 'cng' ? 'cng' : 'rickshaw'];
  return { km: Math.round(road * 10) / 10, ...F.flexRange(ride.mode, road, db.rules, { rush: !!ride.rush, rainOn: !!ride.rain }) };
}

function split(fare, people) {
  const per = r => ({ lo: Math.ceil(r.lo / people / 5) * 5, hi: Math.ceil(r.hi / people / 5) * 5 });
  return { people, perPerson: per(fare.now), basePerPerson: per(fare.base), saving: Math.max(0, Math.round((1 - 1 / people) * 100)) };
}

function botNote(db, ride) {
  const f = fareFor(db, ride);
  const n = ride.joined.length;
  const s = split(f, n);
  const hub = db.hubs.find(h => h.id === ride.hub).name;
  const dest = db.hubs.find(h => h.id === ride.dest).name;
  const surge = f.surge > 1 ? ` Surge x${f.surge.toFixed(2)} is included (${[ride.rush ? 'rush hour' : null, ride.rain ? 'rain' : null].filter(Boolean).join(' + ')}).` : '';
  return `Fare bot: ${hub} to ${dest}, about ${f.km} km. Whole ${ride.mode === 'cng' ? 'CNG' : 'rickshaw'} fare is ${money(f.now)}.${surge} With ${n} rider${n === 1 ? '' : 's'}, each pays about ${money(s.perPerson)}${n > 1 ? ` (saves ${s.saving}%)` : ''}. Agree the price with the driver before you start.`;
}

function create(db, input, now = Date.now()) {
  const hub = db.hubs.find(h => h.id === input.hub);
  const dest = db.hubs.find(h => h.id === input.dest);
  if (!hub || !dest || hub.id === dest.id) return { ok: false, message: 'Pick two different hubs.' };
  const mode = input.mode === 'cng' ? 'cng' : 'rickshaw';
  const seats = Math.min(mode === 'cng' ? 4 : 2, Math.max(2, Number(input.seats) || (mode === 'cng' ? 4 : 2)));
  const name = String(input.name || 'Commuter').trim().slice(0, 24) || 'Commuter';
  const ride = {
    id: uid(), hub: hub.id, dest: dest.id, mode, seats, when: String(input.when || 'Now').slice(0, 20),
    rush: !!input.rush, rain: !!input.rain, createdAt: now, by: input.by || name, joined: [name], messages: [],
  };
  ride.messages.push({ from: 'bot', text: botNote(db, ride), ts: now });
  db.rides.unshift(ride);
  db.rides = db.rides.slice(0, 40);
  return { ok: true, ride: view(db, ride) };
}

function join(db, id, name, now = Date.now()) {
  const ride = db.rides.find(r => r.id === id);
  if (!ride) return { ok: false, message: 'Ride not found.' };
  name = String(name || 'Commuter').trim().slice(0, 24) || 'Commuter';
  if (ride.joined.length >= ride.seats) return { ok: false, message: 'This ride is full.' };
  if (ride.joined.includes(name)) return { ok: false, message: 'You already joined.' };
  ride.joined.push(name);
  ride.messages.push({ from: 'bot', text: `${name} joined. ${botNote(db, ride)}`, ts: now });
  return { ok: true, ride: view(db, ride) };
}

function message(db, id, name, text, now = Date.now()) {
  const ride = db.rides.find(r => r.id === id);
  const t = String(text || '').trim().slice(0, 200);
  if (!ride || !t) return { ok: false, message: 'Nothing to send.' };
  ride.messages.push({ from: String(name || 'Commuter').slice(0, 24), text: t, ts: now });
  if (/\b(?:fare|cost|koto|split|share|per person|bhara)\b/i.test(t)) ride.messages.push({ from: 'bot', text: botNote(db, ride), ts: now });
  return { ok: true, ride: view(db, ride) };
}

function view(db, ride) {
  const f = fareFor(db, ride);
  return { ...ride, fare: f, split: split(f, ride.joined.length), hubName: db.hubs.find(h => h.id === ride.hub).name, destName: db.hubs.find(h => h.id === ride.dest).name };
}

const list = db => db.rides.map(r => view(db, r));

module.exports = { create, join, message, list, fareFor, split };
