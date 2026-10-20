// Live road news and weather from public sources. News is shown as reported headlines with links,
// never turned into alerts automatically: commuters still confirm alerts themselves.
const nlp = require('./nlp');

const gnews = q => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-BD&gl=BD&ceid=BD:en`;
const FEEDS = [
  { name: 'Google News', url: gnews('Dhaka traffic when:2d') },
  { name: 'Google News', url: gnews('Dhaka waterlogging OR flooded road when:3d') },
  { name: 'Google News', url: gnews('Dhaka road blocked OR blockade OR protest road when:2d') },
  { name: 'Dhaka Tribune', url: 'https://www.dhakatribune.com/feed/', filter: true },
];
const ROAD_WORDS = /\b(traffic|jam|gridlock|road|roads|waterlog\w*|water-log\w*|flood\w*|blockade|blocked|metro|bus|buses|rickshaw\w*|commut\w*|DMP|BRTA|flyover|street|highway|congestion|transport)\b/i;
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=23.78&longitude=90.40&current=precipitation,rain,weather_code,temperature_2m&hourly=precipitation_probability,precipitation&forecast_hours=8&timezone=Asia%2FDhaka';
const TTL = 10 * 60000;
let cache = { at: 0, value: null, job: null };

async function get(url, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (DhakaPath hackathon prototype)' }, redirect: 'follow', signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

const decode = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]) : ''; };

function parseRSS(xml, feed) {
  return xml.split(/<item[\s>]/i).slice(1).map(raw => {
    let title = tag(raw, 'title');
    let source = tag(raw, 'source') || feed.name;
    const cut = title.lastIndexOf(' - ');
    if (feed.name === 'Google News' && cut > 20) { source = title.slice(cut + 3); title = title.slice(0, cut); }
    const link = tag(raw, 'link');
    const ts = Date.parse(tag(raw, 'pubDate')) || 0;
    return { title, source, link: /^https?:\/\//.test(link) ? link : '', ts };
  }).filter(i => i.title && i.link && (!feed.filter || ROAD_WORDS.test(i.title)));
}

const WMO = c => (c === 0 ? 'Clear' : c <= 3 ? 'Partly cloudy' : c <= 48 ? 'Foggy' : c <= 57 ? 'Drizzle' : c <= 67 ? 'Rain' : c <= 82 ? 'Rain showers' : c >= 95 ? 'Thunderstorm' : 'Cloudy');
function parseWeather(json) {
  const j = JSON.parse(json);
  const cur = j.current || {};
  const hours = (j.hourly && j.hourly.time || []).map((t, i) => ({ t, p: j.hourly.precipitation_probability[i], mm: j.hourly.precipitation[i] }));
  const nextRain = hours.find(h => h.p >= 50 || h.mm >= 0.5);
  const raining = (cur.rain || cur.precipitation || 0) > 0.1 || (cur.weather_code >= 51 && cur.weather_code < 100 && cur.weather_code !== 0);
  const hh = t => { const d = new Date(t); const h = d.getHours(); return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`; };
  const summary = raining ? `It is raining in Dhaka now (${cur.temperature_2m}°C).` : nextRain ? `Rain is likely around ${hh(nextRain.t)} (${nextRain.p}% chance).` : `No rain expected in the next few hours (${cur.temperature_2m}°C, ${WMO(cur.weather_code).toLowerCase()}).`;
  return { raining, temp: cur.temperature_2m, condition: WMO(cur.weather_code), nextRain: nextRain ? { at: nextRain.t, chance: nextRain.p } : null, summary, source: 'Open-Meteo' };
}

async function refreshNow(hubs) {
  const errors = [];
  const results = await Promise.allSettled(FEEDS.map(async f => parseRSS(await get(f.url), f)));
  let items = [];
  results.forEach((r, i) => { if (r.status === 'fulfilled') items = items.concat(r.value); else errors.push(`${FEEDS[i].name}: ${r.reason && r.reason.message}`); });
  const seen = new Set();
  const cutoff = Date.now() - 4 * 86400000;
  items = items.filter(i => i.ts >= cutoff).sort((a, b) => b.ts - a.ts).filter(i => { const k = i.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 14)
    .map(i => ({ ...i, hubs: [...new Set(nlp.matchHubs(nlp.norm(i.title), hubs).map(m => m.hub))] }));
  let weather = null;
  try { weather = parseWeather(await get(WEATHER_URL)); } catch (e) { errors.push(`Open-Meteo: ${e.message}`); }
  return { items, weather, fetchedAt: Date.now(), errors };
}

// Serve from cache; refresh in the background when stale so the app never waits on the internet.
async function live(hubs, { wait = false } = {}) {
  const fresh = cache.value && Date.now() - cache.at < TTL;
  if (!fresh && !cache.job) {
    cache.job = refreshNow(hubs).then(v => { cache = { at: Date.now(), value: v, job: null }; return v; }).catch(() => { cache.job = null; });
  }
  if (cache.value && (fresh || !wait)) return { ...cache.value, stale: !fresh };
  if (cache.job) return (await cache.job) || { items: [], weather: null, errors: ['offline'] };
  return { items: [], weather: null, errors: ['offline'] };
}
const cachedWeather = () => (cache.value && cache.value.weather) || null;

module.exports = { live, cachedWeather, parseRSS, parseWeather };
