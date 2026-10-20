// Guided tour: walks a judge or first-time user through the real features, running each one live.
const until = async (fn, ms = 8000) => { const t = Date.now(); while (!fn() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 120)); };
const quiet = () => ({ rain: false, rainZones: [], rush: false, blocked: [] });
async function onGo() { if (S.tab !== 'go') go('go'); await until(() => !!$('#goBody')); }
async function tourSay(text) { await onGo(); await until(() => !S.goBusy); await sendGo(text); await until(() => !S.searching && !S.goBusy); }

const TOUR = [
  {
    t: 'Ask anything, one box', p: 'One search box does it all: routes, street reports and fare questions, in English, Banglish or Bangla. "Today in Dhaka" sums up the roads right now.',
    run: async () => { S.thread = []; S.activeMsg = null; S.result = null; S.sim = null; S.view = 'list'; S.scn = quiet(); S.q.arriveBy = '08:00'; S.q.avoid = []; S.q.budget = ''; S.optsOpen = false; await onGo(); paintGo(); drawMap(); },
  },
  {
    t: 'It understands Banglish', p: 'DhakaPath picked out the start, the destination, the budget and a place to avoid, then ranked the routes. Every route and fare comes from its own network.',
    run: async () => { await tourSay('Mirpur 10 theke Motijheel jabo, 80 takar moddhe, Farmgate avoid kore, student'); },
  },
  {
    t: 'Read a route at a glance', p: 'Each bar is one route, coloured by transport and sized by time. The faded end shows how late it could be. The blue line explains why the top route is best.',
    run: async () => { await onGo(); if (S.view === 'detail') ACTIONS.backList(); },
  },
  {
    t: 'What if?', p: 'Move the time and switch on rain. At 6 PM in heavy rain, road routes slow down and rickshaw fares rise, while the metro barely changes.',
    run: async () => { await onGo(); S.q.arriveBy = '18:00'; S.scn.rain = true; await runSearch(); paintWhatIf(); },
  },
  {
    t: 'A junction gets blocked', p: 'Shahbagh is blocked. The usual bus is cut there, shown in red on the map, and DhakaPath routes around it.',
    run: async () => { S.scn = { ...quiet(), blocked: ['shahbagh'] }; S.q.arriveBy = '08:00'; await tourSay('Dhanmondi theke Motijheel'); },
  },
  {
    t: 'Step by step', p: 'Open a route for when to leave, boarding landmarks, a student fare breakdown, and proof that every part is real.',
    run: async () => { await onGo(); await until(() => S.result && !S.searching); ACTIONS.open({ dataset: { i: '0' } }); },
  },
  {
    t: 'Report by talking', p: 'Say what you see. The AI turns it into a clean report and asks before sending, so a misheard word never becomes a public alert.',
    run: async () => { S.scn = quiet(); S.view = 'list'; await tourSay('Farmgate e jol jomeche'); },
  },
  {
    t: 'Live', p: 'People confirm each other with one tap. A report grows more certain with every "Yes" and fades by itself when nobody checks it.',
    run: async () => { await sendGo('No, cancel'); go('live'); },
  },
  { t: 'Every answer is checked', p: 'A pretend AI plan with made-up parts is caught, part by part. That is how DhakaPath keeps its answers honest.', run: async () => { go('trust'); } },
  { t: 'And a few extras', p: 'Under More: the full network, ride sharing with a fare-splitting bot, signboard scanning with AI, and a fare checker. Any route can be read aloud or saved as an offline card.', run: async () => { go('more'); } },
];
let tourAt = -1;

function paintTour() {
  const el = $('#tour');
  if (tourAt < 0) { el.hidden = true; return; }
  const s = TOUR[tourAt];
  el.hidden = false;
  el.innerHTML = `<div class="row between"><div class="dots">${TOUR.map((_, i) => `<i class="${i === tourAt ? 'on' : ''}"></i>`).join('')}</div><button class="round" data-act="tourEnd" aria-label="End tour">${ic('x')}</button></div>
    <h3 style="margin-top:12px">${esc(s.t)}</h3><p>${esc(s.p)}</p>
    <div class="row between" style="margin-top:16px"><button class="btn sm" data-act="tourBack" ${tourAt === 0 ? 'disabled' : ''}>Back</button><span class="tiny muted">${tourAt + 1} of ${TOUR.length}</span><button class="btn sm fill" data-act="tourNext">${tourAt === TOUR.length - 1 ? 'Done' : 'Next'}</button></div>`;
}
async function tourGo(i) {
  tourAt = i;
  paintTour();
  try { await TOUR[i].run(); } catch (e) { console.error(e); }
}
ACTIONS.tour = () => tourGo(0);
ACTIONS.tourNext = () => { if (tourAt >= TOUR.length - 1) { tourAt = -1; paintTour(); toast('That is everything. It is all live, so try it.'); } else tourGo(tourAt + 1); };
ACTIONS.tourBack = () => { if (tourAt > 0) tourGo(tourAt - 1); };
ACTIONS.tourEnd = () => { tourAt = -1; paintTour(); };
