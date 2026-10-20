// Turns a GeoJSON of Bihar's districts into the small file the channel map
// draws: outlines already projected to the map's own units, with points
// closer than a fraction of a pixel dropped, and a point well inside each
// district for its label.
//
//   node scripts/bihar-map.mjs <bihargeo.ts or .json> src/data/biharMap.ts
//
// The source used is the 2011 census district boundaries (38 districts).
import { readFileSync, writeFileSync } from 'node:fs'

const [source, target] = process.argv.slice(2)
const text = readFileSync(source, 'utf8')
const geo = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))

// The map is 1000 units wide. Longitude is narrowed by the cosine of the
// middle latitude, so Bihar keeps its true shape at this size.
const WIDTH = 1000
const PAD = 14
const MIN_STEP = 0.7

const rings = (feature) =>
  (feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates).flat()

let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity
for (const feature of geo.features)
  for (const ring of rings(feature))
    for (const [lon, lat] of ring) {
      west = Math.min(west, lon); east = Math.max(east, lon)
      south = Math.min(south, lat); north = Math.max(north, lat)
    }
const narrow = Math.cos((((south + north) / 2) * Math.PI) / 180)
const scale = (WIDTH - 2 * PAD) / ((east - west) * narrow)
const height = Math.round((north - south) * scale + 2 * PAD)
const project = ([lon, lat]) => [PAD + (lon - west) * narrow * scale, PAD + (north - lat) * scale]
const round = (n) => Math.round(n * 10) / 10

function thin(points) {
  const kept = [points[0]]
  for (const point of points.slice(1, -1)) {
    const [x, y] = kept[kept.length - 1]
    if (Math.hypot(point[0] - x, point[1] - y) >= MIN_STEP) kept.push(point)
  }
  return kept
}

function inside([x, y], ring) {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

function edgeDistance([x, y], ring) {
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i]
    const dx = bx - ax, dy = by - ay
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)))
  }
  return best
}

// The point inside the biggest piece farthest from its edges: where a label
// sits best, even in a curved district whose centre falls outside it.
function labelPoint(ring) {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  let best = [(x0 + x1) / 2, (y0 + y1) / 2], far = -1
  for (let i = 1; i < 40; i++)
    for (let j = 1; j < 40; j++) {
      const point = [x0 + ((x1 - x0) * i) / 40, y0 + ((y1 - y0) * j) / 40]
      if (!inside(point, ring)) continue
      const d = edgeDistance(point, ring)
      if (d > far) { far = d; best = point }
    }
  return best
}

const area = (ring) => Math.abs(ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length]
  return sum + x * ny - nx * y
}, 0)) / 2

let points = 0
const districts = geo.features.map((feature) => {
  const projected = rings(feature)
    .map((ring) => thin(ring.map(project)))
    .filter((ring) => ring.length >= 3)
  points += projected.reduce((n, ring) => n + ring.length, 0)
  const biggest = projected.reduce((a, b) => (area(b) > area(a) ? b : a))
  const all = projected.flat()
  return {
    name: feature.properties.district,
    rings: projected.map((ring) => ring.flatMap(([x, y]) => [round(x), round(y)])),
    label: labelPoint(biggest).map(round),
    box: [
      Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])),
      Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1])),
    ].map(round),
  }
})

writeFileSync(
  target,
  `// Bihar's 38 districts (2011 census boundaries), drawn by the channel map.
// Made by scripts/bihar-map.mjs: change that and run it again rather than
// editing this file.

export type MapDistrict = {
  name: string
  // Each piece's outline as x, y, x, y, ... in the map's units.
  rings: number[][]
  // Where its name sits, and the box around it: left, top, right, bottom.
  label: number[]
  box: number[]
}

export const BIHAR: { width: number; height: number; districts: MapDistrict[] } = ${JSON.stringify({ width: WIDTH, height, districts })}
`,
)
console.log(`${districts.length} districts, ${points} points, map ${WIDTH} x ${height}`)
