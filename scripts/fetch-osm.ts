// Run ONCE: npm run fetch:osm. Queries Overpass and saves the raw answer to data/osm-raw.json.
// The app never talks to Overpass; it only reads the processed file built from this one.
import 'dotenv/config'
import { writeFileSync, mkdirSync } from 'node:fs'
import { bbox, HALF, MARGIN } from './geo'

const url = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter'
const b = bbox(HALF + MARGIN)
const bb = `${b.s.toFixed(6)},${b.w.toFixed(6)},${b.n.toFixed(6)},${b.e.toFixed(6)}`
const query = `[out:json][timeout:120][maxsize:268435456];
(
  way["building"](${bb});
  relation["building"](${bb});
  way["building:part"](${bb});
  way["highway"](${bb});
  way["railway"](${bb});
  way["natural"="water"](${bb});
  relation["natural"="water"](${bb});
  way["waterway"](${bb});
  relation["waterway"](${bb});
  way["leisure"~"park|garden|pitch|playground"](${bb});
  way["landuse"~"grass|forest|recreation_ground|cemetery|meadow|village_green"](${bb});
  way["natural"~"wood|scrub|tree_row"](${bb});
  node["natural"="tree"](${bb});
  way["man_made"~"pier|bridge"](${bb});
  node["name"~"[Gg]hat"](${bb});
  way["name"~"[Gg]hat"](${bb});
);
out body geom;`

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'city-twin-stage1/0.1' },
  body: 'data=' + encodeURIComponent(query),
})
if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 400)}`)
const json = (await res.json()) as { elements: unknown[] }
mkdirSync('data', { recursive: true })
writeFileSync('data/osm-raw.json', JSON.stringify(json))
console.log(`saved data/osm-raw.json with ${json.elements.length} elements`)
