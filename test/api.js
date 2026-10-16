// Run: node test/api.js  (starts the server on a random port with a throwaway db copy in memory; no network needed)
const assert = require('assert');
process.env.GEMINI_API_KEY = '';
process.env.GROQ_API_KEY = '';
const { server } = require('../server');
const D = require('../src/data');

let pass = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('ok   ' + name); } else { console.error('FAIL ' + name + (extra ? '\n     ' + extra : '')); process.exitCode = 1; } };

server.listen(0, async () => {
  const port = server.address().port;
  const call = async (method, path, body, admin) => {
    const r = await fetch(`http://localhost:${port}${path}`, { method, headers: { 'content-type': 'application/json', ...(admin ? { 'x-admin-pin': 'dhaka' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, j: await r.json() };
  };
  const say = async (m, extra = {}) => (await call('POST', '/api/chat', { sessionId: 't1', uid: 'tester', message: m, ...extra })).j;
  try {
    D.reset();
    const st = (await call('GET', '/api/state')).j;
    ok('state has the 14 core hubs plus organizer stops, and alerts', st.hubs.length >= 14 && st.hubs.some(h => h.id === 'uttara-north') && st.lines.some(l => l.id === 'o-bikolpo') && st.alerts.length >= 4);

    const ask = (await call('POST', '/api/ask', { text: 'Mirpur 10 theke Motijheel jabo, 80 takar moddhe, Farmgate avoid kore, student', student: false })).j;
    ok('ask parses Banglish and returns ranked routes', ask.parsed.from === 'mirpur' && ask.parsed.to === 'motijheel' && ask.parsed.avoid.includes('farmgate') && ask.result.options.length > 0, JSON.stringify(ask.parsed));
    ok('ask honors avoid + student', ask.query.student === true && ask.result.options.every(o => !o.legs.some(l => l.mode !== 'metro' && l.stops.includes('farmgate'))));

    const sim = (await call('POST', '/api/simulate', { from: 'dhanmondi', to: 'motijheel', student: true, scenario: { blocked: ['shahbagh'] }, useAlerts: false })).j.sim;
    ok('simulate returns broken segment and detour', sim.segments.some(s => s.status === 'broken') && sim.scenBest && sim.detour.changed, JSON.stringify({ d: sim.detour, s: sim.segments.length }));
    const metroSim = (await call('POST', '/api/simulate', { from: 'mirpur', to: 'motijheel', student: true, scenario: { blocked: ['farmgate'] }, useAlerts: false })).j.sim;
    ok('a road blockade leaves the elevated metro running', metroSim.segments.length === 0 && metroSim.scenBest.legs.some(l => l.mode === 'metro'));

    let c = await say('Mirpur theke Motijheel jabo, student');
    ok('chat route answer with proof chips', /Best option|Shobcheye/.test(c.reply) && c.chips.length > 0, c.reply);
    c = await say('Farmgate avoid kore alternative koto?');
    ok('chat reroute uses memory of last trip', /Farmgate/.test(c.reply) && c.query && c.query.from === 'mirpur', c.reply);
    c = await say('student fare koto?');
    ok('chat fare question uses last trip', /student/i.test(c.reply) && /last trip|ager trip/.test(c.reply), c.reply);
    c = await say('Malibagh alert ta kotota reliable?');
    ok('chat reliability explains confidence', /%/.test(c.reply) && /Malibagh/.test(c.reply), c.reply);
    c = await say('Badda te bhishon jam hoyeche');
    ok('chat drafts a report and asks before sending', c.draft && c.draft.hub === 'badda' && !c.mutated, c.reply);
    c = await say('ha');
    ok('saying yes files the report', /Report saved|report save/i.test(c.reply) && c.mutated, c.reply);
    c = await say('Farmgate e jol jomeche');
    c = await say('na thak');
    ok('saying no cancels the draft', /not sent|pathano holo na/i.test(c.reply) && !c.mutated, c.reply);
    c = await say('gridlock hocche');
    ok('chat asks a follow-up when hub is missing', /Kon hub|Which hub/.test(c.reply), c.reply);
    c = await say('Uttara');
    ok('chat completes the draft once the hub is known', c.draft && c.draft.hub === 'uttara', c.reply);
    c = await say('yes');
    ok('and files it on yes', /Report saved|report save/i.test(c.reply), c.reply);

    const u = (await call('POST', '/api/understand', { text: 'Mirpur theke Motijheel 80 takar moddhe' })).j;
    ok('understand reads a sentence instantly', u.from === 'mirpur' && u.to === 'motijheel' && u.budget === 80);
    const why = (await call('POST', '/api/why', { query: { from: 'mirpur', to: 'motijheel', student: true } })).j;
    ok('why explains the top route in a sentence', why.ok && /best pick because/.test(why.text), why.text);
    const today = (await call('GET', '/api/today')).j;
    ok('today summarises traffic and alerts', today.ok && /right now/.test(today.text) && Number.isFinite(today.alerts), today.text);

    const g1 = (await call('POST', '/api/ground', { plan: (await call('GET', '/api/ground/samples')).j.fake })).j;
    const g2 = (await call('POST', '/api/ground', { plan: (await call('GET', '/api/ground/samples')).j.real })).j;
    ok('grounding blocks the fake legs and keeps the real one', g1.ok === false && g1.legs.filter(l => !l.ok).length === 2 && g1.verified === 1, JSON.stringify(g1.legs.map(l => l.issues)));
    ok('grounding accepts the real plan', g2.ok === true, JSON.stringify(g2.legs.map(l => l.issues)));

    const f = (await call('POST', '/api/fare-report', { mode: 'rickshaw', from: 'farmgate', to: 'science-lab', paid: 900 })).j;
    ok('absurd fare rejected, not saved', f.verdict === 'rejected' && !f.saved);

    const rj = (await call('POST', '/api/alerts', { type: 'gridlock', hub: 'atlantis', severity: 2, by: 'x' })).status;
    ok('alert for unknown hub is refused', rj === 422);

    const noAdmin = (await call('POST', '/api/connectors', { mode: 'cng', from: 'uttara', to: 'badda' })).status;
    const withAdmin = (await call('POST', '/api/connectors', { mode: 'cng', from: 'uttara', to: 'badda' }, true)).status;
    ok('admin endpoints need the PIN', noAdmin === 403 && withAdmin === 200);

    const sc = (await call('POST', '/api/scan', { text: 'Winner: Mirpur 10 - Agargaon - Farmgate - Motijheel Fare 40\nGhost: Narnia - Motijheel' })).j;
    ok('scan text makes a draft and flags unknown stops', sc.drafts[0].ok && sc.drafts[0].fare === 40 && sc.drafts[1].unknown.includes('Narnia'));

    const ride = (await call('POST', '/api/rides', { hub: 'farmgate', dest: 'science-lab', mode: 'rickshaw', seats: 2, name: 'Rafi' })).j;
    const joined = (await call('POST', `/api/rides/${ride.ride.id}/join`, { name: 'Nila' })).j;
    ok('ride-share bot splits the fare', joined.ride.split.people === 2 && joined.ride.messages.some(m => m.from === 'bot' && /each pays/.test(m.text)));

    const br = (await call('POST', '/api/briefing', { query: { from: 'mirpur', to: 'motijheel', student: true, arriveBy: 480 } })).j;
    ok('briefing text has leave-by time', /leave by/.test(br.text), br.text);
  } catch (e) {
    console.error('ERROR', e);
    process.exitCode = 1;
  }
  console.log(`\n${pass} API checks passed`);
  server.close();
  D.reset();
});
