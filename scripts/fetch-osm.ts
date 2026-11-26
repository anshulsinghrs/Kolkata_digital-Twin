// Run ONCE: npm run fetch:osm. Queries Overpass and saves the raw answer to data/osm-raw.json.
// The app never talks to Overpass; it only reads the processed file built from this one.
// Uses existing data/osm-raw.json as core baseline (if present) + fetches Complete Kolkata (16km x 16km)
// with automatic Overpass mirror fallback and retry.
import 'dotenv/config'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { bbox, HALF, MARGIN } from './geo'

const MIRRORS = [
  process.env.OVERPASS_URL,
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
].filter(Boolean) as string[]

async function queryOverpass(query: string, label: string) {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length]
    console.log(`[fetch-osm] Querying ${label} via ${new URL(url).hostname} (attempt ${attempt + 1})...`)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'city-twin-stage1/0.1' },
        body: 'data=' + encodeURIComponent(query),
      })
      if (res.ok) {
        const json = (await res.json()) as { elements: { type: string; id: number }[]; osm3s?: unknown }
        console.log(`[fetch-osm] ${label}: ${json.elements.length} elements`)
        return json
      }
      lastErr = new Error(`Overpass (${label}) ${res.status}: ${(await res.text()).slice(0, 200)}`)
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)))
  }
  throw lastErr
}

let coreElements: { type: string; id: number }[] = []
let osm3s: unknown = undefined

if (existsSync('data/osm-raw.json')) {
  const existing = JSON.parse(readFileSync('data/osm-raw.json', 'utf8')) as {
    elements: { type: string; id: number }[]
    osm3s?: unknown
  }
  coreElements = existing.elements || []
  osm3s = existing.osm3s
  console.log(`[fetch-osm] Loaded ${coreElements.length} existing core elements from data/osm-raw.json`)
} else {
  const bCore = bbox(2500)
  const bbCore = `${bCore.s.toFixed(6)},${bCore.w.toFixed(6)},${bCore.n.toFixed(6)},${bCore.e.toFixed(6)}`
  const coreQuery = `[out:json][timeout:180][maxsize:268435456];
(
  way["building"](${bbCore});
  relation["building"](${bbCore});
  way["building:part"](${bbCore});
  way["highway"](${bbCore});
  way["railway"](${bbCore});
  way["natural"="water"](${bbCore});
  relation["natural"="water"](${bbCore});
  way["waterway"](${bbCore});
  relation["waterway"](${bbCore});
  way["leisure"~"park|garden|pitch|playground"](${bbCore});
  way["landuse"~"grass|forest|recreation_ground|cemetery|meadow|village_green"](${bbCore});
  way["natural"~"wood|scrub|tree_row"](${bbCore});
  node["natural"="tree"](${bbCore});
  way["man_made"~"pier|bridge"](${bbCore});
  node["name"~"[Gg]hat"](${bbCore});
  way["name"~"[Gg]hat"](${bbCore});
);
out body geom;`
  const coreJson = await queryOverpass(coreQuery, 'Core 5km x 5km')
  coreElements = coreJson.elements
  osm3s = coreJson.osm3s
}

const bCity = bbox(HALF + MARGIN)
const bbCity = `${bCity.s.toFixed(6)},${bCity.w.toFixed(6)},${bCity.n.toFixed(6)},${bCity.e.toFixed(6)}`
const cityQuery = `[out:json][timeout:180][maxsize:536870912];
(
  way["building"]["name"](${bbCity});
  relation["building"](${bbCity});
  way["building"]["building:levels"](${bbCity});
  way["building"~"apartments|commercial|office|public|civic|hospital|university|college|hotel|stadium|cathedral|train_station|terminal|retail|industrial|warehouse"](${bbCity});
  way["aeroway"~"runway|taxiway|apron|terminal|hangar"](${bbCity});
  relation["aeroway"~"apron|terminal"](${bbCity});
  way["highway"~"motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link"](${bbCity});
  way["railway"="rail"](${bbCity});
  way["natural"="water"](${bbCity});
  relation["natural"="water"](${bbCity});
  way["waterway"~"river|canal"](${bbCity});
  relation["waterway"~"river|canal"](${bbCity});
  way["leisure"~"park|garden|golf_course"](${bbCity});
  way["landuse"~"grass|forest|recreation_ground|meadow|village_green"](${bbCity});
  way["man_made"~"pier|bridge"](${bbCity});
  node["name"~"[Gg]hat"](${bbCity});
);
out body geom;`

const cityJson = await queryOverpass(cityQuery, 'Complete Kolkata + CCU Airport 26km x 26km')

const seen = new Set<string>()
const merged: { type: string; id: number }[] = []
for (const el of [...coreElements, ...cityJson.elements]) {
  const key = `${el.type}:${el.id}`
  if (seen.has(key)) continue
  seen.add(key)
  merged.push(el)
}

mkdirSync('data', { recursive: true })
writeFileSync('data/osm-raw.json', JSON.stringify({ osm3s: cityJson.osm3s || osm3s, elements: merged }))
console.log(`saved data/osm-raw.json with ${merged.length} deduplicated elements (covering +/- ${HALF + MARGIN}m)`)
