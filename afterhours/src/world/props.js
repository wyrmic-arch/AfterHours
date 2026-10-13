// Procedural low-poly anime vegetation & rock assets + GPU-instanced scatterer.
// All props are generated meshes (CC0 by construction), merged into a handful of
// InstancedMesh draw calls, chunked around the player with lazy builds.

import * as THREE from 'three';
import { mulberry32, SimplexNoise2D, smoothstep } from './noise.js';
import { heightAt, slopeAt, riverCenterX, LAKE, WATERLINE } from './terrainField.js';

const nForest = new SimplexNoise2D(2468);
const nMeadow = new SimplexNoise2D(1357);

// ---------------------------------------------------------------------------
// Asset builders (low-poly, flat-shaded)
// ---------------------------------------------------------------------------

function leafCluster(radius, color, rand, squash = 1) {
  const geo = new THREE.IcosahedronGeometry(radius, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) * (0.85 + rand() * 0.3),
      p.getY(i) * (0.75 + rand() * 0.3) * squash,
      p.getZ(i) * (0.85 + rand() * 0.3));
  }
  geo.translate(0, radius * 0.9, 0);
  geo.deleteAttribute('uv');
  return tintFlat(geo, color);
}

function tintFlat(geo, colors) {
  // per-face vertex colors for flat cel look
  const g = geo.toNonIndexed();
  const count = g.attributes.position.count;
  const colArr = new Float32Array(count * 3);
  for (let f = 0; f < count; f += 3) {
    const c = colors[Math.floor(Math.random() * colors.length)];
    for (let k = 0; k < 3; k++) {
      colArr[(f + k) * 3] = c.r; colArr[(f + k) * 3 + 1] = c.g; colArr[(f + k) * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  g.computeVertexNormals();
  return g;
}

export function buildAssets() {
  const rand = mulberry32(9001);
  const assets = {};

  const C = (hex) => new THREE.Color(hex);

  // -- Oak-style round-canopy tree (spring green) --
  {
    const trunk = new THREE.CylinderGeometry(0.5, 0.85, 6, 6, 1);
    trunk.translate(0, 3, 0);
    const tCol = tintFlat(trunk.toNonIndexed(), [C(0x6e4a33), C(0x7d5a3f)]);
    const parts = [tCol];
    const greens = [C(0x5f9e3f), C(0x6fb54a), C(0x529038)];
    const blobs = [[0, 7.6, 0, 3.6], [2.2, 6.6, 1.2, 2.6], [-2.0, 6.9, -1.1, 2.8], [0.6, 9.4, -0.8, 2.4]];
    for (const [bx, by, bz, r] of blobs) {
      const g = leafCluster(r, greens, rand);
      g.translate(bx, by, bz);
      parts.push(g);
    }
    assets.oak = mergeGeos(parts);
  }

  // -- Sakura cherry tree (pink canopy, wider) --
  {
    const trunk = new THREE.CylinderGeometry(0.45, 0.9, 5.2, 6, 1);
    trunk.translate(0, 2.6, 0);
    const lean = new THREE.CylinderGeometry(0.3, 0.45, 3.4, 5, 1);
    lean.rotateZ(0.5); lean.translate(1.2, 5.6, 0);
    const parts = [
      tintFlat(trunk.toNonIndexed(), [C(0x5a3d2e), C(0x6b4a38)]),
      tintFlat(lean.toNonIndexed(), [C(0x5a3d2e)]),
    ];
    const pinks = [C(0xf6c1d3), C(0xf3adc4), C(0xfad7e2)];
    const blobs = [[-1.4, 6.8, 0.4, 3.4], [2.6, 6.2, -0.6, 2.8], [0.4, 8.6, -0.2, 2.6], [-2.6, 5.4, -1.4, 2.2]];
    for (const [bx, by, bz, r] of blobs) {
      const g = leafCluster(r, pinks, rand, 0.75);
      g.translate(bx, by, bz);
      parts.push(g);
    }
    assets.sakura = mergeGeos(parts);
  }

  // -- Pine conifer (dark teal-green tiers) --
  {
    const trunk = new THREE.CylinderGeometry(0.35, 0.7, 4, 6, 1);
    trunk.translate(0, 2, 0);
    const parts = [tintFlat(trunk.toNonIndexed(), [C(0x4f3a2a)])];
    const darks = [C(0x2f6b46), C(0x387950), C(0x275a3c)];
    const tiers = [[0, 4.2, 3.4, 3.4], [0, 6.6, 2.6, 2.9], [0, 8.8, 1.8, 2.3]];
    for (const [bx, by, r, hh] of tiers) {
      const cone = new THREE.ConeGeometry(r, hh * 2, 7, 1);
      cone.translate(bx, by, 0);
      parts.push(tintFlat(cone.toNonIndexed(), darks));
    }
    assets.pine = mergeGeos(parts);
  }

  // -- Tall grass tuft (crossed blades) --
  {
    const parts = [];
    const gc = [C(0x6da544), C(0x7cb452), C(0x5f9440)];
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.PlaneGeometry(2.6, 3.2, 1, 3);
      const p = blade.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const bend = Math.max(0, (y + 1.6)) * 0.45;
        p.setX(i, p.getX(i) + bend * (b % 2 ? 1 : -1) * 0.6);
        p.setY(i, y * 1.05);
      }
      blade.translate(0, 1.5, 0);
      blade.rotateY((b / 3) * Math.PI + rand() * 0.4);
      parts.push(tintFlat(blade.toNonIndexed(), gc));
    }
    assets.grassTuft = mergeGeos(parts);
  }

  // -- Flower cluster (tiny stems + colored heads) --
  {
    const parts = [];
    const stemG = new THREE.CylinderGeometry(0.05, 0.07, 1.0, 4, 1);
    stemG.translate(0, 0.5, 0);
    const stemC = tintFlat(stemG.toNonIndexed(), [C(0x4e8a3a)]);
    const flowerCols = [C(0xf2f2f7), C(0xffe066), C(0xef7fa5), C(0x9ecbff)];
    for (let k = 0; k < 5; k++) {
      const s = stemC.clone();
      s.rotateZ((rand() - 0.5) * 0.5);
      s.rotateX((rand() - 0.5) * 0.5);
      s.translate((rand() - 0.5) * 1.2, 0, (rand() - 0.5) * 1.2);
      parts.push(s);
      const head = new THREE.IcosahedronGeometry(0.22, 0);
      head.translate((rand() - 0.5) * 1.2, 1.05 + rand() * 0.2, (rand() - 0.5) * 1.2);
      parts.push(tintFlat(head.toNonIndexed(), [flowerCols[k % 4]]));
    }
    assets.flowers = mergeGeos(parts);
  }

  // -- Rocks (two sizes, faceted grey) --
  {
    const mk = (r, seed) => {
      const rr = mulberry32(seed);
      const g = new THREE.DodecahedronGeometry(r, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i, p.getX(i) * (0.7 + rr() * 0.5), Math.abs(p.getY(i)) * (0.5 + rr() * 0.4) - r * 0.15, p.getZ(i) * (0.7 + rr() * 0.5));
      }
      g.computeVertexNormals();
      return tintFlat(g.toNonIndexed(), [C(0x8b8b93), C(0x7a7a84), C(0x9aa0a8)]);
    };
    assets.rockSmall = mk(1.1, 77);
    assets.rockLarge = mk(3.2, 91);
  }

  // -- Reeds for riverside/delta --
  {
    const parts = [];
    const rc = [C(0x8aa05a), C(0x77955a)];
    for (let b = 0; b < 5; b++) {
      const blade = new THREE.PlaneGeometry(0.35, 3.4, 1, 2);
      const p = blade.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 1) p.setX(i, p.getX(i) + 0.5);
      }
      blade.translate(0, 1.7, 0);
      blade.rotateY(rand() * Math.PI);
      parts.push(tintFlat(blade.toNonIndexed(), rc));
    }
    assets.reeds = mergeGeos(parts);
  }

  return assets;
}

function mergeGeos(list) {
  let vTotal = 0, iTotal = 0;
  const nonIndexed = list.map(g => {
    const gg = g.index ? g.toNonIndexed() : g;
    if (!gg.attributes.color) {
      const c = new Float32Array(gg.attributes.position.count * 3).fill(1);
      gg.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    vTotal += gg.attributes.position.count;
    return gg;
  });
  const pos = new Float32Array(vTotal * 3);
  const nor = new Float32Array(vTotal * 3);
  const col = new Float32Array(vTotal * 3);
  let off = 0;
  for (const g of nonIndexed) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    col.set(g.attributes.color.array, off * 3);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------
// Scatter rules
// ---------------------------------------------------------------------------

function forestWeight(x, z) {
  const w = nForest.fbm(x * 0.0016 - 50, z * 0.0016, 4) * 0.5 + 0.5;
  const westBias = smoothstep(-2000, -900, x) * 0.9;
  return w * (0.25 + westBias);
}

// returns array of {type, x, z, y, scale, rot, tint?} inside chunk rect
export function scatterChunk(cx, cz, size = 256) {
  const ox = cx * size, oz = cz * size;
  const rand = mulberry32(((cx * 73856093) ^ (cz * 19349663)) >>> 0);
  const items = [];
  const density = 150; // candidate points per chunk
  for (let i = 0; i < density; i++) {
    const x = ox + rand() * size;
    const z = oz + rand() * size;
    const h = heightAt(x, z);
    if (h < WATERLINE + 0.6) continue;
    const sl = slopeAt(x, z);
    const fw = forestWeight(x, z);
    const meadowN = nMeadow.fbm(x * 0.003, z * 0.003, 3) * 0.5 + 0.5;
    const nearRiver = Math.abs(x - riverCenterX(Math.max(-1600, Math.min(1300, z)))) < 120 && z < 1300 && z > -1500;
    const lakeDist = Math.hypot((x - LAKE.x()) / 1.6, z - LAKE.z);

    // trees in mountains valleys too (sparse pines)
    const mountainTrees = h > 60 && h < 210 && sl < 0.35 ? 0.35 : 0;
    const r = rand();
    let type = null;
    if (h < 3 && nearRiver) type = r < 0.5 ? 'reeds' : null;
    else if (sl > 0.42) type = r < 0.25 ? 'rockSmall' : null;
    else if (fw > 0.55 && h < 120) {
      type = r < 0.5 ? 'oak' : (r < 0.72 ? 'pine' : (r < 0.85 ? 'sakura' : (r < 0.93 ? 'grassTuft' : 'flowers')));
    } else if (fw > 0.4 && h < 140) {
      type = r < 0.3 ? 'oak' : (r < 0.45 ? 'pine' : (r < 0.55 ? 'rockSmall' : (r < 0.8 ? 'grassTuft' : 'flowers')));
    } else if (mountainTrees > 0 && r < mountainTrees) {
      type = r < mountainTrees * 0.7 ? 'pine' : 'rockSmall';
    } else if (h < 90 && sl < 0.22) {
      type = r < 0.55 ? 'grassTuft' : (r < 0.72 ? 'flowers' : (r < 0.78 ? 'rockSmall' : (r < 0.82 && meadowN > 0.6 ? 'sakura' : null)));
    }
    if (!type) continue;
    if (lakeDist < 300 && (type === 'oak' || type === 'flowers') && rand() < 0.6) type = 'reeds';

    let scale = 1, tint = null;
    switch (type) {
      case 'oak': scale = 0.8 + rand() * 0.7; break;
      case 'sakura': scale = 0.85 + rand() * 0.6; break;
      case 'pine': scale = 0.75 + rand() * 0.9; break;
      case 'grassTuft': scale = 0.7 + rand() * 0.9; break;
      case 'flowers': scale = 0.8 + rand() * 0.7; break;
      case 'rockSmall': scale = 0.6 + rand() * 1.1; break;
      case 'rockLarge': scale = 0.8 + rand() * 1.4; break;
      case 'reeds': scale = 0.8 + rand() * 0.8; break;
    }
    items.push({ type, x, z, y: h - (type === 'rockSmall' ? 0.35 : 0.12), scale, rot: rand() * Math.PI * 2 });
  }
  // occasional large rocks
  const bigRocks = 2;
  for (let i = 0; i < bigRocks; i++) {
    const x = ox + rand() * size, z = oz + rand() * size;
    const h = heightAt(x, z);
    if (h > 1 && slopeAt(x, z) > 0.25) {
      items.push({ type: 'rockLarge', x, z, y: h - 0.8, scale: 0.8 + rand() * 1.2, rot: rand() * Math.PI * 2 });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Prop system: one InstancedMesh per prop-type per chunk-ring managed lazily
// ---------------------------------------------------------------------------

const PROP_BUDGET_PER_CHUNK = { oak: 90, pine: 70, sakura: 40, grassTuft: 110, flowers: 60, rockSmall: 25, rockLarge: 8, reeds: 40 };

export class PropSystem {
  constructor(scene, quality) {
    this.scene = scene;
    this.assets = buildAssets();
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: false,
      side: THREE.FrontSide,
    });
    this.addWindWobble(this.material);
    this.timeUniform = { value: 0 };
    this.meshes = new Map(); // `${chunk},${type}` -> InstancedMesh
    this.chunkKeys = new Set();
    this.densityScale = quality.propDensity;
  }

  addWindWobble(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.timeUniform;
      shader.vertexShader = `
        uniform float uTime;
        attribute float aSway;
        attribute float aPhase;
      ` + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float ph = aPhase + gl_InstanceID * 0.37;
         #else
           float ph = aPhase;
         #endif
         float sway = aSway * (0.12 + 0.10 * sin(uTime * 1.4 + ph) + 0.05 * sin(uTime * 3.1 + ph * 1.7));
         transformed.x += sway * max(transformed.y, 0.0) * 0.12;
         transformed.z += sway * max(transformed.y, 0.0) * 0.08;`
      );
    };
  }

  setQuality(q) { this.densityScale = q.propDensity; }

  update(px, pz, renderDistChunks) {
    const ccx = Math.floor(px / 256), ccz = Math.floor(pz / 256);
    const want = new Set();
    const propDist = Math.min(renderDistChunks, 3); // props only near player
    for (let dz = -propDist; dz <= propDist; dz++) {
      for (let dx = -propDist; dx <= propDist; dx++) {
        const r = Math.max(Math.abs(dx), Math.abs(dz));
        if (r > propDist) continue;
        const cx = ccx + dx, cz = ccz + dz;
        if (cx < -9 || cx > 8 || cz < -9 || cz > 8) continue;
        want.add(`${cx},${cz}`);
      }
    }
    // dispose chunks out of range
    for (const key of [...this.chunkKeys]) {
      if (!want.has(key)) {
        for (const [mk, mesh] of this.meshes) {
          if (mk.startsWith(key + '|')) {
            this.scene.remove(mesh);
            mesh.dispose();
            this.meshes.delete(mk);
          }
        }
        this.chunkKeys.delete(key);
      }
    }
    // build missing (budgeted)
    let budget = 3;
    for (const key of want) {
      if (this.chunkKeys.has(key)) continue;
      if (budget-- <= 0) continue;
      this.buildChunk(key.split(',').map(Number));
      this.chunkKeys.add(key);
    }
  }

  buildChunk([cx, cz]) {
    const items = scatterChunk(cx, cz);
    const byType = new Map();
    for (const it of items) {
      if (!byType.has(it.type)) byType.set(it.type, []);
      const arr = byType.get(it.type);
      const cap = Math.ceil(PROP_BUDGET_PER_CHUNK[it.type] * this.densityScale);
      if (arr.length < cap) arr.push(it);
    }
    const dummy = new THREE.Object3D();
    for (const [type, list] of byType) {
      const geo = this.assets[type].clone();
      const n = list.length;
      const sway = new Float32Array(n);
      const phase = new Float32Array(n);
      const inst = new THREE.InstancedMesh(geo, this.material, n);
      list.forEach((it, i) => {
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(0, it.rot, 0);
        dummy.scale.setScalar(it.scale);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        sway[i] = (type === 'grassTuft' || type === 'flowers' || type === 'reeds') ? 1.6 :
                  (type === 'oak' || type === 'sakura' || type === 'pine') ? 0.5 : 0.0;
        phase[i] = it.x * 0.12 + it.z * 0.17;
      });
      geo.setAttribute('aSway', new THREE.InstancedBufferAttribute(sway, 1));
      geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = true;
      inst.castShadow = false; // stylized look doesn't need prop shadows on low-end
      geo.computeBoundingSphere();
      if (geo.boundingSphere) {
        geo.boundingSphere.radius = Math.max(geo.boundingSphere.radius, 260 * 1.45); // whole chunk footprint
        geo.boundingSphere.center.set(cx * 256 + 128, 60, cz * 256 + 128);
      }
      this.scene.add(inst);
      this.meshes.set(`${cx},${cz}|${type}`, inst);
    }
  }

  get drawCalls() { return this.meshes.size; }
}
