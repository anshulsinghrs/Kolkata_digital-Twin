// GLSL shared by the sky dome, the haze pass and the river so the horizon always matches.
export const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`

export const SKY_GLSL = /* glsl */ `
// Hazy golden-hour sky. d = view direction (world), s = direction to the sun.
vec3 skyColor(vec3 d, vec3 s){
  float h = clamp(d.y, 0.0, 1.0);
  vec2 dxz = normalize(d.xz + vec2(1e-5));
  vec2 sxz = normalize(s.xz);
  float az = 0.5 + 0.5 * dot(dxz, sxz);            // 1 towards the sun, 0 opposite
  float mu = max(dot(d, s), 0.0);
  vec3 zenith = vec3(0.15, 0.26, 0.50);
  vec3 mid = mix(vec3(0.34, 0.43, 0.61), vec3(0.82, 0.62, 0.45), az * az);
  // opposite the sun the horizon is a dusty mauve-pink; towards it, molten peach
  vec3 horizon = mix(vec3(0.64, 0.50, 0.46), vec3(1.42, 0.84, 0.42), pow(az, 2.2));
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.27, h));
  col = mix(col, zenith, smoothstep(0.14, 0.9, h));
  // forward scattering around the sun: wide warm veil plus a tight core
  col += vec3(1.0, 0.55, 0.22) * (0.5 * pow(mu, 6.0) + 1.4 * pow(mu, 40.0));
  return col;
}
// Colour that distance fades into: the horizon in that direction, a little greyer and dimmer.
vec3 hazeColor(vec3 d, vec3 s){
  vec3 c = skyColor(normalize(vec3(d.x, 0.03, d.z)), s);
  float l = dot(c, vec3(0.3, 0.55, 0.15));
  return mix(c, vec3(l) * vec3(1.05, 1.0, 0.94), 0.3) * 0.97;
}
`
