// Sky & atmosphere: three.js Preetham Sky + procedural sun disc + drifting cloud puffs.
// Also exports time-of-day presets that drive fog/sun/water/terrain colors coherently.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export function createSky(scene) {
  const sky = new Sky();
  sky.scale.setScalar(20000);
  sky.frustumCulled = false;
  scene.add(sky);

  // Sun disc (soft additive sprite so we don't need bloom)
  const sunCanvas = makeGlowCanvas('#fff6d8', '#ffd9a0');
  const sunTex = new THREE.CanvasTexture(sunCanvas);
  const sunMat = new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const sunSprite = new THREE.Sprite(sunMat);
  sunSprite.scale.setScalar(900);
  scene.add(sunSprite);

  return { sky, sunSprite };
}

function makeGlowCanvas(inner, outer) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, 'rgba(255,220,170,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return cv;
}

// ---- Stylized clouds: instanced soft-puff sprites on two layers ----
export function createClouds(scene) {
  const puffCanvas = makePuffCanvas();
  const tex = new THREE.CanvasTexture(puffCanvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false });

  const group = new THREE.Group();
  const rand = mulberry(4242);
  const clouds = [];
  for (let i = 0; i < 46; i++) {
    const spr = new THREE.Sprite(mat);
    const layer = i % 2 === 0 ? 1 : 2;
    const y = 320 + layer * 140 + rand() * 60;
    const x = (rand() - 0.5) * 5200;
    const z = (rand() - 0.5) * 5200;
    spr.position.set(x, y, z);
    const s = 260 + rand() * 420;
    spr.scale.set(s, s * (0.32 + rand() * 0.16), 1);
    spr.userData.speed = (4 + rand() * 6) * (layer === 1 ? 1.25 : 0.8);
    group.add(spr);
    clouds.push(spr);
  }
  scene.add(group);
  return {
    update(dt, px, pz) {
      for (const c of clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > px + 3000) c.position.x = px - 3000;
      }
    },
    setTint(color, opacity) {
      mat.color.set(color);
      mat.opacity = opacity;
    },
  };
}

function makePuffCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 256, 128);
  const blobs = [[70, 70, 42], [120, 60, 52], [170, 72, 40], [100, 84, 46], [145, 88, 38], [55, 84, 30]];
  for (const [x, y, r] of blobs) {
    const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return cv;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Time-of-day presets (all colors hand-tuned to stay coherent) ----
export const TIME_PRESETS = {
  golden: {
    label: 'Golden Afternoon',
    elevation: 26, azimuth: 205,
    turbidity: 6, rayleigh: 1.6, mieCoefficient: 0.005, mieDirectionalG: 0.86,
    exposure: 0.55,
    sunColor: 0xffe2b0,
    fogColor: 0xd9e7ef, fogNear: 350, fogFar: 3200,
    ambientTop: 0xa8c4e0, ambientBot: 0x5d6274,
    cloudTint: 0xfff2e2, cloudOpacity: 0.85,
    waterDeep: 0x2f7a9e, waterShallow: 0x74c8dc, sparkle: 1.0,
  },
  noon: {
    label: 'Bright Noon',
    elevation: 55, azimuth: 190,
    turbidity: 4, rayleigh: 1.1, mieCoefficient: 0.004, mieDirectionalG: 0.8,
    exposure: 0.5,
    sunColor: 0xfff3da,
    fogColor: 0xcfe3ee, fogNear: 400, fogFar: 3400,
    ambientTop: 0xb0d0ea, ambientBot: 0x646a7c,
    cloudTint: 0xffffff, cloudOpacity: 0.9,
    waterDeep: 0x2b6f96, waterShallow: 0x6fc3d8, sparkle: 0.7,
  },
  dusk: {
    label: 'Rose Dusk',
    elevation: 6, azimuth: 250,
    turbidity: 9, rayleigh: 2.4, mieCoefficient: 0.008, mieDirectionalG: 0.88,
    exposure: 0.42,
    sunColor: 0xff9d6e,
    fogColor: 0xe8c8ae, fogNear: 220, fogFar: 2600,
    ambientTop: 0x8fa3cc, ambientBot: 0x544f63,
    cloudTint: 0xffd9c4, cloudOpacity: 0.8,
    waterDeep: 0x33517a, waterShallow: 0x7f9ec4, sparkle: 1.2,
  },
};

export function applyPreset(preset, { sky, sunSprite, directional, terrainMat, waterMat, clouds, renderer }) {
  const p = preset;
  const u = sky.material.uniforms;
  u.turbidity.value = p.turbidity;
  u.rayleigh.value = p.rayleigh;
  u.mieCoefficient.value = p.mieCoefficient;
  u.mieDirectionalG.value = p.mieDirectionalG;
  const phi = THREE.MathUtils.degToRad(90 - p.elevation);
  const theta = THREE.MathUtils.degToRad(p.azimuth);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  u.sunPosition.value.copy(sunDir);

  sunSprite.position.copy(sunDir).multiplyScalar(6000);
  directional.position.copy(sunDir).multiplyScalar(400);
  directional.color.set(p.sunColor);

  renderer.toneMappingExposure = p.exposure;

  if (terrainMat) {
    const tu = terrainMat.uniforms;
    tu.uSunDir.value.copy(sunDir).normalize();
    tu.uSunColor.value.set(p.sunColor);
    tu.uFogColor.value.set(p.fogColor);
    tu.uFogNear.value = p.fogNear;
    tu.uFogFar.value = p.fogFar;
    tu.uAmbientTop.value.set(p.ambientTop);
    tu.uAmbientBot.value.set(p.ambientBot);
  }
  if (waterMat) {
    const wu = waterMat.uniforms;
    wu.uSunDir.value.copy(sunDir).normalize();
    wu.uFogColor.value.set(p.fogColor);
    wu.uFogNear.value = p.fogNear;
    wu.uFogFar.value = p.fogFar;
    wu.uDeepColor.value.set(p.waterDeep);
    wu.uShallowColor.value.set(p.waterShallow);
    wu.uSparkle.value = p.sparkle;
  }
  if (clouds) clouds.setTint(p.cloudTint, p.cloudOpacity);
  return sunDir;
}
