// The only process that touches the outside world or secrets.
// Stage 1 needs no keys; the scene file is fetched once by scripts/ and served from disk here.
import 'dotenv/config'
import express from 'express'
import compression from 'compression'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const app = express()
app.use(compression())

const SCENE = resolve('data/scene.json')

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, scene: existsSync(SCENE) })
})

app.get('/api/scene', (_req, res) => {
  if (!existsSync(SCENE)) {
    res.status(503).json({ error: 'data/scene.json missing. Run: npm run fetch:osm && npm run build:scene' })
    return
  }
  res.setHeader('Cache-Control', 'no-cache')
  res.sendFile(SCENE)
})

if (process.env.NODE_ENV === 'production') {
  const dist = resolve('dist')
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')))
}

const port = Number(process.env.PORT) || 8787
app.listen(port, () => console.log(`server on http://localhost:${port}`))
