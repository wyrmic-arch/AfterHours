// AFTERHOURS terrain field: analytic global height function + cached tile sampling.
// World layout (region "Vespera Vale", 4096 x 4096 units, sea level y = 0):
//   NORTH (+Z):  dramatic mountain range (Aubrien Peaks) with a glacial lake + pass
//   CENTER:      rolling meadow plains (Verdanne Fields) + river system -> waterfall
//   WEST:        dense old-growth forest hills (Elorwood)
//   SOUTH (-Z):  sandy coastline & shallow sea (Sunder Shore)
//   EAST:        terraced plateau + canyon rim (Cinder Terrace)

import { SimplexNoise2D, mulberry32, smoothstep, clamp, lerp, profileHeight } from './noise.js';

export const WORLD_SIZE = 4096;      // full logical continent extent
export const SEA_LEVEL = 0;
export const WATERLINE = -0.35;      // visual water surface

const nBase = new SimplexNoise2D(1337);
const nRidge = new SimplexNoise2D(4271);
const nDetail = new SimplexNoise2D(90210);
const nWarp = new SimplexNoise2D(555);
const nRiver = new SimplexNoise2D(7781);

const K = 1 / 900; // base noise frequency
export const FALLS_Z = -980;

// ---- Region masks (all continuous, blended) ----
function maskNorth(x, z) {
  // mountains rise toward +Z, with a wavy southern front
  const front = 300 + nWarp.fbm(x * 0.0009, z * 0.0009, 3) * 500;
  return smoothstep(front + 900, front, z); // 1 deep in range, 0 on the plains side
}
function maskWestForest(x, z) {
  const edge = -700 + nWarp.fbm(x * 0.0011 + 40, z * 0.0011, 3) * 350;
  return smoothstep(edge, edge + 700, -x);
}
function maskEastPlateau(x, z) {
  const edge = 950 + nWarp.fbm(x * 0.0011 - 40, z * 0.0011 + 20, 3) * 350;
  return smoothstep(edge, edge + 600, x);
}
function maskSouthCoast(x, z) {
  // 1 inland, 0 out at sea; wavy shoreline around z ~ -1650
  const shore = -1650 + nWarp.fbm(x * 0.0013 + 90, z * 0.0008, 3) * 420;
  return smoothstep(shore - 250, shore + 500, z);
}

// River spine: main river meanders from northern pass to southern delta.
export function riverCenterX(z) {
  return nRiver.fbm(z * 0.0007, 3.7, 3) * 620 + Math.sin(z * 0.0011) * 180;
}
// Western tributary: flows WSW from the confluence (riverCenterX(450), 450).
// xdist = distance west of the confluence (>= 0); returns channel center z.
export function tribZ(xdist) {
  const base = 450 - xdist * 0.30;
  return base + nRiver.fbm(xdist * 0.0011 + 40, 9.3, 3) * 150;
}
// Tributary water surface height at distance xdist upstream
export function tribSurface(xdist) {
  return 17 + xdist * 0.016; // rises gently toward western hills
}

function carve(valley, x, z, cx, width, depth) {
  const d = Math.abs(x - cx);
  if (d > width) return valley;
  const t = 1 - d / width;
  const s = t * t * (3 - 2 * t);
  return Math.max(valley, s * depth);
}

// Main analytic height function (meters above sea level).
export function terrainHeight(x, z) {
  // Domain-warped base rolling land
  const wx = x + nWarp.fbm(x * 0.0006, z * 0.0006, 3) * 260;
  const wz = z + nWarp.fbm(x * 0.0006 + 31, z * 0.0006 - 17, 3) * 260;
  const h01 = nBase.fbm(wx * K, wz * K, 5) * 0.5 + 0.5; // 0..1 gentle relief
  let land = -4 + Math.pow(h01, 1.4) * 48;              // plains ~4..30

  // --- North: ridged mountains (mask = 1 deep in range, fades to 0 at wavy front) ---
  const mN = maskNorth(x, z);
  if (mN > 0) {
    const ridge = nRidge.ridged(x * 0.0016, z * 0.0016, 5);
    const big = nRidge.ridged(x * 0.00062 + 11, z * 0.00062, 4);
    let mt = clamp(lerp(ridge, big, 0.55) * 1.15, 0, 1);
    mt = Math.pow(mt, 1.5);
    const peakH = 55 + mt * 300 * mN;               // tallest spires ~355 near range core
    const hf = 25 + mt * 90;                        // foothill floor for smooth fade-in
    const target = Math.max(peakH, hf);
    // glacial lake basin scoop (around lake center)
    const lx = x - riverCenterX(1150), lz = z - 1150;
    const basin = smoothstep(310, 130, Math.hypot(lx * 0.85, lz * 1.4));
    land = lerp(land, target, mN);
    if (basin > 0) land = lerp(land, Math.min(land, 14.5), basin); // bowl floor ~14.5 < surface 23.5
  }

  // --- West: forested hills (softer, bumpy) ---
  const mW = maskWestForest(x, z);
  if (mW > 0) {
    const hills = nBase.fbm(x * 0.0022 - 50, z * 0.0022, 4) * 0.5 + 0.5;
    const bumps = nDetail.fbm(x * 0.0075, z * 0.0075, 3) * 0.5 + 0.5;
    const hf = 16 + hills * 40 + bumps * 8;         // 16..64
    land = lerp(land, hf, mW * 0.85);
  }

  // --- East: stepped terrace plateau with canyon cut ---
  const mE = maskEastPlateau(x, z);
  if (mE > 0) {
    const steps = Math.floor(clamp((h01 * 100) / 24, 0, 5));
    let plat = 20 + steps * 22 + nDetail.fbm(x * 0.004, z * 0.004, 3) * 6; // 20..130
    const cd = Math.abs((z - x * 0.35) - 500);
    plat -= smoothstep(150, 45, cd) * 45;           // canyon
    land = lerp(land, plat, mE * 0.9);
  }

  // --- South: coastline falloff into sea ---
  const mS = maskSouthCoast(x, z);
  if (mS < 1) {
    const shoreProfile = lerp(-13, 5, smoothstep(-2200, -1450, z)); // seabed -> beach edge
    land = lerp(shoreProfile, Math.max(land, 3.5), mS);
  } else if (z < -1100) {
    const k = smoothstep(-1100, -1500, z);          // coastal plain sinks toward beach
    land = lerp(land, Math.max(land * 0.45, 3), k);
  }

  // Waterfall terrace: everything north of the falls line sits on a +14 ledge
  land += smoothstep(FALLS_Z - 7, FALLS_Z + 7, z) * 14;

  // --- Rivers carved after region shaping ---
  let floorTarget = Infinity;
  let cut = 0;
  const rz = z;
  if (rz < 1250 && rz > -1700) {
    const cx = riverCenterX(rz);
    const width = lerp(110, 60, smoothstep(-1500, 1200, rz));
    const d = Math.abs(x - cx);
    if (d < width) {
      const t = 1 - d / width;
      const w = t * t * (3 - 2 * t);
      if (w > cut) { cut = w; floorTarget = riverProfile(rz) - 2.5; }
      else floorTarget = Math.min(floorTarget, riverProfile(rz) - 2.5);
    }
  }
  {
    const confX = riverCenterX(450);
    const xd = confX - x;
    if (xd > -40 && xd < 1800) {
      const tz = tribZ(Math.max(0, xd));
      const width = 62;
      const d = Math.abs(z - tz);
      if (d < width) {
        const t = 1 - d / width;
        const w = t * t * (3 - 2 * t);
        const f = tribSurface(Math.max(0, xd)) - 2.2;
        if (w > cut) { cut = w; floorTarget = f; }
        else floorTarget = Math.min(floorTarget, f);
      }
    }
  }
  {
    const pd = Math.hypot(x - riverCenterX(FALLS_Z - 40), z - (FALLS_Z - 40));
    if (pd < 90) {
      floorTarget = Math.min(floorTarget, -3.5);
      cut = Math.max(cut, 0.6);
    }
  }
  if (cut > 0.05 && floorTarget < land) {
    land = lerp(land, floorTarget, smoothstep(0.05, 0.55, cut));
  }

  // Fine surface detail
  land += nDetail.fbm(x * 0.011, z * 0.011, 3) * 1.6 * smoothstep(-2, 8, land);

  return land;
}

// Longitudinal elevation of the main river channel (downhill north -> south)
export function riverProfile(z) {
  const stops = [
    { p: 1250, h: 22 },   // lake outlet (lake surface 23.5)
    { p: 700, h: 20 },
    { p: 0, h: 16 },      // confluence area
    { p: -500, h: 12 },
    { p: -940, h: 9 },    // brink (bed below terrace water)
    { p: -1000, h: -1 },  // plunge pool
    { p: -1400, h: -3 },
    { p: -1650, h: -5 },  // delta/marsh
    { p: -2000, h: -9 },
  ];
  return profileHeight(stops, clamp(z, -2000, 1250));
}

export const LAKE = { x: () => riverCenterX(1150), z: 1150, surface: 23.5, rx: 260, rz: 170 };

// ---- Tile cache for fast repeated sampling (used by meshing & scattering) ----
const TILE = 256;       // world units per tile
const TSAMP = 65;       // samples per tile edge (stride 4 units)
const tiles = new Map();

export function tileKey(tx, tz) { return tx * 100000 + tz; }

export function getTile(tx, tz) {
  const k = tileKey(tx, tz);
  let t = tiles.get(k);
  if (t) return t;
  const data = new Float32Array(TSAMP * TSAMP);
  const ox = tx * TILE, oz = tz * TILE;
  for (let i = 0; i < TSAMP; i++) {
    const z = oz + (i / (TSAMP - 1)) * TILE;
    for (let j = 0; j < TSAMP; j++) {
      const x = ox + (j / (TSAMP - 1)) * TILE;
      data[i * TSAMP + j] = terrainHeight(x, z);
    }
  }
  t = { data, ox, oz };
  tiles.set(k, t);
  if (tiles.size > 120) { // LRU-ish trim
    const first = tiles.keys().next().value;
    tiles.delete(first);
  }
  return t;
}

// Bilinear sample from cached tiles (fast path)
export function heightAt(x, z) {
  const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
  const fx = (x - tx * TILE) / TILE, fz = (z - tz * TILE) / TILE;
  // gather 2x2 corner tiles for seamless bilinear across borders
  const t00 = getTile(tx, tz), t10 = getTile(tx + 1, tz), t01 = getTile(tx, tz + 1), t11 = getTile(tx + 1, tz + 1);
  const S = TSAMP;
  const gx = fx * (S - 1), gz = fz * (S - 1);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const ax = gx - ix, az = gz - iz;
  const v00 = t00.data[iz * S + ix], v10 = t00.data[iz * S + ix + 1];
  // For points exactly on tile edge use neighbor origin to stay seamless
  const v01n = t01.data[0 * S + ix], v11n = t01.data[0 * S + ix + 1];
  const b0 = lerp(v00, v10, ax);
  const b1 = lerp(v01n, v11n, ax);
  void t10; void t11;
  return lerp(b0, b1, az);
}

export function normalAt(x, z, target) {
  const e = 2.0;
  const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
  const nx = hL - hR, ny = 2 * e, nz = hD - hU;
  const len = Math.hypot(nx, ny, nz);
  target.x = nx / len; target.y = ny / len; target.z = nz / len;
  return target;
}

export function slopeAt(x, z) {
  const n = { x: 0, y: 1, z: 0 };
  normalAt(x, z, n);
  return 1 - n.y; // 0 flat .. 1 vertical
}

// Biome weights for coloring & scattering -------------------------------------
export function biomeAt(x, z) {
  const h = heightAt(x, z);
  const sl = slopeAt(x, z);
  const inLake = ((x - LAKE.x()) ** 2) / (LAKE.rx * LAKE.rx) + ((z - LAKE.z) ** 2) / (LAKE.rz * LAKE.rz) < 1 && h < LAKE.surface + 1.5;
  const underwater = h < WATERLINE && !inLake;
  const nearRiver = Math.abs(x - riverCenterX(clamp(z, -2000, 1300))) < 46 && z < 1300 && z > -1600 && h < riverProfile(z) + 5;
  return { h, sl, inLake, underwater, nearRiver };
}
