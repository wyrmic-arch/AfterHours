// AFTERHOURS stylized terrain material — Genshin-style banded vertex colors,
// 3-level cel ramp lighting, distance fog matched to sky horizon.
// One shared ShaderMaterial -> cheap, batchable, no texture memory.

import * as THREE from 'three';
import { WATERLINE } from './terrainField.js';

const vert = /* glsl */`
  varying vec3 vColor;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  attribute vec3 aColor;
  void main() {
    vColor = aColor;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */`
  precision highp float;
  varying vec3 vColor;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbientTop;
  uniform vec3 uAmbientBot;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uCelRamp;   // 0..1 how "stepped" the shading is
  uniform vec3 uWaterTint;
  uniform float uSeaLevel;

  void main() {
    vec3 n = normalize(vNormalW);
    float ndl = dot(n, uSunDir);
    // soft cel ramp: quantize then smooth back a touch (controlled by uCelRamp)
    float bands = mix(12.0, 3.0, uCelRamp);
    float lit = floor(clamp(ndl * 0.5 + 0.5, 0.0, 1.0) * bands) / bands;
    lit = mix(clamp(ndl * 0.5 + 0.5, 0.0, 1.0), lit, uCelRamp);
    float shade = 0.32 + 0.68 * smoothstep(0.08, 0.55, lit);

    // hemisphere ambient by normal.y
    vec3 amb = mix(uAmbientBot, uAmbientTop, n.y * 0.5 + 0.5);

    vec3 col = vColor;

    // underwater tint blend
    float sub = smoothstep(uSeaLevel + 1.5, uSeaLevel - 2.5, vWorldPos.y);
    col = mix(col, uWaterTint, sub * 0.75);

    vec3 shaded = col * amb * shade + col * uSunColor * max(ndl, 0.0) * 0.18;

    // subtle warm rim on sun-facing slopes (anime bounce light)
    shaded += uSunColor * pow(max(dot(n, uSunDir), 0.0), 3.0) * 0.06;

    // exponential-squared distance fog tuned to sky horizon color
    float depth = length(vWorldPos - cameraPosition);
    float f = clamp((depth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    f = f * f;
    shaded = mix(shaded, uFogColor, f);

    gl_FragColor = vec4(shaded, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createTerrainMaterial() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(0xffe9c4) },
      uAmbientTop: { value: new THREE.Color(0x9fb8d8) },
      uAmbientBot: { value: new THREE.Color(0x5a5f6e) },
      uFogColor: { value: new THREE.Color(0xcfe3ee) },
      uFogNear: { value: 300 },
      uFogFar: { value: 2600 },
      uCelRamp: { value: 0.75 },
      uWaterTint: { value: new THREE.Color(0x3f7f8f) },
      uSeaLevel: { value: WATERLINE },
    },
  });
  return mat;
}

// ---- Vertex coloring palette (anime spring palette, hand-tuned) ----
import { slopeAt, riverCenterX, LAKE } from './terrainField.js';

const C = {
  deepSeabed: [0.20, 0.36, 0.42],
  seabed:     [0.28, 0.50, 0.52],
  sand:       [0.87, 0.79, 0.58],
  sandDark:   [0.78, 0.68, 0.48],
  grassA:     [0.42, 0.68, 0.33],
  grassB:     [0.53, 0.75, 0.36],
  grassDeep:  [0.30, 0.55, 0.30],
  meadow:     [0.60, 0.77, 0.40],
  forestFloor:[0.26, 0.47, 0.27],
  rockLow:    [0.46, 0.44, 0.46],
  rockHigh:   [0.58, 0.57, 0.60],
  snow:       [0.95, 0.96, 1.00],
  rockSnow:   [0.72, 0.74, 0.80],
};

function mix3(a, b, t, out) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

// Compute RGB color for a world point given its height. Writes into `out`.
export function terrainColor(x, z, h, out) {
  const sl = slopeAt(x, z);
  const steep = smoothstepLocal(0.28, 0.55, sl);

  if (h < -6) {
    mix3(C.deepSeabed, C.seabed, smoothstepLocal(-16, -6, h), out);
    return out;
  }
  if (h < 1.2) { // beach band
    mix3(C.seabed, C.sand, smoothstepLocal(-6, 1.2, h), out);
    // wet-sand strip near waterline
    if (Math.abs(h - 0) < 1.4) mix3(out, C.sandDark, 0.5, out);
    return out;
  }

  // base green varies with noise-free hash of position for patchwork feel
  const patch = patchNoise(x, z);
  let g;
  if (patch > 0.62) g = C.meadow;
  else if (patch < 0.3) g = C.grassDeep;
  else g = C.grassA;
  mix3(g, C.grassB, smoothstepLocal(6, 60, h), out);

  // west forest floor darkening handled by scatter; slight valley greening
  const nearRiver = Math.abs(x - riverCenterX(Math.max(-1600, Math.min(1300, z)))) < 90 && h < 26 && z < 1300 && z > -1500;
  if (nearRiver) mix3(out, C.forestFloor, 0.25, out);

  // lake shore ring (pebbly)
  const ld = Math.hypot((x - LAKE.x()) / 1.6, (z - LAKE.z) / 1.0);
  if (ld < 330 && h < 30) mix3(out, C.sandDark, smoothstepLocal(330, 260, ld) * 0.35, out);

  // rock on steep slopes at any altitude
  mix3(out, steep > 0.5 ? C.rockHigh : C.rockLow, steep, out);

  // altitude bands
  if (h > 150) {
    const rockiness = smoothstepLocal(150, 210, h);
    mix3(out, C.rockHigh, rockiness * (1 - steep), out);
  }
  if (h > 230) {
    const snowLine = 230 + patch * 40;
    const s = smoothstepLocal(snowLine, snowLine + 45, h) * (1 - smoothstepLocal(0.45, 0.7, sl));
    mix3(out, C.rockSnow, Math.min(s, 0.4), out);
    mix3(out, C.snow, s, out);
  }
  return out;
}

function smoothstepLocal(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// cheap deterministic 2D hash noise 0..1 for color patches
function patchNoise(x, z) {
  const s = Math.sin(x * 0.017 + 12.9898) * 43758.5453 + Math.sin(z * 0.013 + 78.233) * 24634.6345;
  const v = Math.sin(s) * 43758.5453;
  return v - Math.floor(v);
}
