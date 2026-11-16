# Kolkata Digital Twin: Howrah Bridge & Complete City Life

A real-time 3D Digital Twin of Kolkata and Howrah centred on the iconic **Howrah Bridge (Rabindra Setu)** and the **Hooghly Riverfront** (22.5851° N, 88.3468° E).

Features **Stage 1 (high-fidelity photorealistic visual twin)**, **Stage 2 (citywide multi-agent life & mixed traffic simulation)**, and **Stage 3 (live telemetry streaming with disk caching, Open-Meteo, OpenSky, CPCB, and TomTom)**.

---

## 🌟 Key Features

* **Stage 3 Live Telemetry Streaming & Disk Cache Resilience**:
  * **Zero Downtime Fallback**: Server caches all live feeds directly to disk (`data/cache/live-cache.json`). If any upstream provider times out, fails, or rate-limits, the server immediately serves the last known good copy with explicit cache timestamps.
  * **Open-Meteo Weather & Wind (No Key Required)**: Real-time temperature (°C), relative humidity (%), apparent temperature, precipitation, and boundary layer 10 m wind speed/direction. Tagged `[MODELLED]`.
  * **Open-Meteo Air Quality (No Key Required)**: Real-time PM2.5 (µg/m³), PM10, European AQI, and US AQI from the Copernicus Atmosphere Monitoring Service (CAMS). Tagged `[MODELLED]`.
  * **CPCB / data.gov.in Ground Station Feed (Key Optional)**: Direct integration with Continuous Ambient Air Quality Monitoring Stations (CAAQMS) across Kolkata (Fort William, Victoria Memorial, etc.). Units verified against official CPCB NAQI dashboard (`µg/m³`). Tagged `[MEASURED]`.
  * **TomTom Traffic Flow API (Key Optional)**: Live vehicle speeds and congestion ratios along Howrah Bridge and Strand Road corridors. Tagged `[MEASURED]`.
  * **OpenSky Network Live Flights**: Real-time ADS-B transponder messages tracking aircraft within the 50 km terminal radar control area of Netaji Subhash Chandra Bose International Airport (CCU / VECC at 22.6547° N, 88.4467° E). Tagged `[MEASURED]`.
  * **Physical & Visual Reactive Coupling**:
    * **Dynamic Haze Thickness**: Haze extinction coefficient follows Hänel's hygroscopic aerosol swelling model derived from live PM2.5 and relative humidity.
    * **Dynamic Traffic Speed**: Multi-agent simulation speeds dynamically follow real-time TomTom flow ratios.
    * **3D Airborne Aircraft**: Live flights are rendered directly in the 3D airspace above Kolkata with altitude, speed, and callsign radar tags.
  * **Strict Data Provenance**: Every metric displays its source, measurement time, and classification (`[MEASURED]`, `[MODELLED]`, or `[ESTIMATED]`). Gaps are never filled with invented values.

* **Complete City OpenStreetMap (OSM) Road Network**:
  * 125 km of real OpenStreetMap road polylines across Kolkata and Howrah.
  * Continuous dark asphalt carriageways with miter-joined curves, rounded junction caps, solid curb markings, and multi-lane dividers.
  * Real-world hierarchy: 24 m dual-carriageway arterials (Strand Road, MG Road), 18 m avenues (Brabourne Rd, GT Rd, Rabindra Sarani), collector streets, and feeder lanes.

* **Stage 2 Multi-Agent Mixed Traffic Simulation**:
  * Over **900 active vehicles** simultaneously moving across the city and Howrah Bridge in **exactly 6 GPU instanced draw calls** at 60 FPS.
  * **6 Low-Poly Kolkata Vehicle Types** (procedurally modeled in Blender 5.3):
    1. **Yellow Taxi** (Hindustan Ambassador)
    2. **State Bus** (CSTC royal blue & yellow)
    3. **Auto-Rickshaw** (Green & yellow 3-wheeler)
    4. **Two-Wheeler** (Commuter scooter/motorcycle with rider)
    5. **Hand-Pulled Cart** (Kolkata wooden thela cart with puller)
    6. **Goods Truck** (Tata 6-wheel classic freight lorry)
  * **Indian Traffic Rules (Left-Hand Drive)**:
    * Vehicles strictly drive on the left side of every road.
    * Slow vehicles & hand-pulled carts stay in kerbside lanes.
    * **Intelligent Driver Model (IDM)**: Dynamic car-following deceleration prevents collisions and bumper overlaps.
    * **Two-Wheeler Filtering**: Motorcycles and scooters filter through gaps between lanes during traffic bottlenecks.

* **Crowd, River & Rail Life**:
  * **240+ Pedestrians**: Walking along Howrah Bridge cantilevered footpaths, Flower Market Ghat steps, and city street sidewalks in colorful authentic attire.
  * **Hooghly River Passenger Ferries**: Double-deck ferries crossing between Howrah Station Ghat and Babu / Flower Market Ghat with dynamic water sway.
  * **Howrah Station Moving Trains**: Active WAP-7 electric locomotive with blue ICF coaches and a suburban EMU local train moving along terminal yard tracks.

* **Visual & Atmospheric Realism**:
  * Accurate Hooghly river water shader with Fresnel reflections, depth murkiness, and wake dynamics.
  * Extended 5,000 m atmospheric sky dome with morning haze and tone mapping.
  * Hand-modeled balanced-cantilever truss Howrah Bridge with 85 m towers, anchor arms, and lower deck hangers.

* **Interactive Navigation Modes**:
  * 🔭 **Orbit View**: Rotate, pan, and zoom around landmarks and saved views.
  * 🚁 **Free Flight (`F`)**: Full WASD 6-DOF flight camera (5 to 250 m/s) with Turbo shift.
  * 🚶 **Street Walk (`V`)**: Ground-level walk at 1.72 m eye height with automatic elevation tracking.

---

## 🚀 Quick Start (WebGL)

### Prerequisites
* Node.js 18+ (tested on Node 20 & 22)

### Installation
```bash
git clone https://github.com/anshulsinghrs/Kolkata_digital-Twin.git
cd Kolkata_digital-Twin
npm install
```

### Development Server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser. (The local backend API runs on port 8787).

### Production Build
```bash
npm run build
npm start
```

---

## 🎮 Unity 6 Setup

This repository includes full assets and C# source code for running the simulation in **Unity 6 (URP)**:
* **3D FBX Models**: Located in `models/*.fbx` (yellow taxi, CSTC bus, auto-rickshaw, two-wheeler, cart, goods truck).
* **GPU Instancing Script**: Located at `unity/KolkataTrafficSystem.cs`.
  * Uses Unity 6's modern `Graphics.RenderMeshInstanced` API for single-draw-call rendering per vehicle class.
  * Incorporates Left-Hand Drive lane rules, IDM car-following physics, and two-wheeler lane splitting.

---

## 📸 Review Views

Run headless screenshot captures:
```bash
npm run shots
```
Saved view shortcuts:
* `?shot=deck`: Howrah Bridge roadway with 8 lanes of mixed traffic and pedestrians.
* `?shot=river`: Hooghly river view looking at the Howrah Bridge cantilever span and ferry crossings.
* `?shot=ghat`: Flower market stepped ghat and promenade.
* `?shot=aerial`: Citywide aerial view of Kolkata, Howrah, and the Hooghly River.

---

## 🛠️ Data Pipeline

```bash
npm run fetch:osm     # Queries Overpass API -> data/osm-raw.json
npm run build:scene   # Processes OSM geometries, road networks & trees -> data/scene.json
```

---

## 📄 License
MIT
