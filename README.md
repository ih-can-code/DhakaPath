# DhakaPath: live transit and route intelligence for Dhaka

INIF 2026 hackathon entry (Smart City). A multi-modal transit, fare and live street-alert platform for Dhaka. Free stack, no paid APIs, no Google Maps.

## Run it

Needs Node 18 or newer. No `npm install` (zero dependencies).

```bash
node server.js
```

Open http://localhost:5177. Admin PIN: `dhaka` (change with `ADMIN_PIN` in `.env`).

Tests:

```bash
node test/smoke.js   # route engine, fares, alerts, sanity checks, Banglish and Bangla parsing
node test/api.js     # HTTP API, chat flows, grounding, scan, ride-share
```

### Optional free AI

Works without any key (built-in English + Banglish parser). To turn AI on, copy `.env.example` to `.env` and set ONE of:

| Provider | Key | Notes |
|---|---|---|
| Google AI Studio (Gemini free tier) | `GEMINI_API_KEY` | Also enables signboard photo reading |
| Groq Cloud (free tier) | `GROQ_API_KEY` | Fast text understanding |
| Ollama (local, no key) | `OLLAMA_MODEL`, `OLLAMA_URL` | Fully offline |

## Organizer map data (used in full)

The organizer's map data lives in `data/organizer/` and is turned into the app's network by `node tools/import-organizer.js` (takes about 3 seconds, writes `data/organizer-build.json`).

| File | How DhakaPath uses it |
|---|---|
| `transit-data.json` | All 16 MRT-6 stations and every stop of the Bikolpo (18) and Uttara (20) bus routes become places on the map and in the planner |
| `Routemap-DhakaMetroRail.csv` | The real MRT-6 track shape, drawn on the map and used for metro distances |
| `Routemap-BikolpoBus.csv`, `Routemap-UttaraBus.csv` | The exact street path of every bus segment: drawn on the map, and the real road distance sets the bus fare and time |
| `Roadmap-Dhaka.csv` | 49,869 street pieces (46,669 points, about 5,900 km) become a street graph. Walking links and rickshaw/CNG links get real street distances and street-following shapes from shortest paths |

Every bus and leguna line, including the sample lines, now follows real streets: each stop-to-stop piece is a shortest path on the MapData street graph. Every place also gets street-routed rickshaw links to its nearest neighbours (up to 2.5 km), and a street-distance table between all places powers the fair-fare comparison.

## Fair prices and live road news

- **Fair prices**: for any trip, the route detail and the Check a fare page list the fair price for bus, MRT-6 (when both places are on it), leguna, CNG and rickshaw, using the MapData street distance, plus a ready haggling line ("Bhai, 75 taka dibo") and the price that is too much. Fare checks use the same street distance.
- **Live road news**: the Live tab shows recent Dhaka road headlines from Google News (The Daily Star, BSS and others) and the Dhaka Tribune feed, tagged with the places they mention and pinned on the map, plus live rain and temperature from Open-Meteo. Headlines are cached for 10 minutes and never change routes by themselves; only commuter-confirmed alerts do.

Organizer stops are merged with DhakaPath's 14 core hubs when they are the same place (same name, or within 250 m), giving 52 places in total. The 14 core hubs from the problem statement keep sample bus and leguna lines where the organizer data does not reach (for example Banasree, Malibagh, Jatrabari); the Network page marks every line as "Organizer data" or "Sample".

## Three screens

- **Go**: one box on top of the map. Ask for a route, report a street problem, or ask about fares, in English, Banglish or Bangla. Routes appear as time ribbons, and the What if? card sits on the map.
- **Live**: street alerts with confidence, confirm and resolve, plus a report form and a fare checker.
- **More**: Network, Ride share, Scan a signboard, Trust lab, Admin, and settings.

## What it does (mapped to the problem statement)

| Part | Where |
|---|---|
| 1. CMS: transit network and street alerts, admin and commuter roles | More > Network (lines, hubs, landmarks, fare chart), Live (alerts), More > Admin (add and edit lines, connectors, landmarks, fare rules, moderation) |
| 2. Natural-language multi-constraint search (English + Banglish) | Go, the one box. Budget, avoid-hub, arrive-by, student. Multi-leg routes ranked by cost, time, transfers or safest arrival, with landmark boarding and transfer instructions on every leg |
| 3. Fare breakdown and disruption rerouting | Route detail: per-leg regular vs student fare (50% on buses, ৳10 floor, no discount on metro, leguna, rickshaw or CNG), rickshaw and CNG ranges with traffic and rain surge. What if? card: time of day, heavy rain, blocked junction, with broken segments drawn in red and the detour plus time change |
| 4. Validation and grounding | More > Trust lab. Route grounding against the graph, alert confirm / resolve with time decay, rule-based sanity checks on fares and reports |
| 5. Conversational assistant | Go, the same one box, with memory. Route search, follow-ups, report by conversation, reroute around a hub, fare-rule and reliability questions |
| Bonus 1: signboard digitization | More > Scan a signboard. Photo (Gemini vision) or pasted text becomes a draft line, unknown stops flagged, two confirmations before it joins the network |
| Bonus 2: audio / visual briefing | Listen and Offline card (downloadable PNG) on every route |
| Bonus 3: ride-share and bot | More > Ride share. Post a rickshaw or CNG ride, others join, the fare bot calculates each person's share |

Our additions:
- **One box for everything.** Search and chat are the same box, so there is nothing to learn. Live "Understood" chips show what it read while you type.
- **AI you can see.** "Today in Dhaka" (a short AI summary of the roads), "Why this route" (one AI sentence, checked against the data), and report-by-talking with a confirm card before anything is filed. Gemini free tier, with automatic fallback between models and a deadline on every call.
- **Saved places.** Set Home and School once, then trips are one tap.
- **Time ribbons.** Each route is one bar coloured by transport and sized by time. The faded end shows how late it could run, so routes can be compared at a glance.
- **What if? slider.** Drag the arrival time from 6 AM to 11 PM and the routes recalculate live. Traffic follows a time-of-day curve (assumed shape: rush around 8 to 9 AM and 5 to 7 PM). Add rain or block a junction on top.
- **Arrive-by ranges and leave-by times.** "Leave by 7:34 AM to arrive by 8:00 AM", based on the cautious end of the range.
- **Proof chips.** Every route shows why it can be trusted: line exists, fare rule applied, alert confidence.
- **Guided demo.** One button walks through every feature live in about two minutes.
- **Bangla script and voice.** Type or speak in English, Banglish or Bangla script (মিরপুর থেকে মতিঝিল যাবো). Voice uses the browser's free speech recognition (Chrome or Edge).
- **Real street map.** Leaflet + OpenStreetMap, grayscale so routes stand out, light and dark. Switches to the built-in schematic map automatically if tiles cannot load.
- **Everyday touches.** Near me, share a trip link, tap a hub on the map to start, end or block it, light / dark / auto theme, works on phones.

## Internet at the venue

Fonts, icons and the map code are bundled in `public/vendor`, so the app looks right with no internet. Only two things need internet: OpenStreetMap tiles (the app switches to its built-in "Lines" map if they fail) and the Gemini AI (the app falls back to its own rules instantly if Gemini is slow or offline).

## Design

Apple-style, map first: a full-screen street map with one floating glass card (a draggable bottom sheet on phones). System font (SF Pro on Apple devices, Inter elsewhere), iOS colours with blue as the only accent, grouped lists, iOS switches and segmented controls, 44px tap targets, light and dark themes.

## Architecture

```
Browser (vanilla JS)  ->  server.js (Node http, JSON API)
                              |
        +---------------------+-----------------------------+
        |                     |                             |
   nlp.js / llm.js       engine.js + fares.js          alerts.js
   understand text       route graph, scenarios        confidence, decay,
   (rules, optional AI)  ranking, detours              sanity checks
        |                     |                             |
        +----------- grounding.js (checks everything) ------+
                              |
                         data.js (db.json)
```

**Principle: the AI parses, the graph computes.** A language model, if enabled, only turns a sentence into structured data (from, to, avoid, budget, intent). Every route, time and fare comes from the deterministic graph in `src/engine.js` and `src/fares.js`, so the AI cannot invent a bus, a station or a price.

### Routing logic (`src/engine.js`)

1. Every line gets a link between every pair of its stops (a bus can be boarded and left anywhere). Rickshaw/CNG connectors and short walking links (up to about 1.6 km) are added.
2. Depth-first search over hubs, up to 4 legs, no revisited hubs, with a distance cap to prune silly detours.
3. Each leg gets a time range and fare under the active scenario:
   - Rain: road modes about 1.4x slower in the chosen zones. Rush hour: road modes about 1.35x slower, metro 1.1x.
   - Live alerts add delay per hub: type delay x severity x current confidence.
   - A blocked hub breaks road legs through it. The elevated metro keeps running.
   - Avoiding a hub applies to road vehicles and to changing there, not to the metro passing overhead.
4. Dominated options are dropped, near-duplicates limited, and the rest ranked (best overall, cheapest, fastest, fewest transfers, safest arrival).
5. Detours: the normal-day best route is compared with the scenario best, and each leg is marked broken or slowed.

### Alert confidence and decay (`src/alerts.js`)

- A new report starts at 0.55. Each independent confirmation closes 40% of the remaining doubt.
- Confidence halves every half-life without a fresh confirmation: gridlock 40 min, blockade 60 min, waterlogging 150 min, construction 72 h.
- At 35% or more an alert can change routes. Below 15% it expires.
- Resolve votes: enough votes (more than the confirmations) mark it resolved. You cannot confirm your own report or vote twice.
- Flagged reports (rate limit, contradiction, severity conflict, metro text at a hub with no station, "clear" text with high severity) are saved at half confidence and stay out of routing until someone confirms them.

### AI components

| Where | What the AI does | Safety |
|---|---|---|
| Plan "Ask" and Chat | Reads English or Banglish into JSON intent | Hub ids are checked against the real hub list; invalid ones are dropped and shown |
| Narration | Rewrites verified facts in the user's language style | Every number and place is checked against the route data; if anything is off, verified text is shown instead |
| Scan | Reads a signboard photo (Gemini vision) | Stops must match known hubs; unknown stops are flagged; lines need two confirmations |

## Honest limits

- Fares, line names, times and landmark notes are **sample values** for the prototype. Verify against BRTA / MRT-6 charts before real use. Times use assumed speeds, not live traffic.
- Time ranges are estimates, not statistical guarantees.
- The admin PIN is a demo gate, not production security.
- Grounding of free text catches fabricated fares, minutes and places outside the network by rules. It is not a general fact checker.
- Browser speech for Bangla varies by device. The briefing is spoken in English.

## Demo script (4 to 5 minutes)

Shortcut: press **Guided demo** and click Next through the 10 steps. Each step runs the real feature. Or by hand:

1. Go: type "Mirpur 10 theke Motijheel jabo, 80 takar moddhe, Farmgate avoid kore, student". Point out what it understood, the time ribbons and the leave-by times.
2. What if?: drag the arrival time from 8 AM to 10 PM and back, then turn on Rain. The ribbons change live.
3. Block Shahbagh, then ask "Dhanmondi theke Motijheel". The broken part is red on the map and the routes go around it.
4. Open the top route: landmarks, transfer wait, regular vs student fares, proof chips.
5. In the same box: "Farmgate e jol jomeche", then "Student fare koto?".
6. Live: confirm an alert, watch confidence rise; show old reports fading.
7. More > Trust lab: hallucination test, the time machine, a silly fare.
8. Bonus: Scan the sample text, Listen to a route, download the offline card, post a ride and let the bot split the fare.
