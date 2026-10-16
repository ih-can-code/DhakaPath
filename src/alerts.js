// Street alerts: confidence, time decay, corroboration, and rule-based sanity checks.
const { km } = require('./geo');
const F = require('./fares');

const TYPES = ['waterlogging', 'construction', 'gridlock', 'blockade'];
const HALF_LIFE_MIN = { waterlogging: 150, gridlock: 40, construction: 3 * 24 * 60, blockade: 60 };
const ACTIVE_MIN = 0.35; // used by routing
const WEAK_MIN = 0.15; // below this the alert is expired
const BASE = 0.55;
const CONFIRM_STEP = 0.4; // each independent confirm closes 40% of the remaining doubt

const uid = () => 'a' + Math.random().toString(36).slice(2, 8);

function confidence(a, now = Date.now()) {
  if (a.status !== 'open') return 0;
  let c = BASE;
  for (let i = 0; i < a.confirms.length; i++) c = 1 - (1 - c) * (1 - CONFIRM_STEP);
  if (a.flags && a.flags.length && !a.confirms.length) c *= 0.5;
  const ageMin = Math.max(0, (now - a.lastVerifiedAt) / 60000);
  const decay = Math.pow(0.5, ageMin / HALF_LIFE_MIN[a.type]);
  c = c * decay * Math.pow(0.5, a.resolves.length);
  return Math.round(c * 100) / 100;
}

function label(c) {
  if (c >= 0.6) return 'Confirmed';
  if (c >= ACTIVE_MIN) return 'Likely';
  if (c >= WEAK_MIN) return 'Weak, fading';
  return 'Expired';
}

function decorate(a, now) {
  const conf = confidence(a, now);
  return {
    ...a,
    conf,
    label: a.status === 'open' ? label(conf) : a.status === 'resolved' ? 'Resolved' : 'Rejected',
    ageMin: Math.round((now - a.createdAt) / 60000),
    sinceVerifiedMin: Math.round((now - a.lastVerifiedAt) / 60000),
    halfLifeMin: HALF_LIFE_MIN[a.type],
  };
}

function all(db, now = Date.now()) {
  return db.alerts.map(a => decorate(a, now));
}

function activeAlerts(db, now = Date.now(), min = ACTIVE_MIN) {
  return all(db, now).filter(a => a.status === 'open' && a.conf >= min);
}

function hubHasMetro(db, hub) {
  return db.lines.some(l => l.mode === 'metro' && l.stops.includes(hub));
}

// Rule-based checks before a street report is stored. Never throws.
function validateReport(db, input, now = Date.now()) {
  const flags = [];
  let blocked = false;
  const hub = db.hubs.find(h => h.id === input.hub);
  if (!hub) { flags.push({ code: 'unknown_hub', msg: 'That hub is not in the network.' }); blocked = true; }
  if (!TYPES.includes(input.type)) { flags.push({ code: 'unknown_type', msg: 'Unknown report type.' }); blocked = true; }
  const sev = Number(input.severity);
  if (!(sev >= 1 && sev <= 3)) { flags.push({ code: 'bad_severity', msg: 'Severity must be 1, 2 or 3.' }); blocked = true; }
  const text = String(input.text || '').trim();
  if (text.length > 280) { flags.push({ code: 'too_long', msg: 'Report text is too long.' }); blocked = true; }

  if (!blocked) {
    const mine = db.alerts.filter(a => a.reporter === input.by && now - a.createdAt < 10 * 60000);
    if (mine.length >= 4) { flags.push({ code: 'rate_limit', msg: 'Too many reports in 10 minutes from the same reporter.' }); blocked = true; }

    const sameHub = db.alerts.filter(a => a.hub === input.hub && a.status === 'open');
    const resolvedRecently = db.alerts.find(a => a.hub === input.hub && a.type === input.type && a.status === 'resolved' && a.resolvedBy === input.by && now - (a.resolvedAt || 0) < 10 * 60000);
    if (resolvedRecently) flags.push({ code: 'contradiction', msg: 'You marked this hub as resolved a few minutes ago, so this report contradicts it.' });

    const conflicting = sameHub.find(a => a.type === input.type && Math.abs(a.severity - sev) >= 2 && confidence(a, now) >= 0.6);
    if (conflicting) flags.push({ code: 'severity_conflict', msg: `A confirmed ${conflicting.type} report at this hub says severity ${conflicting.severity}.` });

    if (/metro|mrt/i.test(text) && !hubHasMetro(db, input.hub)) {
      flags.push({ code: 'no_metro_here', msg: 'The report mentions the metro, but this hub has no MRT station.' });
    }
    if (/\b(clear|no jam|normal)\b/i.test(text) && sev >= 2) {
      flags.push({ code: 'text_severity_mismatch', msg: 'The text says the road is clear, but the severity is high.' });
    }
  }
  return { ok: !blocked, blocked, flags };
}

function submit(db, input, now = Date.now()) {
  const v = validateReport(db, input, now);
  if (v.blocked) return { ok: false, blocked: true, flags: v.flags, message: v.flags.map(f => f.msg).join(' ') };

  const dup = db.alerts.find(a => a.hub === input.hub && a.type === input.type && a.status === 'open' && now - a.lastVerifiedAt < 30 * 60000);
  if (dup) {
    if (dup.reporter === input.by || dup.confirms.some(c => c.by === input.by)) {
      return { ok: true, merged: true, alert: decorate(dup, now), flags: v.flags, message: 'You already reported this. It is still open.' };
    }
    dup.confirms.push({ by: input.by, ts: now });
    dup.lastVerifiedAt = now;
    return { ok: true, merged: true, alert: decorate(dup, now), flags: v.flags, message: 'A matching report already exists, so yours counted as a confirmation.' };
  }

  const a = {
    id: uid(), type: input.type, hub: input.hub, severity: Number(input.severity),
    text: String(input.text || '').trim(), reporter: input.by || 'anon',
    createdAt: now, lastVerifiedAt: now, confirms: [], resolves: [], status: 'open',
    flags: v.flags.map(f => f.code),
  };
  db.alerts.unshift(a);
  const d = decorate(a, now);
  return {
    ok: true, alert: d, flags: v.flags,
    message: v.flags.length
      ? 'Saved but flagged. It will not change routes until another commuter confirms it.'
      : 'Report saved. It starts at moderate confidence and grows as others confirm it.',
  };
}

function confirm(db, id, by, now = Date.now()) {
  const a = db.alerts.find(x => x.id === id);
  if (!a || a.status !== 'open') return { ok: false, message: 'That alert is not open.' };
  if (a.reporter === by) return { ok: false, message: 'You cannot confirm your own report.' };
  if (a.confirms.some(c => c.by === by)) return { ok: false, message: 'You already confirmed this.' };
  a.confirms.push({ by, ts: now });
  a.lastVerifiedAt = now;
  return { ok: true, alert: decorate(a, now), message: 'Thanks. Confidence went up and the fade timer restarted.' };
}

function resolve(db, id, by, now = Date.now()) {
  const a = db.alerts.find(x => x.id === id);
  if (!a || a.status !== 'open') return { ok: false, message: 'That alert is not open.' };
  if (a.resolves.some(r => r.by === by)) return { ok: false, message: 'You already voted to resolve this.' };
  a.resolves.push({ by, ts: now });
  const needed = Math.max(2, a.confirms.length + 1);
  if (a.resolves.length >= needed) {
    a.status = 'resolved';
    a.resolvedAt = now;
    a.resolvedBy = by;
  }
  return { ok: true, alert: decorate(a, now), message: a.status === 'resolved' ? 'Enough votes. Alert marked resolved.' : `Vote counted (${a.resolves.length}/${needed} needed).` };
}

// Fare sanity check against the rule-based fair range. Returns a verdict and reasons.
function validateFare(db, input) {
  const flags = [];
  const paid = Number(input.paid);
  const mode = input.mode;
  const a = db.hubs.find(h => h.id === input.from);
  const b = db.hubs.find(h => h.id === input.to);
  if (!a || !b || a.id === b.id) return { verdict: 'rejected', flags: [{ code: 'bad_hubs', msg: 'Pick two different hubs.' }], expected: null };
  if (!['bus', 'metro', 'leguna', 'rickshaw', 'cng'].includes(mode)) return { verdict: 'rejected', flags: [{ code: 'bad_mode', msg: 'Unknown mode.' }], expected: null };
  if (!(paid > 0) || !Number.isFinite(paid)) return { verdict: 'rejected', flags: [{ code: 'bad_amount', msg: 'Fare must be a positive number.' }], expected: null };

  const road = mode === 'metro' ? km(a, b) * 1.15 : F.roadDistance(db, a.id, b.id).km; // MapData street distance
  const f = F.legFare({ mode, km: road }, { rules: db.rules, rush: true, rainOn: true });
  const base = F.legFare({ mode, km: road }, { rules: db.rules });
  const lo = base.base.lo;
  const hi = f.regular.hi; // highest plausible: full surge
  const expected = { lo: base.base.lo, hi: base.base.hi, surgeHi: hi, km: Math.round(road * 10) / 10 };

  if (mode === 'bus') {
    if (paid < db.rules.bus.floor) flags.push({ code: 'below_floor', msg: `Bus fares never go below ৳${db.rules.bus.floor}.` });
    if (input.student && paid < base.student.lo) flags.push({ code: 'below_student', msg: `Student fare is at least ৳${base.student.lo} for this trip.` });
    if (paid > base.regular.hi * 1.6) flags.push({ code: 'overcharge', msg: `Fixed bus fare is ৳${base.regular.lo}; ৳${paid} is far above it.` });
  } else if (mode === 'metro') {
    if (paid < db.rules.metro.min || paid > db.rules.metro.max) flags.push({ code: 'metro_range', msg: `MRT-6 fares range from ৳${db.rules.metro.min} to ৳${db.rules.metro.max}.` });
  } else {
    if (paid > hi * 2) flags.push({ code: 'implausible_high', msg: `Even with full surge the fair range tops out near ৳${hi}.` });
    if (paid < lo * 0.4) flags.push({ code: 'implausible_low', msg: `Fares below about ৳${Math.round(lo * 0.4)} are unrealistic for ${expected.km} km.` });
  }
  const hard = flags.some(f => ['below_floor', 'implausible_high', 'implausible_low', 'metro_range', 'overcharge'].includes(f.code));
  let verdict = 'plausible';
  if (hard) verdict = 'rejected';
  else if (flags.length) verdict = 'suspicious';
  else if (mode !== 'bus' && mode !== 'metro' && (paid > hi || paid < lo * 0.7)) {
    verdict = 'suspicious';
    flags.push({ code: 'outside_range', msg: `Outside the usual ৳${lo}-${hi} range for this trip.` });
  }
  return { verdict, flags, expected };
}

function submitFare(db, input, now = Date.now()) {
  const r = validateFare(db, input);
  const rec = { id: 'f' + Math.random().toString(36).slice(2, 7), ts: now, mode: input.mode, from: input.from, to: input.to, paid: Number(input.paid), student: !!input.student, by: input.by || 'anon', verdict: r.verdict };
  if (r.verdict !== 'rejected') db.fareReports.unshift(rec);
  const good = db.fareReports.filter(x => x.mode === input.mode && x.from === input.from && x.to === input.to && x.verdict === 'plausible').map(x => x.paid).sort((x, y) => x - y);
  const median = good.length ? good[Math.floor(good.length / 2)] : null;
  return { ...r, saved: r.verdict !== 'rejected', median, samples: good.length };
}

module.exports = {
  TYPES, HALF_LIFE_MIN, ACTIVE_MIN, WEAK_MIN,
  confidence, label, decorate, all, activeAlerts, validateReport, submit, confirm, resolve, validateFare, submitFare,
};
