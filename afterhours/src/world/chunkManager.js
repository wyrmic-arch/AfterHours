// Chunked terrain manager: 256-unit chunks, LOD rings around the player.
// LOD0 (4u grid) near, LOD1 (8u) mid, LOD2 (16u) far. Skirt meshes hide seams.

import * as THREE from 'three';
import { heightAt } from './terrainField.js';
import { createTerrainMaterial, terrainColor } from './terrainMaterial.js';

export const CHUNK = 256;

const LODS = [
  { step: 4, segs: 64 },   // LOD0
  { step: 8, segs: 32 },   // LOD1
  { step: 16, segs: 16 },  // LOD2
];

const NEAR = 1;   // rings: LOD0 within 1 chunk, LOD1 within 3, LOD2 within 5
const MID = 3;
const FAR = 5;

function buildChunkGeometry(cx, cz, lod) {
  const { step, segs } = LODS[lod];
  const size = CHUNK;
  const geo = new THREE.BufferGeometry();
  const vCount = (segs + 1) * (segs + 1);
  const positions = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const indices = new Uint32Array(segs * segs * 6);

  const ox = cx * CHUNK, oz = cz * CHUNK;
  const col = [0, 0, 0];
  let vi = 0;
  for (let iz = 0; iz <= segs; iz++) {
    for (let ix = 0; ix <= segs; ix++) {
      const x = ox + ix * step;
      const z = oz + iz * step;
      const y = heightAt(x, z);
      positions[vi * 3] = x - ox;
      positions[vi * 3 + 1] = y;
      positions[vi * 3 + 2] = z - oz;
      terrainColor(x, z, y, col);
      colors[vi * 3] = col[0]; colors[vi * 3 + 1] = col[1]; colors[vi * 3 + 2] = col[2];
      vi++;
    }
  }
  let ii = 0;
  for (let iz = 0; iz < segs; iz++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iz * (segs + 1) + ix;
      const b = a + 1;
      const c = a + (segs + 1);
      const d = c + 1;
      indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
      indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal');
  normals.set(nrm.array);
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

  // skirts to hide LOD cracks: duplicate border vertices dropped by step*1.5
  addSkirts(geo, ox, oz, size, step);
  return geo;
}

function addSkirts(geo, ox, oz, size, step) {
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('aColor');
  const idx = geo.getIndex();
  const segs = Math.round(size / step);
  const extra = [];
  const drop = step * 1.5;
  const pushEdge = (i, dx, dz) => {
    const x = pos.getX(i), y = pos.getY(i) - drop, z = pos.getZ(i);
    extra.push({ base: i, vert: [x + dx, y, z + dz], color: [col.getX(i), col.getY(i), col.getZ(i)] });
  };
  // top edge (iz=0) & bottom edge (iz=segs), left/right borders
  for (let ix = 0; ix <= segs; ix++) {
    pushEdge(ix, 0, -drop);                       // north border -> skirt outward (-z)
    pushEdge(segs * (segs + 1) + ix, 0, drop);    // south border
  }
  for (let iz = 0; iz <= segs; iz++) {
    pushEdge(iz * (segs + 1), -drop, 0);
    pushEdge(iz * (segs + 1) + segs, drop, 0);
  }
  const baseCount = pos.count;
  const newVerts = extra.length;
  const newPos = new Float32Array((baseCount + newVerts) * 3);
  const newCol = new Float32Array((baseCount + newVerts) * 3);
  newPos.set(pos.array); newCol.set(col.array);
  extra.forEach((e, k) => {
    const t = baseCount + k;
    newPos[t * 3] = e.vert[0]; newPos[t * 3 + 1] = e.vert[1]; newPos[t * 3 + 2] = e.vert[2];
    newCol[t * 3] = e.color[0]; newCol[t * 3 + 1] = e.color[1]; newCol[t * 3 + 2] = e.color[2];
  });
  const oldIdx = idx.array;
  const newIdx = new Uint32Array(oldIdx.length + extra.length * 6);
  newIdx.set(oldIdx);
  let w = oldIdx.length;
  // connect each border vertex i with its skirt twin: quads between consecutive pairs
  const ringStep = segs + 1;
  const skirtStart = (i) => baseCount + indexOfBorder(i, segs);
  function indexOfBorder(i, segs) {
    // order matches pushEdge traversal
    const s = segs + 1;
    if (i < s) return i;                             // top row
    if (i >= segs * s && i < (segs + 1) * s) return s + (i - segs * s); // bottom row
    if (i % s === 0 && i < segs * s) return 2 * s + (i / s);            // left col
    if (i % s === segs && i < segs * s) return 3 * s + ((i - segs) / s); // right col
    return -1;
  }
  const connect = (a, b) => { // quad a,b border and their skirts
    const sa = skirtStart(a), sb = skirtStart(b);
    if (sa < 0 || sb < 0) return;
    newIdx[w++] = a; newIdx[w++] = sa; newIdx[w++] = b;
    newIdx[w++] = b; newIdx[w++] = sa; newIdx[w++] = sb;
  };
  for (let ix = 0; ix < segs; ix++) {
    connect(ix, ix + 1);                                       // top
    connect(segs * ringStep + ix, segs * ringStep + ix + 1);   // bottom
    connect(ix * ringStep, (ix + 1) * ringStep);               // left
    connect(ix * ringStep + segs, (ix + 1) * ringStep + segs); // right
  }
  geo.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(newCol, 3));
  geo.setIndex(new THREE.BufferAttribute(newIdx, 1));
  // recompute normals including skirts
  geo.computeVertexNormals();
  const nrm = new Float32Array(newPos.length);
  nrm.set(geo.getAttribute('normal').array);
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
}

export class TerrainSystem {
  constructor(scene) {
    this.scene = scene;
    this.material = createTerrainMaterial();
    this.chunks = new Map(); // key -> { mesh, lod }
    this.lastKey = '';
    this.geoCache = new Map(); // "cx,cz,lod" -> geometry (reused across sessions)
  }

  setSun(dir, color, fogColor, ambientTop, ambientBot) {
    const u = this.material.uniforms;
    u.uSunDir.value.copy(dir).normalize();
    u.uSunColor.value.set(color);
    u.uFogColor.value.set(fogColor);
    u.uAmbientTop.value.set(ambientTop);
    u.uAmbientBot.value.set(ambientBot);
  }

  setQuality(q) {
    this.material.uniforms.uCelRamp.value = q.celRamp;
    this.material.uniforms.uFogFar.value = q.fogFar;
    this.material.uniforms.uFogNear.value = q.fogNear;
    this.renderDist = q.renderDist;
  }

  update(px, pz) {
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    const dist = this.renderDist || 5;
    const want = new Map();
    for (let dz = -dist; dz <= dist; dz++) {
      for (let dx = -dist; dx <= dist; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        const r = Math.max(Math.abs(dx), Math.abs(dz));
        if (r > dist) continue;
        // clamp to playable continent area
        if (cx < -9 || cx > 8 || cz < -9 || cz > 8) continue;
        const lod = r <= NEAR ? 0 : (r <= MID ? 1 : 2);
        want.set(`${cx},${cz}`, lod);
      }
    }
    // remove stale
    for (const [key, rec] of this.chunks) {
      const w = want.get(key);
      if (w === undefined || w !== rec.lod) {
        this.scene.remove(rec.mesh);
        // geometry cached; do not dispose
        this.chunks.delete(key);
      }
    }
    // add new
    let budget = 6; // per frame build budget
    for (const [key, lod] of want) {
      if (this.chunks.has(key)) continue;
      if (budget-- <= 0) break;
      const [cx, cz] = key.split(',').map(Number);
      const gk = `${cx},${cz},${lod}`;
      let geo = this.geoCache.get(gk);
      if (!geo) {
        geo = buildChunkGeometry(cx, cz, lod);
        this.geoCache.set(gk, geo);
        if (this.geoCache.size > 140) {
          const first = this.geoCache.keys().next().value;
          this.geoCache.delete(first);
        }
      }
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.set(cx * CHUNK, 0, cz * CHUNK);
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.scene.add(mesh);
      this.chunks.set(key, { mesh, lod });
    }
  }

  get chunkCount() { return this.chunks.size; }
}
