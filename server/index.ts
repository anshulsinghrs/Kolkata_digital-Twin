// The only process that touches the outside world or secrets.
// Stage 3: Live telemetry streaming with disk cache fallback, Open-Meteo, OpenSky, CPCB, and TomTom.
import 'dotenv/config'
import express from 'express'
import compression from 'compression'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  startLiveTelemetryPolling,
  getLiveTelemetry,
  fetchWeather,
  fetchAirQuality,
  fetchCPCB,
  fetchTraffic,
  fetchFlights,
  fetchStationTrains,
} from './liveData'

const app = express()
app.use(compression())

const SCENE = resolve('data/scene.json')

// Start live data fetching and disk cache daemon
startLiveTelemetryPolling()

app.get('/api/health', (_req, res) => {
  const telemetry = getLiveTelemetry()
  res.json({
    ok: true,
    scene: existsSync(SCENE),
    fromDiskCache: telemetry.fromDiskCache,
    serverTime: telemetry.serverTime,
  })
})

app.get('/api/scene', (_req, res) => {
  if (!existsSync(SCENE)) {
    res.status(503).json({ error: 'data/scene.json missing. Run: npm run fetch:osm && npm run build:scene' })
    return
  }
  res.setHeader('Cache-Control', 'no-cache')
  res.sendFile(SCENE)
})

// Stage 3 Live Telemetry Endpoints
app.get('/api/live', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  res.json(getLiveTelemetry())
})

app.get('/api/live/weather', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  const t = getLiveTelemetry()
  res.json({ serverTime: t.serverTime, weather: t.weather })
})

app.get('/api/live/air-quality', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  const t = getLiveTelemetry()
  res.json({ serverTime: t.serverTime, airQuality: t.airQuality })
})

app.get('/api/live/traffic', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  const t = getLiveTelemetry()
  res.json({ serverTime: t.serverTime, traffic: t.traffic, derived: t.derived })
})

app.get('/api/live/flights', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  const t = getLiveTelemetry()
  res.json({ serverTime: t.serverTime, flights: t.flights })
})

app.get('/api/live/trains', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  const t = getLiveTelemetry()
  res.json({ serverTime: t.serverTime, station: t.station })
})

app.post('/api/live/refresh', async (_req, res) => {
  try {
    await Promise.allSettled([
      fetchWeather(),
      fetchAirQuality(),
      fetchCPCB(),
      fetchTraffic(),
      fetchFlights(),
      fetchStationTrains(),
    ])
    res.json({ ok: true, data: getLiveTelemetry() })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

if (process.env.NODE_ENV === 'production') {
  const dist = resolve('dist')
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')))
}

const port = Number(process.env.PORT) || 8787
app.listen(port, () => console.log(`server on http://localhost:${port}`))
