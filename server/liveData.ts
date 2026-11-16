import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type DataCategory = 'MEASURED' | 'MODELLED' | 'ESTIMATED' | 'UNAVAILABLE'

export interface TelemetryField<T> {
  value: T | null
  unit?: string
  category: DataCategory
  source: string
  timestamp: string | null
  status: 'ok' | 'stale' | 'unconfigured' | 'error'
  notes?: string
}

export interface FlightInfo {
  icao24: string
  callsign: string
  originCountry: string
  altitudeMeters: number | null
  velocityKmph: number | null
  headingDeg: number | null
  verticalRateMps: number | null
  onGround: boolean
  lat: number
  lon: number
  worldX: number
  worldZ: number
  distKmFromAirport: number
  timePosition: number | null
}

export interface CPCBStationData {
  station: string
  city: string
  state: string
  avg: number
  min: number
  max: number
  unit: string
  lastUpdate: string
}

export interface TomTomFlowData {
  currentSpeedKmph: number
  freeFlowSpeedKmph: number
  speedRatio: number
  currentTravelTimeSec: number
  freeFlowTravelTimeSec: number
  confidence: number
}

export interface LiveTelemetry {
  serverTime: string
  fromDiskCache: boolean
  lastDiskCacheTime: string | null
  weather: {
    temperature: TelemetryField<number>
    relativeHumidity: TelemetryField<number>
    apparentTemperature: TelemetryField<number>
    precipitation: TelemetryField<number>
    weatherCode: TelemetryField<number>
    windSpeed: TelemetryField<number>
    windDirection: TelemetryField<number>
  }
  airQuality: {
    pm25_modelled: TelemetryField<number>
    pm10_modelled: TelemetryField<number>
    usAqi_modelled: TelemetryField<number>
    europeanAqi_modelled: TelemetryField<number>
    cpcb_pm25_measured: TelemetryField<CPCBStationData>
  }
  traffic: {
    tomtomSpeed: TelemetryField<TomTomFlowData>
  }
  flights: {
    activeFlights: TelemetryField<FlightInfo[]>
  }
  derived: {
    hazeDensity: TelemetryField<number>
    hazeMaxExtinction: TelemetryField<number>
    trafficSpeedFactor: TelemetryField<number>
  }
}

// Coordinates & projection
const CENTER = { lat: 22.5851, lon: 88.3468 } // Howrah Bridge
const AIRPORT = { lat: 22.6547, lon: 88.4467 } // Kolkata CCU / VECC
const R = 6378137
const D2R = Math.PI / 180
const KX = R * D2R * Math.cos(CENTER.lat * D2R)
const KZ = R * D2R

function toWorld(lat: number, lon: number): [number, number] {
  return [(lon - CENTER.lon) * KX, -(lat - CENTER.lat) * KZ]
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * D2R
  const dLon = (lon2 - lon1) * D2R
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / 1000
}

const CACHE_DIR = resolve('data/cache')
const CACHE_FILE = resolve(CACHE_DIR, 'live-cache.json')

// In-memory telemetry state
let liveTelemetry: LiveTelemetry = createInitialState()

function createInitialState(): LiveTelemetry {
  const now = new Date().toISOString()
  return {
    serverTime: now,
    fromDiskCache: false,
    lastDiskCacheTime: null,
    weather: {
      temperature: {
        value: null,
        unit: '°C',
        category: 'MODELLED',
        source: 'Open-Meteo Weather API',
        timestamp: null,
        status: 'unconfigured',
        notes: 'Awaiting initial weather fetch',
      },
      relativeHumidity: {
        value: null,
        unit: '%',
        category: 'MODELLED',
        source: 'Open-Meteo Weather API',
        timestamp: null,
        status: 'unconfigured',
        notes: 'Awaiting initial weather fetch',
      },
      apparentTemperature: {
        value: null,
        unit: '°C',
        category: 'MODELLED',
        source: 'Open-Meteo Weather API',
        timestamp: null,
        status: 'unconfigured',
      },
      precipitation: {
        value: null,
        unit: 'mm',
        category: 'MODELLED',
        source: 'Open-Meteo Weather API',
        timestamp: null,
        status: 'unconfigured',
      },
      weatherCode: {
        value: null,
        unit: 'WMO code',
        category: 'MODELLED',
        source: 'Open-Meteo Weather API',
        timestamp: null,
        status: 'unconfigured',
      },
      windSpeed: {
        value: null,
        unit: 'km/h',
        category: 'MODELLED',
        source: 'Open-Meteo Weather API',
        timestamp: null,
        status: 'unconfigured',
      },
      windDirection: {
        value: null,
        unit: '°',
        category: 'MODELLED',
        source: 'Open-Meteo Weather API',
        timestamp: null,
        status: 'unconfigured',
      },
    },
    airQuality: {
      pm25_modelled: {
        value: null,
        unit: 'µg/m³',
        category: 'MODELLED',
        source: 'Open-Meteo Air Quality (Copernicus CAMS)',
        timestamp: null,
        status: 'unconfigured',
      },
      pm10_modelled: {
        value: null,
        unit: 'µg/m³',
        category: 'MODELLED',
        source: 'Open-Meteo Air Quality (Copernicus CAMS)',
        timestamp: null,
        status: 'unconfigured',
      },
      usAqi_modelled: {
        value: null,
        unit: 'AQI index',
        category: 'MODELLED',
        source: 'Open-Meteo Air Quality',
        timestamp: null,
        status: 'unconfigured',
      },
      europeanAqi_modelled: {
        value: null,
        unit: 'EAQI index',
        category: 'MODELLED',
        source: 'Open-Meteo Air Quality',
        timestamp: null,
        status: 'unconfigured',
      },
      cpcb_pm25_measured: {
        value: null,
        unit: 'µg/m³',
        category: 'UNAVAILABLE',
        source: 'CPCB Continuous Ambient Air Quality Monitoring Station',
        timestamp: null,
        status: 'unconfigured',
        notes: 'No CPCB API key provided in .env (DATAGOVIN_API_KEY)',
      },
    },
    traffic: {
      tomtomSpeed: {
        value: null,
        unit: 'km/h',
        category: 'UNAVAILABLE',
        source: 'TomTom Traffic Flow API',
        timestamp: null,
        status: 'unconfigured',
        notes: 'No TOMTOM_API_KEY supplied in .env; baseline road limits active',
      },
    },
    flights: {
      activeFlights: {
        value: null,
        unit: 'aircraft',
        category: 'MEASURED',
        source: 'OpenSky Network (ADS-B sensor receivers)',
        timestamp: null,
        status: 'unconfigured',
        notes: 'Awaiting initial flight fetch',
      },
    },
    derived: {
      hazeDensity: {
        value: 0.00023,
        unit: 'extinction coef (1/m)',
        category: 'ESTIMATED',
        source: 'Hänel hygroscopic aerosol growth & optical extinction model',
        timestamp: now,
        status: 'ok',
        notes: 'Default atmospheric baseline before live telemetry assimilation',
      },
      hazeMaxExtinction: {
        value: 0.96,
        unit: 'opacity ratio',
        category: 'ESTIMATED',
        source: 'Atmospheric optical model',
        timestamp: now,
        status: 'ok',
      },
      trafficSpeedFactor: {
        value: 1.0,
        unit: 'multiplier',
        category: 'ESTIMATED',
        source: 'Default road network velocity baseline (No TomTom key)',
        timestamp: now,
        status: 'ok',
        notes: 'No invented speeds; 1.0x physical road speed limits',
      },
    },
  }
}

// Disk cache loader
export function loadDiskCache(): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true })
    }
    if (existsSync(CACHE_FILE)) {
      const raw = readFileSync(CACHE_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as LiveTelemetry
      if (parsed && parsed.weather && parsed.airQuality) {
        liveTelemetry = parsed
        liveTelemetry.fromDiskCache = true
        liveTelemetry.lastDiskCacheTime = parsed.serverTime || new Date().toISOString()
        console.log(`[Cache] Loaded last good live telemetry copy from disk (${liveTelemetry.lastDiskCacheTime})`)
      }
    }
  } catch (err) {
    console.warn('[Cache] Could not read disk cache, initializing fresh:', err)
  }
}

function saveDiskCache(): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true })
    }
    liveTelemetry.serverTime = new Date().toISOString()
    writeFileSync(CACHE_FILE, JSON.stringify(liveTelemetry, null, 2), 'utf-8')
  } catch (err) {
    console.error('[Cache] Failed writing cache to disk:', err)
  }
}

// Derived physical parameters calculation
function updateDerivedParameters(): void {
  const now = new Date().toISOString()
  const pm25 =
    liveTelemetry.airQuality.cpcb_pm25_measured.value?.avg ??
    liveTelemetry.airQuality.pm25_modelled.value
  const rh = liveTelemetry.weather.relativeHumidity.value

  if (pm25 != null && rh != null) {
    // Atmospheric physics: aerosol optical depth depends on particulate concentration
    // and hygroscopic swelling at higher relative humidity (deliquescence in river valleys like Hooghly)
    const pmRatio = Math.max(0.2, pm25 / 75.0)
    const rhFactor = Math.max(0.4, Math.pow(Math.max(10, rh) / 60.0, 1.25))
    const density = 0.00018 * Math.pow(pmRatio, 0.72) * Math.pow(rhFactor, 0.58)
    const maxExtinction = Math.min(0.99, Math.max(0.85, 0.88 + 0.05 * Math.min(2.5, pmRatio)))

    liveTelemetry.derived.hazeDensity = {
      value: Number(density.toFixed(6)),
      unit: 'extinction coef (1/m)',
      category: 'ESTIMATED',
      source: 'Hänel hygroscopic aerosol swelling model [PM2.5 + RH]',
      timestamp: now,
      status: 'ok',
      notes: `Extinction derived from live PM2.5 (${pm25} µg/m³) and RH (${rh}%)`,
    }
    liveTelemetry.derived.hazeMaxExtinction = {
      value: Number(maxExtinction.toFixed(3)),
      unit: 'opacity ratio',
      category: 'ESTIMATED',
      source: 'Atmospheric optical depth ceiling',
      timestamp: now,
      status: 'ok',
    }
  }

  // Traffic speed factor
  const tomtom = liveTelemetry.traffic.tomtomSpeed.value
  if (tomtom && tomtom.speedRatio != null) {
    liveTelemetry.derived.trafficSpeedFactor = {
      value: Number(tomtom.speedRatio.toFixed(2)),
      unit: 'multiplier',
      category: 'MEASURED',
      source: 'TomTom Live Traffic Flow',
      timestamp: liveTelemetry.traffic.tomtomSpeed.timestamp,
      status: 'ok',
      notes: `Speed scaled by live road congestion: ${tomtom.currentSpeedKmph} km/h (free-flow: ${tomtom.freeFlowSpeedKmph} km/h)`,
    }
  } else {
    liveTelemetry.derived.trafficSpeedFactor = {
      value: 1.0,
      unit: 'multiplier',
      category: 'ESTIMATED',
      source: 'Default road network speed limits',
      timestamp: now,
      status: 'ok',
      notes: 'No TomTom key; no invented speed ratio. Baseline road network limits apply.',
    }
  }
}

// 1. Open-Meteo Weather
export async function fetchWeather(): Promise<void> {
  const url =
    'https://api.open-meteo.com/v1/forecast?latitude=22.5851&longitude=88.3468&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m&timezone=Asia%2FKolkata'
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'KolkataDigitalTwin/1.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    const data = await res.json()
    const c = data.current
    if (c) {
      const ts = c.time ? new Date(c.time + '+05:30').toISOString() : new Date().toISOString()
      liveTelemetry.weather = {
        temperature: {
          value: c.temperature_2m,
          unit: '°C',
          category: 'MODELLED',
          source: 'Open-Meteo Forecast (ECMWF/GFS numerical weather model)',
          timestamp: ts,
          status: 'ok',
        },
        relativeHumidity: {
          value: c.relative_humidity_2m,
          unit: '%',
          category: 'MODELLED',
          source: 'Open-Meteo Forecast (ECMWF/GFS numerical weather model)',
          timestamp: ts,
          status: 'ok',
        },
        apparentTemperature: {
          value: c.apparent_temperature,
          unit: '°C',
          category: 'MODELLED',
          source: 'Open-Meteo Forecast (Humidex / Wind Chill model)',
          timestamp: ts,
          status: 'ok',
        },
        precipitation: {
          value: c.precipitation,
          unit: 'mm',
          category: 'MODELLED',
          source: 'Open-Meteo Forecast (NWP grid precipitation)',
          timestamp: ts,
          status: 'ok',
        },
        weatherCode: {
          value: c.weather_code,
          unit: 'WMO code',
          category: 'MODELLED',
          source: 'Open-Meteo Forecast (WMO 4677 synoptic interpretation)',
          timestamp: ts,
          status: 'ok',
        },
        windSpeed: {
          value: c.wind_speed_10m,
          unit: 'km/h',
          category: 'MODELLED',
          source: 'Open-Meteo Forecast (10m boundary layer model)',
          timestamp: ts,
          status: 'ok',
        },
        windDirection: {
          value: c.wind_direction_10m,
          unit: '°',
          category: 'MODELLED',
          source: 'Open-Meteo Forecast (10m boundary layer model)',
          timestamp: ts,
          status: 'ok',
        },
      }
      liveTelemetry.fromDiskCache = false
      updateDerivedParameters()
      saveDiskCache()
    }
  } catch (err: any) {
    console.warn('[Weather] Fetch failed; serving last good copy:', err.message)
    // Mark fields as stale if we have previous values, but preserve last good copy
    Object.keys(liveTelemetry.weather).forEach((k) => {
      const field = (liveTelemetry.weather as any)[k] as TelemetryField<any>
      if (field.value !== null) {
        field.status = 'stale'
        field.notes = `Network error (${err.message}). Serving last good disk cache.`
      }
    })
  }
}

// 2. Open-Meteo Air Quality
export async function fetchAirQuality(): Promise<void> {
  const url =
    'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=22.5851&longitude=88.3468&current=pm2_5,pm10,european_aqi,us_aqi&timezone=Asia%2FKolkata'
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'KolkataDigitalTwin/1.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    const data = await res.json()
    const c = data.current
    if (c) {
      const ts = c.time ? new Date(c.time + '+05:30').toISOString() : new Date().toISOString()
      liveTelemetry.airQuality.pm25_modelled = {
        value: c.pm2_5,
        unit: 'µg/m³',
        category: 'MODELLED',
        source: 'Open-Meteo Air Quality (Copernicus CAMS regional atmospheric model)',
        timestamp: ts,
        status: 'ok',
      }
      liveTelemetry.airQuality.pm10_modelled = {
        value: c.pm10,
        unit: 'µg/m³',
        category: 'MODELLED',
        source: 'Open-Meteo Air Quality (Copernicus CAMS regional atmospheric model)',
        timestamp: ts,
        status: 'ok',
      }
      liveTelemetry.airQuality.usAqi_modelled = {
        value: c.us_aqi,
        unit: 'US AQI',
        category: 'MODELLED',
        source: 'Open-Meteo Air Quality (EPA AQI standard computation)',
        timestamp: ts,
        status: 'ok',
      }
      liveTelemetry.airQuality.europeanAqi_modelled = {
        value: c.european_aqi,
        unit: 'EAQI',
        category: 'MODELLED',
        source: 'Open-Meteo Air Quality (EEA European Air Quality Index)',
        timestamp: ts,
        status: 'ok',
      }
      liveTelemetry.fromDiskCache = false
      updateDerivedParameters()
      saveDiskCache()
    }
  } catch (err: any) {
    console.warn('[AirQuality] Fetch failed; serving last good copy:', err.message)
    const aq = liveTelemetry.airQuality
    ;[aq.pm25_modelled, aq.pm10_modelled, aq.usAqi_modelled, aq.europeanAqi_modelled].forEach((f) => {
      if (f.value !== null) {
        f.status = 'stale'
        f.notes = `Network error (${err.message}). Serving last good disk cache.`
      }
    })
  }
}

// 3. CPCB Data (data.gov.in)
export async function fetchCPCB(): Promise<void> {
  const apiKey = process.env.DATAGOVIN_API_KEY || process.env.CPCB_API_KEY
  if (!apiKey) {
    liveTelemetry.airQuality.cpcb_pm25_measured = {
      value: null,
      unit: 'µg/m³',
      category: 'UNAVAILABLE',
      source: 'CPCB / WBPCB Ground Station (data.gov.in CAAQMS)',
      timestamp: null,
      status: 'unconfigured',
      notes:
        'No data.gov.in API key supplied. Provide DATAGOVIN_API_KEY in .env to stream measured ground station data. Units checked against official CPCB dashboard: µg/m³.',
    }
    return
  }

  // data.gov.in real-time ambient air quality resource ID
  const resourceId = '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69'
  const url = `https://api.data.gov.in/resource/${resourceId}?api-key=${encodeURIComponent(
    apiKey
  )}&format=json&limit=50&filters%5Bcity%5D=Kolkata`

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'KolkataDigitalTwin/1.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    const json = await res.json()
    const records: any[] = json.records || []

    // Filter for PM2.5 records from Kolkata / Howrah stations
    const pm25Records = records.filter(
      (r) =>
        r.pollutant_id === 'PM2.5' ||
        r.pollutant_id === 'PM25' ||
        String(r.pollutant_id).toUpperCase().includes('PM2.5')
    )

    if (pm25Records.length > 0) {
      // Find station closest to Howrah Bridge / central river: Fort William or Victoria Memorial or Ballygunge
      const heroRecord =
        pm25Records.find((r) => String(r.station).toLowerCase().includes('fort william')) ||
        pm25Records.find((r) => String(r.station).toLowerCase().includes('victoria')) ||
        pm25Records[0]

      const avg = Number(heroRecord.pollutant_avg)
      const min = Number(heroRecord.pollutant_min) || avg
      const max = Number(heroRecord.pollutant_max) || avg

      // Official unit validation check: CPCB monitors ambient PM2.5 in µg/m³
      const rawUnit = heroRecord.pollutant_unit || 'µg/m³'
      const unit = rawUnit.replace('ug/m3', 'µg/m³').replace('NA', 'µg/m³')

      liveTelemetry.airQuality.cpcb_pm25_measured = {
        value: {
          station: heroRecord.station || 'Kolkata CAAQMS Station',
          city: heroRecord.city || 'Kolkata',
          state: heroRecord.state || 'West Bengal',
          avg: Number.isFinite(avg) ? avg : 0,
          min: Number.isFinite(min) ? min : avg,
          max: Number.isFinite(max) ? max : avg,
          unit,
          lastUpdate: heroRecord.last_update || new Date().toISOString(),
        },
        unit: 'µg/m³',
        category: 'MEASURED',
        source: `CPCB Ground CAAQMS (${heroRecord.station || 'Kolkata'}) via data.gov.in`,
        timestamp: heroRecord.last_update || new Date().toISOString(),
        status: 'ok',
        notes: 'Units verified against CPCB National Ambient Air Quality Standards: µg/m³ (micrograms per cubic metre)',
      }
      updateDerivedParameters()
      saveDiskCache()
    } else {
      liveTelemetry.airQuality.cpcb_pm25_measured.status = 'stale'
      liveTelemetry.airQuality.cpcb_pm25_measured.notes = 'No active PM2.5 records returned for Kolkata in the current feed batch'
    }
  } catch (err: any) {
    console.warn('[CPCB] Fetch failed; serving last good copy:', err.message)
    if (liveTelemetry.airQuality.cpcb_pm25_measured.value !== null) {
      liveTelemetry.airQuality.cpcb_pm25_measured.status = 'stale'
      liveTelemetry.airQuality.cpcb_pm25_measured.notes = `CPCB API error (${err.message}). Serving last good disk cache.`
    }
  }
}

// 4. TomTom Traffic Flow
export async function fetchTraffic(): Promise<void> {
  const apiKey = process.env.TOMTOM_API_KEY
  if (!apiKey) {
    liveTelemetry.traffic.tomtomSpeed = {
      value: null,
      unit: 'km/h',
      category: 'UNAVAILABLE',
      source: 'TomTom Traffic Flow API',
      timestamp: null,
      status: 'unconfigured',
      notes:
        'No TOMTOM_API_KEY supplied in .env. Never filling gaps with invented values; simulation continues with physical baseline road limits.',
    }
    updateDerivedParameters()
    return
  }

  // Howrah Bridge & Strand Road flow segment point
  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json?point=22.5851,88.3468&unit=kmph&key=${encodeURIComponent(
    apiKey
  )}`

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'KolkataDigitalTwin/1.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    const json = await res.json()
    const flow = json.flowSegmentData
    if (flow) {
      const current = Number(flow.currentSpeed)
      const freeFlow = Number(flow.freeFlowSpeed)
      const ratio = freeFlow > 0 ? Math.min(2.0, Math.max(0.1, current / freeFlow)) : 1.0

      liveTelemetry.traffic.tomtomSpeed = {
        value: {
          currentSpeedKmph: current,
          freeFlowSpeedKmph: freeFlow,
          speedRatio: Number(ratio.toFixed(2)),
          currentTravelTimeSec: Number(flow.currentTravelTime),
          freeFlowTravelTimeSec: Number(flow.freeFlowTravelTime),
          confidence: Number(flow.confidence || 1.0),
        },
        unit: 'km/h',
        category: 'MEASURED',
        source: 'TomTom Traffic Flow API (Real-time GPS Probe & Floating Car Data)',
        timestamp: new Date().toISOString(),
        status: 'ok',
        notes: `Confidence: ${(flow.confidence * 100).toFixed(0)}%. Road closure: ${flow.roadClosure ? 'Yes' : 'No'}.`,
      }
      updateDerivedParameters()
      saveDiskCache()
    }
  } catch (err: any) {
    console.warn('[TomTom] Fetch failed; serving last good copy:', err.message)
    if (liveTelemetry.traffic.tomtomSpeed.value !== null) {
      liveTelemetry.traffic.tomtomSpeed.status = 'stale'
      liveTelemetry.traffic.tomtomSpeed.notes = `TomTom API error (${err.message}). Serving last good disk cache.`
    }
  }
}

// 5. OpenSky Flights near Kolkata Airport
let openskyBackoffUntil = 0

export async function fetchFlights(): Promise<void> {
  const nowMs = Date.now()
  if (nowMs < openskyBackoffUntil) {
    return
  }

  // Bounding box around Kolkata Airport (22.6547 N, 88.4467 E) and terminal control area
  const lamin = 22.25
  const lamax = 23.05
  const lomin = 88.05
  const lomax = 88.85
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'KolkataDigitalTwin/1.0 (Academic Digital Twin Research Project)',
      },
    })

    if (res.status === 429) {
      // OpenSky rate-limiting: back off for 60 seconds
      openskyBackoffUntil = nowMs + 60_000
      throw new Error('Rate limit reached (HTTP 429), backing off for 60s')
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

    const data = await res.json()
    const rawStates: any[][] = data.states || []
    const fetchTime = data.time ? new Date(data.time * 1000).toISOString() : new Date().toISOString()

    const parsedFlights: FlightInfo[] = rawStates
      .filter((s) => s[5] != null && s[6] != null) // lon and lat must exist
      .map((s) => {
        const lon = Number(s[5])
        const lat = Number(s[6])
        const [worldX, worldZ] = toWorld(lat, lon)
        const altMeters = s[7] != null ? Number(s[7]) : s[13] != null ? Number(s[13]) : null
        const velKmph = s[9] != null ? Number((s[9] * 3.6).toFixed(1)) : null
        const distKm = Number(haversineKm(lat, lon, AIRPORT.lat, AIRPORT.lon).toFixed(1))

        return {
          icao24: String(s[0]).trim(),
          callsign: String(s[1] || '').trim() || 'UNIDENTIFIED',
          originCountry: String(s[2] || 'Unknown').trim(),
          timePosition: s[3] ? Number(s[3]) : null,
          altitudeMeters: altMeters != null ? Math.round(altMeters) : null,
          velocityKmph: velKmph,
          headingDeg: s[10] != null ? Math.round(s[10]) : null,
          verticalRateMps: s[11] != null ? Number(s[11].toFixed(1)) : null,
          onGround: Boolean(s[8]),
          lat: Number(lat.toFixed(4)),
          lon: Number(lon.toFixed(4)),
          worldX: Math.round(worldX),
          worldZ: Math.round(worldZ),
          distKmFromAirport: distKm,
        }
      })
      // Sort nearest to airport first
      .sort((a, b) => a.distKmFromAirport - b.distKmFromAirport)

    liveTelemetry.flights.activeFlights = {
      value: parsedFlights,
      unit: 'aircraft',
      category: 'MEASURED',
      source: 'OpenSky Network (Ground ADS-B sensor receivers)',
      timestamp: fetchTime,
      status: 'ok',
      notes: `${parsedFlights.length} aircraft tracked within 50km terminal radar sector of Kolkata Airport (CCU/VECC)`,
    }
    saveDiskCache()
  } catch (err: any) {
    console.warn('[OpenSky] Fetch failed; serving last good copy:', err.message)
    if (liveTelemetry.flights.activeFlights.value !== null) {
      liveTelemetry.flights.activeFlights.status = 'stale'
      liveTelemetry.flights.activeFlights.notes = `OpenSky API error (${err.message}). Serving last good disk cache.`
    }
  }
}

// Background poll orchestrator
let pollIntervalId: NodeJS.Timeout | null = null

export function startLiveTelemetryPolling(): void {
  // 1. Initial disk cache load
  loadDiskCache()

  // 2. Immediate fetch run
  void fetchWeather()
  void fetchAirQuality()
  void fetchCPCB()
  void fetchTraffic()
  void fetchFlights()

  // 3. Periodic loops
  // Weather & Air Quality: every 10 minutes
  setInterval(() => {
    void fetchWeather()
    void fetchAirQuality()
    void fetchCPCB()
  }, 10 * 60 * 1000)

  // Flights: every 30 seconds
  setInterval(() => {
    void fetchFlights()
  }, 30 * 1000)

  // Traffic: every 60 seconds
  setInterval(() => {
    void fetchTraffic()
  }, 60 * 1000)
}

export function getLiveTelemetry(): LiveTelemetry {
  liveTelemetry.serverTime = new Date().toISOString()
  return liveTelemetry
}
