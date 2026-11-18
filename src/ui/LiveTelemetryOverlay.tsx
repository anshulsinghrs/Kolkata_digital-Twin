import React, { useState } from 'react'
import type { LiveTelemetry, TelemetryField, DataCategory } from '../live/types'

function CategoryBadge({ category }: { category: DataCategory }) {
  switch (category) {
    case 'MEASURED':
      return <span className="cat-badge cat-measured">[MEASURED]</span>
    case 'MODELLED':
      return <span className="cat-badge cat-modelled">[MODELLED]</span>
    case 'ESTIMATED':
      return <span className="cat-badge cat-estimated">[ESTIMATED]</span>
    case 'UNAVAILABLE':
    default:
      return <span className="cat-badge cat-unavailable">[UNAVAILABLE]</span>
  }
}

function TelemetryRow<T>({
  label,
  field,
  displayValue,
}: {
  label: string
  field: TelemetryField<T>
  displayValue?: string
}) {
  const isAvailable = field.category !== 'UNAVAILABLE' && field.value !== null
  const formattedTime = field.timestamp
    ? new Date(field.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—'

  return (
    <div className="telem-row">
      <div className="telem-row-header">
        <span className="telem-label">{label}</span>
        <div className="telem-meta-right">
          <CategoryBadge category={field.category} />
          <span className="telem-val">
            {isAvailable
              ? displayValue ?? `${field.value} ${field.unit || ''}`
              : 'Unavailable'}
          </span>
        </div>
      </div>
      <div className="telem-row-sub">
        <span className="telem-source" title={field.source}>
          {field.source}
        </span>
        <span className="telem-time" title="Timestamp of observation or model run">
          🕒 {formattedTime}
        </span>
      </div>
      {field.notes && <div className="telem-notes">ℹ {field.notes}</div>}
    </div>
  )
}

export function LiveTelemetryOverlay({
  telemetry,
  loading,
  error,
  onRefresh,
  enableFog = false,
  onToggleFog,
}: {
  telemetry: LiveTelemetry | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  enableFog?: boolean
  onToggleFog?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'weather' | 'air' | 'traffic' | 'flights' | 'trains'>('all')

  if (!telemetry) {
    return (
      <div className="telem-ticker telem-loading">
        <span className="telem-pulse pulse-amber" />
        <span>Connecting to live Kolkata telemetry feed…</span>
      </div>
    )
  }

  const { weather, airQuality, traffic, flights, station, derived, fromDiskCache, lastDiskCacheTime } = telemetry
  const flightCount = flights.activeFlights.value?.length || 0
  const trainList = station?.howrahTrains?.value?.activeServices || []
  const trainCount = trainList.length
  const premierTrain = trainList.find((t) => t.status === 'Boarding') || trainList[0]

  const pm25Val = airQuality.cpcb_pm25_measured.value?.avg ?? airQuality.pm25_modelled.value
  const tempVal = weather.temperature.value
  const rhVal = weather.relativeHumidity.value

  return (
    <aside className="telem-container" aria-label="Live Telemetry Dashboard">
      {/* Top Banner Ticker */}
      <div className="telem-ticker" onClick={() => setOpen(!open)}>
        <div className="telem-ticker-left">
          <span className={`telem-pulse ${fromDiskCache ? 'pulse-amber' : 'pulse-green'}`} />
          <span className="telem-status-tag">
            {fromDiskCache ? 'DISK CACHED' : 'LIVE FEED'}
          </span>
          <span className="telem-ticker-metrics">
            {tempVal != null && (
              <span className="ticker-item">
                🌡 {tempVal}°C <small>[MODELLED]</small>
              </span>
            )}
            {rhVal != null && (
              <span className="ticker-item">
                💧 {rhVal}% RH <small>[MODELLED]</small>
              </span>
            )}
            {pm25Val != null && (
              <span className="ticker-item">
                🌫 PM2.5: {pm25Val} µg/m³{' '}
                <small>
                  [{airQuality.cpcb_pm25_measured.value ? 'MEASURED' : 'MODELLED'}]
                </small>
              </span>
            )}
            <span className="ticker-item">
              ✈ Flights: {flightCount} <small>[MEASURED]</small>
            </span>
            {premierTrain && (
              <span className="ticker-item ticker-train-item">
                🚂 HWH: {premierTrain.trainNumber} ({premierTrain.platform} {premierTrain.status}){' '}
                <small>[{premierTrain.category}]</small>
              </span>
            )}
          </span>
        </div>

        <div className="telem-ticker-actions">
          {onToggleFog && (
            <button
              className={`telem-btn-fog ${enableFog ? 'fog-on' : 'fog-off'}`}
              onClick={(e) => {
                e.stopPropagation()
                onToggleFog()
              }}
              title={enableFog ? 'Atmospheric fog is active. Click to remove fog.' : 'Fog is removed (Crystal Clear). Click to enable live atmospheric fog.'}
            >
              {enableFog ? '🌫️ Fog: ON' : '☀️ Clear (No Fog)'}
            </button>
          )}
          <button
            className="telem-btn-refresh"
            onClick={(e) => {
              e.stopPropagation()
              onRefresh()
            }}
            title="Refresh telemetry feeds now"
            disabled={loading}
          >
            {loading ? '⏳' : '⟳'}
          </button>
          <button className="telem-btn-toggle" title="Toggle detailed inspector">
            {open ? '▼ Close' : '▲ Telemetry Inspector'}
          </button>
        </div>
      </div>

      {/* Expanded Detailed Telemetry Panel */}
      {open && (
        <div className="telem-drawer">
          <div className="telem-drawer-header">
            <div>
              <h3 className="telem-drawer-title">Kolkata Live Digital Twin Telemetry</h3>
              <div className="telem-disclaimer">
                Every value shows its source, time, and whether it is <strong>MEASURED</strong>,{' '}
                <strong>MODELLED</strong>, or <strong>ESTIMATED</strong>. Gaps are never filled with invented values.
                {fromDiskCache && (
                  <span className="telem-warn-pill">
                    Serving last good copy from disk cache ({lastDiskCacheTime ? new Date(lastDiskCacheTime).toLocaleTimeString() : ''})
                  </span>
                )}
              </div>
            </div>
            <div className="telem-tabs">
              <button
                className={activeTab === 'all' ? 'active' : ''}
                onClick={() => setActiveTab('all')}
              >
                All Feeds
              </button>
              <button
                className={activeTab === 'weather' ? 'active' : ''}
                onClick={() => setActiveTab('weather')}
              >
                Weather
              </button>
              <button
                className={activeTab === 'air' ? 'active' : ''}
                onClick={() => setActiveTab('air')}
              >
                Air Quality
              </button>
              <button
                className={activeTab === 'traffic' ? 'active' : ''}
                onClick={() => setActiveTab('traffic')}
              >
                Traffic
              </button>
              <button
                className={activeTab === 'flights' ? 'active' : ''}
                onClick={() => setActiveTab('flights')}
              >
                Flights ({flightCount})
              </button>
              <button
                className={activeTab === 'trains' ? 'active' : ''}
                onClick={() => setActiveTab('trains')}
              >
                🚂 Trains ({trainCount})
              </button>
            </div>
          </div>

          <div className="telem-drawer-content">
            {/* Weather & Wind */}
            {(activeTab === 'all' || activeTab === 'weather') && (
              <section className="telem-card">
                <div className="telem-card-title">
                  <span>🌦 Weather & Wind</span>
                  <CategoryBadge category="MODELLED" />
                </div>
                <div className="telem-card-body">
                  <TelemetryRow label="Air Temperature (2m)" field={weather.temperature} />
                  <TelemetryRow label="Relative Humidity" field={weather.relativeHumidity} />
                  <TelemetryRow label="Apparent Temperature" field={weather.apparentTemperature} />
                  <TelemetryRow
                    label="Wind Speed (10m)"
                    field={weather.windSpeed}
                    displayValue={
                      weather.windSpeed.value != null
                        ? `${weather.windSpeed.value} km/h (Heading ${weather.windDirection.value}°)`
                        : undefined
                    }
                  />
                  <TelemetryRow label="Precipitation" field={weather.precipitation} />
                  <TelemetryRow label="Synoptic Weather Code" field={weather.weatherCode} />
                </div>
              </section>
            )}

            {/* Air Quality & PM2.5 */}
            {(activeTab === 'all' || activeTab === 'air') && (
              <section className="telem-card">
                <div className="telem-card-title">
                  <span>🌫 Air Quality & Particulate Matter</span>
                </div>
                <div className="telem-card-body">
                  <TelemetryRow
                    label="PM2.5 (Open-Meteo Regional Model)"
                    field={airQuality.pm25_modelled}
                  />
                  <TelemetryRow
                    label="PM10 (Open-Meteo Regional Model)"
                    field={airQuality.pm10_modelled}
                  />
                  <TelemetryRow
                    label="US AQI (Air Quality Index)"
                    field={airQuality.usAqi_modelled}
                  />
                  <TelemetryRow
                    label="CPCB Ground Station PM2.5 (CAAQMS)"
                    field={airQuality.cpcb_pm25_measured}
                    displayValue={
                      airQuality.cpcb_pm25_measured.value
                        ? `${airQuality.cpcb_pm25_measured.value.avg} µg/m³ (${airQuality.cpcb_pm25_measured.value.station})`
                        : undefined
                    }
                  />
                  <TelemetryRow
                    label="Dynamic Haze Extinction Coefficient"
                    field={derived.hazeDensity}
                  />
                </div>
              </section>
            )}

            {/* Traffic Speeds & Congestion */}
            {(activeTab === 'all' || activeTab === 'traffic') && (
              <section className="telem-card">
                <div className="telem-card-title">
                  <span>🚦 Road Network & Traffic Speeds</span>
                </div>
                <div className="telem-card-body">
                  <TelemetryRow
                    label="TomTom Flow Speed (Howrah Bridge Corridor)"
                    field={traffic.tomtomSpeed}
                    displayValue={
                      traffic.tomtomSpeed.value
                        ? `${traffic.tomtomSpeed.value.currentSpeedKmph} km/h (Free Flow: ${traffic.tomtomSpeed.value.freeFlowSpeedKmph} km/h, Ratio: ${traffic.tomtomSpeed.value.speedRatio}x)`
                        : undefined
                    }
                  />
                  <TelemetryRow
                    label="Active Traffic Simulation Velocity Factor"
                    field={derived.trafficSpeedFactor}
                  />
                </div>
              </section>
            )}

            {/* Howrah Railway Station Live Trains */}
            {(activeTab === 'all' || activeTab === 'trains') && (
              <section className="telem-card telem-card-full">
                <div className="telem-card-title">
                  <span>🏛 Howrah Junction Railway Station (HWH) — Live Operations & Passenger Information</span>
                  <CategoryBadge category={station?.howrahTrains?.category || 'MODELLED'} />
                </div>
                <div className="telem-card-body">
                  <div className="telem-row">
                    <div className="telem-row-header">
                      <span className="telem-label">Station Terminals</span>
                      <span className="telem-val">Howrah Junction (23 Platforms • Eastern & South Eastern Railway)</span>
                    </div>
                    <div className="telem-row-sub">
                      <span>{station?.howrahTrains?.source || 'Indian Railways Howrah Division'}</span>
                      <span>🕒 {station?.howrahTrains?.timestamp ? new Date(station.howrahTrains.timestamp).toLocaleTimeString() : '—'}</span>
                    </div>
                    {station?.howrahTrains?.notes && (
                      <div className="telem-notes">ℹ {station.howrahTrains.notes}</div>
                    )}
                  </div>

                  {trainList.length > 0 ? (
                    <div className="flights-table-wrap">
                      <table className="flights-table">
                        <thead>
                          <tr>
                            <th>Train No. & Name</th>
                            <th>Type</th>
                            <th>Sched / Actual</th>
                            <th>Direction</th>
                            <th>Platform</th>
                            <th>Status</th>
                            <th>Classification</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trainList.map((t) => (
                            <tr key={t.trainNumber}>
                              <td className="flight-callsign-cell">
                                <span className="train-number-tag">{t.trainNumber}</span> {t.trainName}
                              </td>
                              <td>
                                <span className={`train-type-badge type-${t.trainType.toLowerCase().replace(/\s+/g, '')}`}>
                                  {t.trainType}
                                </span>
                              </td>
                              <td>{t.scheduledTime}</td>
                              <td>{t.type}</td>
                              <td className="train-plat-cell">{t.platform}</td>
                              <td>
                                <span className={`train-status-pill status-${t.status.toLowerCase().replace(/\s+/g, '')}`}>
                                  {t.status}
                                </span>
                              </td>
                              <td>
                                <CategoryBadge category={t.category} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="telem-empty">Connecting to Howrah Station dispatch feed…</div>
                  )}
                </div>
              </section>
            )}

            {/* OpenSky Flights near Kolkata Airport */}
            {(activeTab === 'all' || activeTab === 'flights') && (
              <section className="telem-card telem-card-full">
                <div className="telem-card-title">
                  <span>✈ Kolkata Airport Airspace (CCU / VECC 22.6547° N, 88.4467° E)</span>
                  <CategoryBadge category="MEASURED" />
                </div>
                <div className="telem-card-body">
                  <TelemetryRow
                    label="Active ADS-B Tracked Flights in Terminal Radar Sector"
                    field={flights.activeFlights}
                    displayValue={`${flightCount} active flights`}
                  />

                  {flightCount > 0 && flights.activeFlights.value ? (
                    <div className="flights-table-wrap">
                      <table className="flights-table">
                        <thead>
                          <tr>
                            <th>Callsign</th>
                            <th>Altitude</th>
                            <th>Speed</th>
                            <th>Heading</th>
                            <th>Dist to CCU</th>
                            <th>Origin Country</th>
                            <th>Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {flights.activeFlights.value.map((f) => (
                            <tr key={f.icao24}>
                              <td className="flight-callsign-cell">
                                ✈ {f.callsign} <small>({f.icao24})</small>
                              </td>
                              <td>{f.altitudeMeters != null ? `${f.altitudeMeters} m` : 'Surface'}</td>
                              <td>{f.velocityKmph != null ? `${Math.round(f.velocityKmph)} km/h` : '—'}</td>
                              <td>{f.headingDeg != null ? `${f.headingDeg}°` : '—'}</td>
                              <td>{f.distKmFromAirport} km</td>
                              <td>{f.originCountry}</td>
                              <td>
                                <CategoryBadge category="MEASURED" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="telem-empty">
                      No airborne aircraft currently detected in the 50km terminal radar sector.
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
