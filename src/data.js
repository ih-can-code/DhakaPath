// Seed data + JSON persistence. Fares, line names and landmark notes are SAMPLE values (see README).
const fs = require('fs');
const path = require('path');
const { DEFAULT_RULES } = require('./fares');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');
const BUILD_FILE = path.join(__dirname, '..', 'data', 'organizer-build.json');

// The organizer's map data, prepared by tools/import-organizer.js. Without it the app runs on the core sample network.
function loadBuild() {
  try { return JSON.parse(fs.readFileSync(BUILD_FILE, 'utf8')); } catch { return null; }
}

// Network = organizer MRT-6 and bus routes (real stops and street paths) + DhakaPath sample lines for areas they do not cover.
function network() {
  const b = loadBuild();
  const clone = x => JSON.parse(JSON.stringify(x));
  if (!b) return { hubs: clone(HUBS).map(h => ({ ...h, major: true, source: 'core' })), lines: clone(LINES).map(l => ({ ...l, source: 'sample' })), connectors: clone(CONNECTORS), walks: [], build: null };
  const ids = new Set(b.hubs.map(h => h.id));
  const built = new Set(b.lines.map(l => l.id));
  const sample = clone(LINES).filter(l => l.id !== 'mrt6' && !built.has(l.id) && l.stops.every(s => ids.has(s))).map(l => ({ ...l, source: 'sample' }));
  return { roadKm: b.roadKm || null, hubs: clone(b.hubs), lines: [...clone(b.lines), ...sample], connectors: clone(b.connectors), walks: clone(b.walks), build: { at: b.generatedAt, note: b.note, stats: b.stats } };
}

const HUBS = [
  { id: 'motijheel', name: 'Motijheel', lat: 23.733, lng: 90.4172, aliases: ['motijheel', 'motijil', 'moti jheel', 'motijhil'] },
  { id: 'banasree', name: 'Banasree', lat: 23.7632, lng: 90.4326, aliases: ['banasree', 'banashree', 'bonoshree'] },
  { id: 'malibagh', name: 'Malibagh', lat: 23.7466, lng: 90.4141, aliases: ['malibagh', 'malibag', 'malibug'] },
  { id: 'shahbagh', name: 'Shahbagh', lat: 23.7389, lng: 90.3958, aliases: ['shahbagh', 'shahbag', 'shahbug', 'shabagh'] },
  { id: 'farmgate', name: 'Farmgate', lat: 23.7561, lng: 90.3872, aliases: ['farmgate', 'farm gate', 'farmget', 'farmgat'] },
  { id: 'science-lab', name: 'Science Lab', lat: 23.739, lng: 90.3836, aliases: ['science lab', 'sciencelab', 'science laboratory', 'science-lab'] },
  { id: 'dhanmondi', name: 'Dhanmondi', lat: 23.7465, lng: 90.376, aliases: ['dhanmondi', 'dhanmondi 27', 'dhanmondi 32', 'dhanmandi', 'dhanmondy'] },
  { id: 'mohammadpur', name: 'Mohammadpur', lat: 23.76, lng: 90.358, aliases: ['mohammadpur', 'mohammodpur', 'mohamadpur', 'muhammadpur'] },
  { id: 'mirpur', name: 'Mirpur', lat: 23.8069, lng: 90.3687, aliases: ['mirpur', 'mirpur 10', 'mirpur-10', 'mirpur10'] },
  { id: 'agargaon', name: 'Agargaon', lat: 23.7778, lng: 90.3796, aliases: ['agargaon', 'agargoan', 'agargaw'] },
  { id: 'mohakhali', name: 'Mohakhali', lat: 23.7781, lng: 90.4005, aliases: ['mohakhali', 'mohakali', 'mohakhaali'] },
  { id: 'badda', name: 'Badda', lat: 23.7806, lng: 90.4262, aliases: ['badda', 'baddha', 'north badda', 'middle badda'] },
  { id: 'uttara', name: 'Uttara', lat: 23.8759, lng: 90.3795, aliases: ['uttara', 'uttora', 'uttara center'] },
  { id: 'jatrabari', name: 'Jatrabari', lat: 23.7104, lng: 90.4349, aliases: ['jatrabari', 'jatrabarii', 'jatrabary'] },
];

// Bangla-script names, so typed Bangla and Bangla voice input are understood too.
const BN_NAMES = {
  motijheel: ['মতিঝিল'], banasree: ['বনশ্রী'], malibagh: ['মালিবাগ'], shahbagh: ['শাহবাগ'], farmgate: ['ফার্মগেট'],
  'science-lab': ['সায়েন্স ল্যাব', 'সাইন্সল্যাব', 'সায়েন্সল্যাব'], dhanmondi: ['ধানমন্ডি', 'ধানমণ্ডি'], mohammadpur: ['মোহাম্মদপুর'],
  mirpur: ['মিরপুর'], agargaon: ['আগারগাঁও', 'আগারগাও'], mohakhali: ['মহাখালী', 'মহাখালি'], badda: ['বাড্ডা'], uttara: ['উত্তরা'], jatrabari: ['যাত্রাবাড়ী', 'যাত্রাবাড়ি'],
};
HUBS.forEach(h => { h.aliases.push(...(BN_NAMES[h.id] || [])); });

const LINES = [
  { id: 'mrt6', mode: 'metro', name: 'MRT Line-6', stops: ['uttara', 'mirpur', 'agargaon', 'farmgate', 'shahbagh', 'motijheel'] },
  { id: 'b-mirpur-moti', mode: 'bus', name: 'Mirpur-Motijheel Express', stops: ['mirpur', 'agargaon', 'farmgate', 'shahbagh', 'motijheel'] },
  { id: 'b-uttara-moti', mode: 'bus', name: 'Uttara-Motijheel via Malibagh', stops: ['uttara', 'mohakhali', 'malibagh', 'motijheel'] },
  { id: 'b-mohpur-jatra', mode: 'bus', name: 'Mohammadpur-Jatrabari', stops: ['mohammadpur', 'dhanmondi', 'science-lab', 'shahbagh', 'motijheel', 'jatrabari'] },
  { id: 'b-banasree-jatra', mode: 'bus', name: 'Banasree-Jatrabari', stops: ['banasree', 'malibagh', 'motijheel', 'jatrabari'] },
  { id: 'b-mohpur-badda', mode: 'bus', name: 'Mohammadpur-Badda', stops: ['mohammadpur', 'agargaon', 'mohakhali', 'badda'] },
  { id: 'b-badda-dhan', mode: 'bus', name: 'Badda-Dhanmondi', stops: ['badda', 'mohakhali', 'farmgate', 'science-lab', 'dhanmondi'] },
  { id: 'l-dhan-mohpur', mode: 'leguna', name: 'Dhanmondi-Mohammadpur Leguna', stops: ['dhanmondi', 'mohammadpur'] },
  { id: 'l-mali-bana', mode: 'leguna', name: 'Malibagh-Banasree Leguna', stops: ['malibagh', 'banasree'] },
  { id: 'l-bana-badda', mode: 'leguna', name: 'Banasree-Badda Leguna', stops: ['banasree', 'badda'] },
  { id: 'l-jatra-moti', mode: 'leguna', name: 'Jatrabari-Motijheel Leguna', stops: ['jatrabari', 'motijheel'] },
].map(l => ({ ...l, status: 'verified', confirms: [] }));

const CONNECTORS = [
  ['rickshaw', 'farmgate', 'science-lab'], ['rickshaw', 'science-lab', 'dhanmondi'], ['rickshaw', 'malibagh', 'motijheel'],
  ['rickshaw', 'malibagh', 'banasree'], ['rickshaw', 'agargaon', 'farmgate'], ['rickshaw', 'shahbagh', 'motijheel'],
  ['rickshaw', 'mohakhali', 'farmgate'], ['rickshaw', 'dhanmondi', 'mohammadpur'],
  ['cng', 'mirpur', 'agargaon'], ['cng', 'uttara', 'mirpur'], ['cng', 'mohakhali', 'badda'], ['cng', 'mohakhali', 'agargaon'],
  ['cng', 'jatrabari', 'motijheel'], ['cng', 'farmgate', 'shahbagh'], ['cng', 'dhanmondi', 'mohammadpur'], ['cng', 'badda', 'banasree'],
].map(([mode, from, to], i) => ({ id: `c${i + 1}`, mode, from, to }));

const LANDMARKS = {
  motijheel: { general: 'Shapla Chattar roundabout, near Bangladesh Bank', bus: 'Bus stand near Shapla Chattar', metro: 'Motijheel MRT station, Dilkusha side', rickshaw: 'Rickshaw stand on Dilkusha Road' },
  banasree: { general: 'Banasree main road, near Aftab Nagar gate', bus: 'Bus stop at Banasree Project gate', metro: '', rickshaw: 'Rickshaw stand by the Banasree Bazar' },
  malibagh: { general: 'Malibagh Mor (railgate crossing)', bus: 'Bus stop at Malibagh Mor', metro: '', rickshaw: 'Rickshaw stand at Malibagh Chowdhurypara' },
  shahbagh: { general: 'Shahbagh intersection, near Dhaka University gate', bus: 'Bus stop at Shahbagh intersection', metro: 'Shahbagh MRT station entrance', rickshaw: 'Rickshaw stand at the Shahbagh crossing' },
  farmgate: { general: 'Farmgate flyover, near Khamar Bari', bus: 'Bus stop under Farmgate flyover', metro: 'Farmgate MRT station, Green Road side', rickshaw: 'Rickshaw stand near Farmgate Kacha Bazar' },
  'science-lab': { general: 'Science Laboratory crossing, near New Market', bus: 'Bus stop at Science Lab crossing', metro: '', rickshaw: 'Rickshaw stand beside Science Lab Road' },
  dhanmondi: { general: 'Dhanmondi 27, near Rabindra Sarobar', bus: 'Bus stop at Dhanmondi 27', metro: '', rickshaw: 'Rickshaw stand at Dhanmondi 27' },
  mohammadpur: { general: 'Mohammadpur Town Hall / Bus stand', bus: 'Mohammadpur Bus stand', metro: '', rickshaw: 'Rickshaw stand at Town Hall' },
  mirpur: { general: 'Mirpur 10 roundabout', bus: 'Bus stop at Mirpur 10 gol chattar', metro: 'Mirpur 10 MRT station', rickshaw: 'Rickshaw stand at Mirpur 10' },
  agargaon: { general: 'Agargaon Taltola, near Passport Office', bus: 'Bus stop at Agargaon Taltola', metro: 'Agargaon MRT station', rickshaw: 'Rickshaw stand at Agargaon Taltola' },
  mohakhali: { general: 'Mohakhali flyover, near the bus terminal', bus: 'Mohakhali bus terminal', metro: '', rickshaw: 'Rickshaw stand at Mohakhali Wireless Gate' },
  badda: { general: 'Badda, Gulshan link road', bus: 'Bus stop at Badda Link Road', metro: '', rickshaw: 'Rickshaw stand at Uttar Badda' },
  uttara: { general: 'Uttara Jashim Uddin Road, near Uttara Center', bus: 'Bus stop at Jashim Uddin', metro: 'Uttara Center MRT station', rickshaw: 'Rickshaw stand at Sector 3' },
  jatrabari: { general: 'Jatrabari crossing, near the flyover', bus: 'Bus stop at Jatrabari crossing', metro: '', rickshaw: 'Rickshaw stand at Jatrabari Gol Chattar' },
};

function seed(now = Date.now()) {
  const min = m => now - m * 60000;
  const alerts = [
    { id: 'a1', type: 'waterlogging', hub: 'malibagh', severity: 2, text: 'Knee-deep water near the railgate, rickshaws stuck.', reporter: 'seed-1', createdAt: min(25), lastVerifiedAt: min(12), confirms: [{ by: 'seed-2', ts: min(18) }, { by: 'seed-3', ts: min(12) }], resolves: [], status: 'open', flags: [] },
    { id: 'a2', type: 'gridlock', hub: 'farmgate', severity: 2, text: 'Heavy jam from the flyover down to Karwan Bazar.', reporter: 'seed-4', createdAt: min(70), lastVerifiedAt: min(55), confirms: [{ by: 'seed-5', ts: min(55) }], resolves: [], status: 'open', flags: [] },
    { id: 'a3', type: 'construction', hub: 'mohakhali', severity: 1, text: 'Road work on one lane under the flyover.', reporter: 'seed-6', createdAt: min(60 * 26), lastVerifiedAt: min(60 * 5), confirms: [{ by: 'seed-7', ts: min(60 * 5) }], resolves: [], status: 'open', flags: [] },
    { id: 'a4', type: 'gridlock', hub: 'jatrabari', severity: 3, text: 'Standstill traffic at the crossing.', reporter: 'seed-8', createdAt: min(60 * 6), lastVerifiedAt: min(60 * 6), confirms: [], resolves: [], status: 'open', flags: [] },
    { id: 'a5', type: 'blockade', hub: 'shahbagh', severity: 3, text: 'Intersection blocked by a procession.', reporter: 'seed-9', createdAt: min(8), lastVerifiedAt: min(8), confirms: [], resolves: [], status: 'open', flags: ['single_source'] },
  ];
  const net = network();
  return {
    version: 1,
    seededAt: now,
    hubs: net.hubs,
    lines: net.lines,
    connectors: net.connectors,
    walks: net.walks,
    roadKm: net.roadKm || null,
    build: net.build,
    landmarks: JSON.parse(JSON.stringify(LANDMARKS)),
    rules: JSON.parse(JSON.stringify(DEFAULT_RULES)),
    alerts,
    fareReports: [],
    rides: [],
    _v: 1,
  };
}

let db = null;

function load() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!db.hubs || !db.lines) throw new Error('bad db');
    // the organizer data was (re)imported: refresh the network, keep alerts, fare reports and rides
    const b = loadBuild();
    if (b && (!db.build || db.build.at !== b.generatedAt)) {
      const net = network();
      Object.assign(db, { hubs: net.hubs, lines: net.lines, connectors: net.connectors, walks: net.walks, roadKm: net.roadKm || null, build: net.build });
      const ids = new Set(db.hubs.map(h => h.id));
      db.alerts = db.alerts.filter(a => ids.has(a.hub));
      save();
    }
  } catch {
    db = seed();
    save();
  }
  db._v = (db._v || 0) + 1;
  return db;
}

function save() {
  db._v = (db._v || 0) + 1;
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('Could not save db:', e.message);
  }
}

function reset() {
  db = seed();
  save();
  return db;
}

const get = () => db || load();

module.exports = { load, save, reset, get, seed, BASE: { HUBS, CONNECTORS, LINES } };
