// Short spoken / offline-card briefing built only from verified route data.
const E = require('./engine');

const MODE = { metro: 'MRT-6', bus: 'bus', leguna: 'leguna', rickshaw: 'rickshaw', cng: 'CNG', walk: 'walk' };
const money = r => (r.lo === r.hi ? `${r.lo} taka` : `${r.lo} to ${r.hi} taka`);

function build(db, option, q) {
  const g = E.getGraph(db);
  const n = h => g.hubMap[h].name;
  const who = q.student ? 'student' : 'regular';
  const lines = [];
  lines.push(`Route from ${n(option.legs[0].from)} to ${n(option.legs[option.legs.length - 1].to)}.`);
  option.legs.forEach((l, i) => {
    const mode = MODE[l.mode];
    lines.push(`Step ${i + 1}: ${mode} from ${n(l.from)} to ${n(l.to)}, about ${Math.round(l.min.mid)} minutes${l.mode === 'walk' ? '' : `, ${money(l.fare[who])}`}.${l.instruction ? ' ' + l.instruction.replace(/^Transfer at [^.]+\. /, '') : ''}`);
  });
  const t = option.totals;
  lines.push(`Total time ${t.min.lo} to ${t.min.hi} minutes. Total ${who} fare ${money(t.fare[who])}.`);
  if (Number.isFinite(q.arriveBy) && Number.isFinite(option.leaveByMin)) lines.push(`To arrive by ${E.fmtClock(q.arriveBy)}, leave by ${E.fmtClock(option.leaveByMin)}.`);
  const alerts = [];
  option.legs.forEach(l => l.alerts.forEach(a => { if (!alerts.find(x => x.id === a.id)) alerts.push(a); }));
  if (alerts.length) lines.push('Warnings: ' + alerts.map(a => `${a.type} at ${n(a.hub)}, ${Math.round(a.conf * 100)} percent sure`).join('; ') + '.');
  else lines.push('No active alerts on this route.');
  return { text: lines.join(' '), lines };
}

module.exports = { build };
