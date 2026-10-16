// Maps. Street map: Leaflet + OpenStreetMap tiles (free, no key). Schematic: own SVG, works offline.
// Route lines connect hub coordinates; they show the network, not exact street geometry.

// ---------------- schematic SVG ----------------
const MAP = { W: 420, H: 620, pad: 52 };
const LEFT_LABEL = new Set(['science-lab', 'dhanmondi', 'mohammadpur', 'agargaon', 'mirpur', 'farmgate']);

function projector(hs, W = MAP.W, H = MAP.H) {
  const lngs = hs.map(h => h.lng), minX = Math.min(...lngs), maxX = Math.max(...lngs);
  const ky = lat => (lat <= 23.81 ? (lat - 23.70) * 111 : (23.81 - 23.70) * 111 + (lat - 23.81) * 111 * 0.32);
  const ys = hs.map(h => ky(h.lat)), minY = Math.min(...ys), maxY = Math.max(...ys);
  const padL = 92, padR = 78;
  const wKm = (maxX - minX) * 111 * 0.9;
  const scale = Math.min((W - padL - padR) / wKm, (H - MAP.pad * 2) / (maxY - minY));
  const ox = padL + (W - padL - padR - wKm * scale) / 2;
  const oy = (H - (maxY - minY) * scale) / 2;
  return h => ({ x: ox + (h.lng - minX) * 111 * 0.9 * scale, y: H - oy - (ky(h.lat) - minY) * scale });
}

function mapSVG(opt = {}) {
  const d = S.data;
  if (!d) return '';
  const P = projector(d.hubs);
  const pos = {};
  d.hubs.forEach(h => { pos[h.id] = P(h); });
  const pts = ids => ids.filter(i => pos[i]).map(i => `${pos[i].x.toFixed(1)},${pos[i].y.toFixed(1)}`).join(' ');
  let s = `<svg viewBox="0 0 ${MAP.W} ${MAP.H}" role="img" aria-label="Schematic map of the DhakaPath network" preserveAspectRatio="xMidYMid meet">`;
  if (S.scn.rain && !opt.quiet) {
    if (!S.scn.rainZones.length) s += `<rect x="0" y="0" width="${MAP.W}" height="${MAP.H}" rx="16" fill="var(--rain)" opacity=".08"/>`;
    else S.scn.rainZones.forEach(z => { if (pos[z]) s += `<circle cx="${pos[z].x}" cy="${pos[z].y}" r="44" fill="var(--rain)" fill-opacity=".12" stroke="var(--rain)" stroke-opacity=".5" stroke-dasharray="4 5"/>`; });
  }
  d.lines.filter(l => l.status !== 'unverified').forEach(l => {
    const metro = l.mode === 'metro';
    s += `<polyline points="${pts(l.stops)}" fill="none" stroke="${metro ? 'var(--metro)' : 'var(--line-2)'}" stroke-width="${metro ? 4 : 2.2}" opacity="${metro ? 0.45 : 1}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  d.connectors.forEach(c => { if (pos[c.from] && pos[c.to]) s += `<line x1="${pos[c.from].x}" y1="${pos[c.from].y}" x2="${pos[c.to].x}" y2="${pos[c.to].y}" stroke="var(--line-2)" stroke-width="1.4" stroke-dasharray="2 5"/>`; });
  if (opt.option) {
    opt.option.legs.forEach(l => { s += `<polyline points="${pts(l.stops)}" fill="none" stroke="var(--surface)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`; });
    opt.option.legs.forEach(l => { s += `<polyline points="${pts(l.stops)}" fill="none" stroke="${MODES[l.mode].color}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" ${l.mode === 'walk' ? 'stroke-dasharray="1 8"' : ''}/>`; });
  }
  (opt.segments || []).filter(x => x.status === 'broken').forEach(x => { s += `<polyline points="${pts(x.leg.stops)}" fill="none" stroke="var(--danger)" stroke-width="4" stroke-dasharray="8 6" stroke-linecap="round"/>`; });
  const on = new Set(opt.option ? opt.option.hubs : []);
  d.hubs.forEach(h => {
    const p = pos[h.id];
    const st = d.status[h.id] || { status: 'Clear', alerts: [] };
    const blocked = (!opt.quiet && S.scn.blocked.includes(h.id)) || st.status === 'Blocked';
    const ring = blocked || st.status === 'Disrupted' ? 'var(--danger)' : st.status === 'Slow' ? 'var(--warn)' : 'var(--ink)';
    const left = LEFT_LABEL.has(h.id);
    const minor = h.major === false && !on.has(h.id);
    if (minor) { s += `<circle cx="${p.x}" cy="${p.y}" r="2.4" fill="var(--ink-3)"/>`; return; }
    const r = on.has(h.id) ? 7 : 5.5;
    s += `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${on.has(h.id) ? 'var(--ink)' : 'var(--surface)'}" stroke="${ring}" stroke-width="2.4"/>`;
    if (blocked) s += `<path d="M${p.x - 5} ${p.y - 5}L${p.x + 5} ${p.y + 5}M${p.x + 5} ${p.y - 5}L${p.x - 5} ${p.y + 5}" stroke="var(--danger)" stroke-width="2.6" stroke-linecap="round"/>`;
    s += `<text x="${p.x + (left ? -12 : 12)}" y="${p.y + 4}" text-anchor="${left ? 'end' : 'start'}" style="font:${on.has(h.id) ? 600 : 500} 12px var(--font);fill:${on.has(h.id) || !opt.option ? 'var(--ink)' : 'var(--ink-2)'}">${esc(h.name)}</text>`;
    const n = st.alerts.length;
    if (n) s += `<circle cx="${p.x + (left ? 10 : -10)}" cy="${p.y - 10}" r="7" fill="${st.status === 'Slow' ? 'var(--warn)' : 'var(--danger)'}" stroke="var(--surface)" stroke-width="2"/><text x="${p.x + (left ? 10 : -10)}" y="${p.y - 6.4}" text-anchor="middle" style="fill:#fff;font:700 10px var(--mono)">${n}</text>`;
  });
  return s + '</svg>';
}

// ---------------- Leaflet street map ----------------
let LM = null, LG = null, tileFail = 0, tileOk = 0, lastFitKey = '';

function destroyMap() {
  if (LM) {
    // stop any zoom or pan animation first, or Leaflet errors when its container disappears mid-animation
    try {
      LM.stop();
      if (LM._animatingZoom && LM._onZoomTransitionEnd) LM._onZoomTransitionEnd(); // finish it so its timer finds nothing to do
      LM.off(); LM.remove();
    } catch { /* map already gone */ }
    LM = null; LG = null;
  }
  lastFitKey = '';
}

function mountMap() {
  const el = $('#map');
  if (!el) return;
  destroyMap();
  el.innerHTML = '';
  if (S.mapMode === 'street' && window.L) {
    tileFail = 0; tileOk = 0;
    LM = L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: false }).setView([23.775, 90.395], 12);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, className: 'osm', attribution: '&copy; OpenStreetMap contributors' }).addTo(LM);
    tiles.on('tileload', () => { tileOk++; });
    tiles.on('tileerror', () => {
      tileFail++;
      if (tileFail >= 4 && tileOk === 0 && S.mapMode === 'street') { S.mapMode = 'schematic'; toast('Map tiles are offline, so the schematic map is shown.'); mountMap(); drawMap(); }
    });
    LG = L.layerGroup().addTo(LM);
    const zc = () => { const z = LM.getZoom(); el.classList.toggle('z-far', z < 12); el.classList.toggle('z-near', z >= 14); };
    LM.on('zoomend', zc); zc();
  } else {
    if (!window.L && S.mapMode === 'street') S.mapMode = 'schematic';
  }
  drawMap();
}

// Keep the route visible beside the floating card (desktop) or above the sheet (phone).
function fitPadding() {
  const card = $('#card');
  if (window.innerWidth >= 820) {
    const w = card ? card.getBoundingClientRect().right : 420;
    const wi = $('#wiFloat');
    const wiH = wi && wi.offsetHeight ? wi.offsetHeight + 20 : 0;
    return { paddingTopLeft: [w + 40, 70], paddingBottomRight: [wiH ? 400 : 60, 60] };
  }
  const h = card ? card.getBoundingClientRect().height : 300;
  return { paddingTopLeft: [40, 80], paddingBottomRight: [40, h + 30] };
}

function currentMapOpt() {
  if (S.tab !== 'go') return { option: null, segments: null };
  const o = S.result && S.result.options ? S.result.options[S.sel] : null;
  return { option: o || null, segments: S.sim && S.sim.segments };
}

function drawMap() {
  const el = $('#map');
  if (!el || !S.data) return;
  const opt = currentMapOpt();
  if (!LM) { el.innerHTML = mapSVG(opt); return; }
  LG.clearLayers();
  const d = S.data;
  const H = Object.fromEntries(d.hubs.map(h => [h.id, h]));
  const ll = id => [H[id].lat, H[id].lng];

  if (S.scn.rain) {
    if (S.scn.rainZones.length) S.scn.rainZones.forEach(z => L.circle(ll(z), { radius: 1400, className: 'lf-rain', interactive: false }).addTo(LG));
    else L.rectangle(L.latLngBounds(d.hubs.map(h => [h.lat, h.lng])).pad(0.25), { className: 'lf-rain', interactive: false }).addTo(LG);
  }
  // network lines: organizer street paths when we have them, otherwise straight hub-to-hub
  d.lines.filter(l => l.status !== 'unverified').forEach(l => {
    const pts = Array.isArray(l.segs) && l.segs.length ? l.segs.reduce((all, s) => all.concat(all.length ? s.geom.slice(1) : s.geom), []) : l.stops.filter(s => H[s]).map(ll);
    L.polyline(pts, { className: `lf-line ${l.mode}` + (l.source === 'sample' ? ' sample' : ''), interactive: false }).addTo(LG);
  });

  const drawn = [];
  if (opt.option) {
    const legPts = l => (Array.isArray(l.geom) && l.geom.length > 1 ? l.geom : l.stops.map(ll));
    opt.option.legs.forEach(l => L.polyline(legPts(l), { className: 'lf-casing', interactive: false }).addTo(LG));
    opt.option.legs.forEach(l => { drawn.push([l.mode, L.polyline(legPts(l), { className: 'lf-leg ' + l.mode, interactive: false }).addTo(LG)]); });
  }
  (opt.segments || []).filter(x => x.status === 'broken').forEach(x => L.polyline(Array.isArray(x.leg.geom) && x.leg.geom.length > 1 ? x.leg.geom : x.leg.stops.map(ll), { className: 'lf-broken', interactive: false }).addTo(LG));

  const on = new Set(opt.option ? opt.option.hubs : []);
  const metroLine = d.lines.find(l => l.id === 'mrt6');
  const metroSet = new Set(metroLine ? metroLine.stops : []);
  d.hubs.forEach(h => {
    const st = d.status[h.id] || { status: 'Clear', alerts: [] };
    const blocked = S.scn.blocked.includes(h.id) || st.status === 'Blocked';
    const cls = 'lf-hub' + (on.has(h.id) ? ' on' : '') + (blocked || st.status === 'Disrupted' ? ' bad' : st.status === 'Slow' ? ' slow' : '');
    // major hubs and stops on the chosen route are labelled; other bus stops show their name on hover
    const major = h.major !== false || on.has(h.id);
    const ends = opt.option && (h.id === opt.option.legs[0].from || h.id === opt.option.legs[opt.option.legs.length - 1].to);
    const isMetro = metroSet.has(h.id);
    const m = L.circleMarker([h.lat, h.lng], { radius: ends ? 9 : on.has(h.id) ? 6 : major ? 5 : 3.2, className: cls + (major ? '' : ' minor') + (isMetro ? ' metro' : '') + (ends ? ' ends' : '') }).addTo(LG);
    m.bindTooltip(esc(h.name), { permanent: major, direction: 'right', offset: [8, 0], className: 'hublbl' + (on.has(h.id) ? ' on' : opt.option ? ' dim' : '') + (h.major === false ? ' minor-l' : '') });
    m.bindPopup(`<div style="font:500 14px var(--font);min-width:200px"><b style="font-size:16px">${esc(h.name)}</b><div style="color:var(--ink-3);margin:2px 0 8px">${esc(st.status)}${st.alerts.length ? `, ${st.alerts.length} alert${st.alerts.length > 1 ? 's' : ''}` : ''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" data-act="hubFrom" data-id="${h.id}">Start here</button><button class="btn sm fill" data-act="hubTo" data-id="${h.id}">Go here</button><button class="btn sm danger" data-act="hubBlock" data-id="${h.id}">${S.scn.blocked[0] === h.id ? 'Unblock' : 'What if blocked?'}</button></div></div>`);
    if (st.alerts.length) L.marker([h.lat, h.lng], { interactive: false, icon: L.divIcon({ className: '', html: `<span class="lf-badge${st.status === 'Slow' ? ' slow' : ''}">${st.alerts.length}</span>`, iconSize: [20, 20], iconAnchor: [24, 24] }) }).addTo(LG);
    if (blocked) L.marker([h.lat, h.lng], { interactive: false, icon: L.divIcon({ className: '', html: `<span class="lf-block">${ic('barrier-block')}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(LG);
  });

  // start, transfer and end markers on the chosen route
  if (opt.option) {
    const legs = opt.option.legs;
    const pin = (latlng, html, size, anchor, z) => L.marker(latlng, { interactive: false, zIndexOffset: z || 600, icon: L.divIcon({ className: '', html, iconSize: size, iconAnchor: anchor }) }).addTo(LG);
    pin(ll(legs[0].from), `<span class="lf-pin start">${ic(MODES[legs[0].mode].icon)}</span>`, [30, 30], [15, 15], 700);
    legs.slice(1).forEach(l => pin(ll(l.from), `<span class="lf-pin xfer" style="--c:${MODES[l.mode].color}">${ic(MODES[l.mode].icon)}</span>`, [26, 26], [13, 13]));
    pin(ll(legs[legs.length - 1].to), `<span class="lf-pin end">${ic('flag-filled')}</span>`, [34, 42], [17, 40], 800);
  }
  if (S.tab === 'live' && S.live && S.live.items) {
    const counts = {};
    S.live.items.forEach(i => i.hubs.forEach(h => { counts[h] = (counts[h] || 0) + 1; }));
    Object.entries(counts).forEach(([h, n]) => { if (H[h]) L.marker(ll(h), { interactive: false, icon: L.divIcon({ className: '', html: `<span class="lf-news" title="In the news">${ic('news')}${n > 1 ? n : ''}</span>`, iconSize: [30, 22], iconAnchor: [-6, 30] }) }).addTo(LG); });
  }

  // fit to the selected route (only when it changes, so manual zoom is kept)
  const fitKey = opt.option ? opt.option.hubs.join('>') : 'all';
  if (fitKey !== lastFitKey) {
    lastFitKey = fitKey;
    const pts = opt.option ? opt.option.legs.flatMap(l => (Array.isArray(l.geom) && l.geom.length ? l.geom : l.stops.map(ll))) : d.hubs.filter(h => h.major !== false).map(h => [h.lat, h.lng]);
    LM.fitBounds(L.latLngBounds(pts), { ...fitPadding(), maxZoom: 14, animate: !reduceMotion() });
  }
  // draw-in animation for the route
  if (!reduceMotion()) {
    requestAnimationFrame(() => drawn.forEach(([mode, pl]) => {
      const p = pl.getElement();
      if (!p || mode === 'walk' || !p.getTotalLength) return;
      const len = p.getTotalLength();
      p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
      p.getBoundingClientRect();
      p.classList.add('draw');
      p.style.strokeDashoffset = 0;
      p.addEventListener('transitionend', () => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; p.classList.remove('draw'); }, { once: true });
    }));
  }
}

function mapOverlays() {
  const zoom = LM ? `<div class="glass" style="border-radius:12px;display:flex;flex-direction:column;overflow:hidden"><button class="round" style="border-radius:0;background:transparent" data-act="zoomIn" aria-label="Zoom in">${ic('plus')}</button><span style="height:0.5px;background:var(--sep)"></span><button class="round" style="border-radius:0;background:transparent" data-act="zoomOut" aria-label="Zoom out">${ic('minus')}</button></div>` : '';
  return `<div class="segc glass" role="group" aria-label="Map style" style="border-radius:12px;padding:3px"><button data-act="mapMode" data-m="street" aria-pressed="${S.mapMode === 'street'}">${ic('map')}Map</button><button data-act="mapMode" data-m="schematic" aria-pressed="${S.mapMode === 'schematic'}">${ic('route-2')}Lines</button></div>${zoom}`;
}
