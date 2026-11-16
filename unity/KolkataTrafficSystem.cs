using System;
using System.Collections.Generic;
using UnityEngine;

namespace KolkataTwin.Simulation
{
    public enum VehicleType
    {
        YellowTaxi,
        KolkataBus,
        AutoRickshaw,
        TwoWheeler,
        HandPulledCart,
        GoodsTruck
    }

    [System.Serializable]
    public class VehicleModelConfig
    {
        public VehicleType type;
        public Mesh mesh;
        public Material material;
        public float length = 4.4f;
        public float defaultSpeed = 12f;
    }

    [System.Serializable]
    public class CityRoadPath
    {
        public int roadId;
        public Vector3[] points;
        public float[] cumDist;
        public float totalLength;
        public float width;
        public int roadClass; // 0 = Arterial, 1 = Residential/Collector, 2 = Narrow
    }

    public class VehicleInstance
    {
        public VehicleType type;
        public bool isBridge;
        public CityRoadPath path;
        public float s;          // progress along road/bridge (meters)
        public float laneOffset; // lateral offset (meters)
        public float targetLane;
        public int dir;          // +1 or -1
        public float speed;
        public float targetSpeed;
        public float length;
        public bool isFiltering;
    }

    /// <summary>
    /// Stage 2 & Citywide Traffic: Real-time GPU Instanced Mixed Traffic Simulation for Unity 6 (URP).
    /// Features:
    /// - 100% GPU instanced drawing (1 draw call per vehicle type via Graphics.RenderMeshInstanced)
    /// - Complete City Coverage: Howrah Bridge + All OSM City Roads (both Kolkata & Howrah banks)
    /// - Indian road rules (Left-hand drive, slow vehicles/carts in kerbside lane)
    /// - Intelligent car-following deceleration (IDM)
    /// - Two-wheeler filtering (lane splitting between slow traffic)
    /// </summary>
    public class KolkataTrafficSystem : MonoBehaviour
    {
        [Header("Model Configurations (from models/*.fbx)")]
        [SerializeField] private List<VehicleModelConfig> vehicleConfigs = new List<VehicleModelConfig>();

        [Header("Traffic Population")]
        [SerializeField] private int bridgeVehicleCount = 220;
        [SerializeField] private int cityVehicleCount = 680;

        [Header("Bridge Roadway Geometry")]
        [SerializeField] private Vector3 bridgeCenter = new Vector3(0.26f, 0f, -0.02f);
        [SerializeField] private Vector3 bridgeDirection = new Vector3(0.9665f, 0f, 0.2567f);
        [SerializeField] private float halfSpan = 377.7f;
        [SerializeField] private float deckElevation = 28.5f;

        [Header("City Road Paths (OSM Roads)")]
        [SerializeField] private List<CityRoadPath> roadPaths = new List<CityRoadPath>();

        private readonly List<VehicleInstance> vehicles = new List<VehicleInstance>();
        private readonly Dictionary<VehicleType, List<Matrix4x4>> matrixBatches = new Dictionary<VehicleType, List<Matrix4x4>>();

        // Indian Left-Hand Drive Lanes on Howrah Bridge
        private readonly float[] bridgeLanesEast = { -8.8f, -6.0f, -3.4f, -1.2f };
        private readonly float[] bridgeLanesWest = { 1.2f, 3.4f, 6.0f, 8.8f };

        private void Start()
        {
            InitializeFleet();
        }

        private void InitializeFleet()
        {
            var rnd = new System.Random(1943);

            // 1. Populate Howrah Bridge (220 vehicles in 8 lanes)
            for (int i = 0; i < bridgeVehicleCount; i++)
            {
                bool east = (i % 2 == 0);
                int dir = east ? 1 : -1;
                float[] lanes = east ? bridgeLanesEast : bridgeLanesWest;

                double r = rnd.NextDouble();
                VehicleType vType;
                float lane;
                float speed;
                float len;

                if (r < 0.08)
                {
                    vType = VehicleType.HandPulledCart;
                    lane = lanes[0]; // Kerbside slow lane
                    speed = 2.2f;
                    len = 3.6f;
                }
                else if (r < 0.20)
                {
                    vType = VehicleType.GoodsTruck;
                    lane = rnd.NextDouble() < 0.65 ? lanes[0] : lanes[1];
                    speed = 8.0f;
                    len = 8.2f;
                }
                else if (r < 0.36)
                {
                    vType = VehicleType.KolkataBus;
                    lane = rnd.NextDouble() < 0.6 ? lanes[1] : lanes[0];
                    speed = 9.5f;
                    len = 9.6f;
                }
                else if (r < 0.52)
                {
                    vType = VehicleType.AutoRickshaw;
                    lane = rnd.NextDouble() < 0.6 ? lanes[2] : lanes[0];
                    speed = 10.5f;
                    len = 2.8f;
                }
                else if (r < 0.72)
                {
                    vType = VehicleType.TwoWheeler;
                    lane = rnd.NextDouble() < 0.65 ? lanes[3] : lanes[2];
                    speed = 12.5f;
                    len = 2.0f;
                }
                else
                {
                    vType = VehicleType.YellowTaxi;
                    lane = rnd.NextDouble() < 0.5 ? lanes[2] : (rnd.NextDouble() < 0.5 ? lanes[3] : lanes[1]);
                    speed = 13.0f;
                    len = 4.4f;
                }

                float s = ((float)rnd.NextDouble() * 2f - 1f) * halfSpan;
                vehicles.Add(new VehicleInstance
                {
                    type = vType,
                    isBridge = true,
                    s = s,
                    laneOffset = lane,
                    targetLane = lane,
                    dir = dir,
                    speed = speed,
                    targetSpeed = speed,
                    length = len,
                    isFiltering = false
                });
            }

            // 2. Populate Complete City Road Network (680 vehicles across OSM road paths)
            if (roadPaths.Count > 0)
            {
                for (int i = 0; i < cityVehicleCount; i++)
                {
                    var path = roadPaths[rnd.Next(roadPaths.Count)];
                    if (path.points == null || path.points.Length < 2) continue;

                    int dir = rnd.Next(2) == 0 ? 1 : -1;
                    double r = rnd.NextDouble();
                    VehicleType vType = r < 0.08 ? VehicleType.HandPulledCart :
                                        r < 0.18 ? VehicleType.GoodsTruck :
                                        r < 0.32 ? VehicleType.KolkataBus :
                                        r < 0.48 ? VehicleType.AutoRickshaw :
                                        r < 0.68 ? VehicleType.TwoWheeler : VehicleType.YellowTaxi;

                    float lateralRatio = path.width >= 8f ? 0.25f : 0.20f;
                    float laneOffset = path.width * lateralRatio;
                    float speed = vType == VehicleType.HandPulledCart ? 2.2f :
                                  vType == VehicleType.GoodsTruck ? 8.0f :
                                  vType == VehicleType.KolkataBus ? 9.0f : 12.0f;

                    float s = (float)rnd.NextDouble() * path.totalLength;
                    vehicles.Add(new VehicleInstance
                    {
                        type = vType,
                        isBridge = false,
                        path = path,
                        s = s,
                        laneOffset = laneOffset,
                        targetLane = laneOffset,
                        dir = dir,
                        speed = speed,
                        targetSpeed = speed,
                        length = vType == VehicleType.KolkataBus ? 9.6f : 4.4f,
                        isFiltering = false
                    });
                }
            }
        }

        private void Update()
        {
            float dt = Mathf.Min(Time.deltaTime, 0.08f);

            foreach (VehicleType vt in Enum.GetValues(typeof(VehicleType)))
            {
                if (!matrixBatches.ContainsKey(vt)) matrixBatches[vt] = new List<Matrix4x4>();
                matrixBatches[vt].Clear();
            }

            // Multi-Agent Simulation: Car-Following & Two-Wheeler Filtering
            for (int i = 0; i < vehicles.Count; i++)
            {
                var v = vehicles[i];

                float minGap = float.MaxValue;
                float leadSpeed = v.targetSpeed;

                for (int j = 0; j < vehicles.Count; j++)
                {
                    if (i == j) continue;
                    var other = vehicles[j];
                    if (v.isBridge != other.isBridge) continue;
                    if (!v.isBridge && v.path != other.path) continue;
                    if (other.dir != v.dir) continue;

                    if (Mathf.Abs(other.laneOffset - v.laneOffset) < 1.4f)
                    {
                        float gap = (other.s - v.s) * v.dir;
                        if (gap > 0 && gap < minGap)
                        {
                            minGap = gap - (v.length * 0.5f + other.length * 0.5f);
                            leadSpeed = other.speed;
                        }
                    }
                }

                // Two-Wheeler Filtering
                if (v.type == VehicleType.TwoWheeler)
                {
                    if (minGap < 9.0f && leadSpeed < 8.0f && !v.isFiltering)
                    {
                        v.isFiltering = true;
                        v.targetLane = v.laneOffset + (v.dir > 0 ? 1.2f : -1.2f);
                    }
                    else if (minGap > 14.0f && v.isFiltering)
                    {
                        v.isFiltering = false;
                        v.targetLane = v.isBridge ? (v.dir > 0 ? -1.2f : 1.2f) : (v.path != null ? v.path.width * 0.16f : 1.2f);
                    }
                }

                if (Mathf.Abs(v.targetLane - v.laneOffset) > 0.05f)
                {
                    v.laneOffset = Mathf.Lerp(v.laneOffset, v.targetLane, dt * 2.5f);
                }

                // IDM Car-Following Deceleration
                float safeDistance = Mathf.Max(3.0f, 3.5f + v.speed * 0.75f);
                if (minGap < safeDistance)
                {
                    float targetV = Mathf.Max(0f, leadSpeed * Mathf.Max(0f, (minGap - 1.5f) / safeDistance));
                    v.speed = Mathf.Lerp(v.speed, targetV, dt * 4.0f);
                }
                else
                {
                    v.speed = Mathf.Lerp(v.speed, v.targetSpeed, dt * 2.0f);
                }

                v.s += v.dir * v.speed * dt;

                Matrix4x4 mat;
                if (v.isBridge)
                {
                    if (v.dir > 0 && v.s > halfSpan) v.s = -halfSpan;
                    if (v.dir < 0 && v.s < -halfSpan) v.s = halfSpan;

                    float archY = deckElevation + 2.6f * (1f - Mathf.Pow(Mathf.Clamp01(Mathf.Abs(v.s) / halfSpan), 2f));
                    float rotY = Mathf.Atan2(-bridgeDirection.z, bridgeDirection.x) * Mathf.Rad2Deg;
                    Quaternion bridgeRot = Quaternion.Euler(0f, rotY, 0f);

                    Vector3 localPos = new Vector3(v.s, archY, v.laneOffset);
                    Vector3 worldPos = bridgeCenter + bridgeRot * localPos;

                    Quaternion vehicleRot = bridgeRot * Quaternion.Euler(0f, v.dir > 0 ? -90f : 90f, 0f);
                    mat = Matrix4x4.TRS(worldPos, vehicleRot, Vector3.one);
                }
                else if (v.path != null && v.path.points.Length >= 2)
                {
                    if (v.dir > 0 && v.s > v.path.totalLength) v.s = 0;
                    if (v.dir < 0 && v.s < 0) v.s = v.path.totalLength;

                    // Sample city road spline
                    Vector3 pos = SampleSpline(v.path, v.s, out Vector3 forward);
                    Vector3 travelFwd = forward * v.dir;
                    Vector3 leftNormal = Vector3.Cross(Vector3.up, travelFwd).normalized;

                    Vector3 worldPos = pos + leftNormal * v.laneOffset;
                    worldPos.y = 0.20f;

                    Quaternion rot = Quaternion.LookRotation(travelFwd, Vector3.up);
                    mat = Matrix4x4.TRS(worldPos, rot, Vector3.one);
                }
                else
                {
                    continue;
                }

                matrixBatches[v.type].Add(mat);
            }

            // Render GPU Instanced Batches
            foreach (var cfg in vehicleConfigs)
            {
                if (cfg.mesh == null || cfg.material == null) continue;
                if (!matrixBatches.TryGetValue(cfg.type, out var list) || list.Count == 0) continue;

                for (int i = 0; i < list.Count; i += 1000)
                {
                    int batchSize = Mathf.Min(1000, list.Count - i);
                    var slice = list.GetRange(i, batchSize).ToArray();
                    var rp = new RenderParams(cfg.material)
                    {
                        shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On,
                        receiveShadows = true
                    };
                    Graphics.RenderMeshInstanced(rp, cfg.mesh, 0, slice);
                }
            }
        }

        private Vector3 SampleSpline(CityRoadPath path, float s, out Vector3 forward)
        {
            var pts = path.points;
            if (s <= 0 || pts.Length < 2)
            {
                forward = (pts[1] - pts[0]).normalized;
                return pts[0];
            }
            if (s >= path.totalLength)
            {
                forward = (pts[pts.Length - 1] - pts[pts.Length - 2]).normalized;
                return pts[pts.Length - 1];
            }

            int i = 0;
            while (i < path.cumDist.Length - 1 && path.cumDist[i + 1] < s) i++;
            float segLen = path.cumDist[i + 1] - path.cumDist[i];
            float t = segLen > 0 ? (s - path.cumDist[i]) / segLen : 0;

            forward = (pts[i + 1] - pts[i]).normalized;
            return Vector3.Lerp(pts[i], pts[i + 1], t);
        }
    }
}
