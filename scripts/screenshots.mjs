// npm run shots — captures the four saved views from a running app (default http://localhost:5173).
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright') // resolves a global install too
import { mkdirSync } from 'node:fs'

const base = process.env.APP_URL || 'http://localhost:5173'
const out = process.env.SHOT_DIR || 'shots'
const ids = process.argv[2]
  ? process.argv[2].split(';')
  : ['aerial', 'river', 'deck', 'ghat']
const W = Number(process.env.W || 1920)
const H = Number(process.env.H || 1080)
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300))
})
page.on('requestfailed', (req) => {
  console.log('[requestfailed]', req.url(), req.failure()?.errorText)
})
page.on('response', (res) => {
  if (res.status() >= 400) console.log(`[HTTP ${res.status()}]`, res.url())
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)))
for (const id of ids) {
  const t0 = Date.now()
  const q = id.includes(',') ? `cam=${id}` : `shot=${id}`
  const name = id.includes(',') ? `cam_${id.replace(/,/g, '_')}` : id
  await page.goto(`${base}/?${q}&dpr=${process.env.DPR || 1.25}&freeze=${process.env.FRAMES || 10}`)
  try {
    await page.waitForFunction(() => window.__frozen === true, null, { timeout: 3500, polling: 200 })
  } catch {}
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 120000 })
  const stats = await page.evaluate(() => window.__stats)
  console.log(id, `${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(stats))
}
await browser.close()
