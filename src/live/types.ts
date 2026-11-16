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
