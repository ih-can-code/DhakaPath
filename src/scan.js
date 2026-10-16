// Signboard / fare-chart digitization: turns extracted text or AI vision output into a draft transit line.
const nlp = require('./nlp');

const SPLIT = /\s*(?:→|->|=>|–|—|>|-|\bto\b|,|\||\/)\s*/i;

function toDraft(name, rawStops, fare, notes, hubs) {
  const stops = [];
  const unknown = [];
  for (const s of rawStops) {
    const t = String(s || '').trim();
    if (!t) continue;
    const id = nlp.resolveHub(t, hubs);
    if (!id) unknown.push(t);
    else if (stops[stops.length - 1] !== id) stops.push(id);
  }
  return { name: String(name || 'Scanned route').slice(0, 60), stops, unknown, fare: Number.isFinite(Number(fare)) && Number(fare) > 0 ? Number(fare) : null, notes: String(notes || '').slice(0, 120), mode: 'bus', ok: stops.length >= 2 };
}

// Plain text, one route per line: "Winner: Mirpur 10 - Agargaon - Farmgate - Motijheel  Fare 40"
function fromText(text, hubs) {
  const out = [];
  for (const line of String(text || '').split(/\n+/)) {
    let l = line.trim();
    if (!l) continue;
    let fare = null;
    const f = l.match(/(?:fare|ভাড়া)[:\s৳]*(\d{1,3})|(\d{1,3})\s*(?:taka|tk|bdt|৳)/i);
    if (f) { fare = f[1] || f[2]; l = l.replace(f[0], ' '); }
    let name = null;
    const nm = l.match(/^([^:]{2,40}):\s*(.+)$/);
    if (nm) { name = nm[1]; l = nm[2]; }
    out.push(toDraft(name || 'Scanned route', l.split(SPLIT), fare, 'from pasted text', hubs));
  }
  return out;
}

function fromVision(json, hubs) {
  const routes = json && Array.isArray(json.routes) ? json.routes : [];
  return routes.slice(0, 8).map(r => toDraft(r.name, Array.isArray(r.stops) ? r.stops : [], r.fare, r.notes || 'read from photo', hubs));
}

module.exports = { fromText, fromVision };
