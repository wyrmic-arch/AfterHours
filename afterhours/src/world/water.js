// Water system: ocean plane + river ribbon meshes + lake disc.
// Single shared stylized shader (procedural layered waves, bank foam, sun sparkle).

import * as THREE from 'three';
import { WATERLINE, LAKE, riverCenterX, riverProfile, heightAt } from './terrainField.js';

const vert = /* glsl */`
  varying vec3 vWorldPos;
  varying float vFoam;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vFoam = uv.y; // ribbons encode edge-foam in v; big planes use 0.5
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uFoamColor;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uSparkle;
  varying vec3 vWorldPos;
  varying float vFoam;

  vec2 waveOffset(vec2 p, float t) {
    float a = sin(p.x * 0.09 + t * 1.1) * 0.6 + sin(p.y * 0.11 - t * 0.9) * 0.5;
    float b = cos(p.y * 0.08 + t * 1.3) * 0.6 + cos(p.x * 0.1 - t * 1.15) * 0.5;
    return vec2(a, b);
  }

  void main() {
    vec2 p = vWorldPos.xz;
    float t = uTime;
    vec2 w1 = waveOffset(p, t);
    vec2 w2 = waveOffset(p * 1.7 + 31.0, t * 1.31 + 7.0);
    vec3 n = normalize(vec3((w1.x + w2.x * 0.6) * 0.06, 1.0, (w1.y + w2.y * 0.6) * 0.06));

    float facing = n.y * 0.5 + 0.5;
    vec3 col = mix(uDeepColor, uShallowColor, smoothstep(0.5, 0.9, facing + length(w1) * 0.06));

    float edge = smoothstep(0.78, 1.0, max(vFoam, 1.0 - vFoam));
    col = mix(col, uFoamColor, edge * 0.9);

    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 H = normalize(V + uSunDir);
    float spec = pow(max(dot(n, H), 0.0), 64.0) * uSparkle;
    col += vec3(1.0, 0.96, 0.82) * spec;

    float distToCam = length(vWorldPos - cameraPosition);
    float f = clamp((distToCam - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    f = f * f;
    col = mix(col, uFogColor, f);

    gl_FragColor = vec4(col, 0.94);
    #include <colorspace_fragment>
  }
`;

export class WaterSystem {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
        uDeepColor: { value: new THREE.Color(0x2f7a9e) },
        uShallowColor: { value: new THREE.Color(0x6fc3d8) },
        uFoamColor: { value: new THREE.Color(0xeaf7fb) },
        uFogColor: { value: new THREE.Color(0xcfe3ee) },
        uFogNear: { value: 300 },
        uFogFar: { value: 2600 },
        uSparkle: { value: 0.9 },
      },
    });

    // --- Ocean: large plane following player ---
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000, 1, 1), this.material);
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = WATERLINE;
    this.ocean.frustumCulled = false;
    fixUV(this.ocean.geometry, 0.5);
    scene.add(this.ocean);

    // --- Lake disc ---
    const lakeGeo = new THREE.CircleGeometry(LAKE.rx, 40);
    lakeGeo.rotateX(-Math.PI / 2);
    lakeGeo.scale(1, 1, LAKE.rz / LAKE.rx);
    this.lake = new THREE.Mesh(lakeGeo, this.material);
    this.lake.position.set(LAKE.x(), LAKE.surface, LAKE.z);
    fixUV(this.lake.geometry, 0.5);
    scene.add(this.lake);

    // --- River ribbons ---
    this.river = buildRibbon(sampleMainRiverPoints(), this.material);
    this.tributary = buildRibbon(sampleTributaryPoints(), this.material);
    scene.add(this.river);
    scene.add(this.tributary);
  }

  setSun(dir, fogColor, fogNear, fogFar) {
    const u = this.material.uniforms;
    u.uSunDir.value.copy(dir).normalize();
    u.uFogColor.value.set(fogColor);
    u.uFogNear.value = fogNear;
    u.uFogFar.value = fogFar;
  }

  update(dt, px, pz) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.ocean.position.x = px;
    this.ocean.position.z = pz;
  }
}

function riverSurface(z) {
  return riverProfile(z) + 4.5;
}

function sampleMainRiverPoints() {
  const pts = [];
  for (let z = LAKE.z - 60; z >= -1560; z -= 22) {
    pts.push({ x: riverCenterX(z), z, y: riverSurface(z), hw: z > -940 ? 15 : 26 });
  }
  return pts;
}

function sampleTributaryPoints() {
  // locate carved channel by probing terrain heights across the expected band
  const pts = [];
  const endX = riverCenterX(250);
  for (let x = -1700; x <= endX; x += 22) {
    let bestZ = 250, bestH = Infinity;
    for (let z = 0; z <= 520; z += 12) {
      const h = heightAt(x, z);
      if (h < bestH) { bestH = h; bestZ = z; }
    }
    pts.push({ x, z: bestZ, y: bestH + 3.4, hw: 8 });
  }
  return pts;
}

function buildRibbon(pts, material) {
  const positions = [];
  const uvs = [];
  const indices = [];
  let vi = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next.x - prev.x, dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const px = -dz, pz = dx;
    positions.push(a.x + px * a.hw, a.y, a.z + pz * a.hw);
    positions.push(a.x - px * a.hw, a.y, a.z - pz * a.hw);
    uvs.push(0, 0, 0, 1);
    if (i > 0) indices.push(vi - 2, vi - 1, vi, vi, vi - 1, vi + 1);
    vi += 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
}

function fixUV(geo, v) {
  const count = geo.attributes.position.count;
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) { uv[i * 2] = 0.5; uv[i * 2 + 1] = v; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
