// AFTERHOURS — Vespera Vale. Main entry: renderer, scene assembly, game loop.

import * as THREE from 'three';
import { TerrainSystem } from './world/chunkManager.js';
import { PropSystem } from './world/props.js';
import { WaterSystem } from './world/water.js';
import { createSky, createClouds, TIME_PRESETS, applyPreset } from './world/skybox.js';
import { PlayerController } from './player/controller.js';
import { createHUD } from './ui/hud.js';

const QUALITY = {
  low:    { pixelRatio: 0.75, renderDist: 3, propDensity: 0.45, celRamp: 0.6, fogNear: 250, fogFar: 1900, shadows: false },
  medium: { pixelRatio: 1.0,  renderDist: 5, propDensity: 0.8,  celRamp: 0.75, fogNear: 350, fogFar: 2800, shadows: false },
  high:   { pixelRatio: 1.5,  renderDist: 7, propDensity: 1.0,  celRamp: 0.85, fogNear: 420, fogFar: 3400, shadows: false },
};

class Game {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 6000);

    // lights (props use Lambert which needs lights; terrain uses its own shader)
    this.dirLight = new THREE.DirectionalLight(0xffe2b0, 2.2);
    this.scene.add(this.dirLight);
    this.hemi = new THREE.HemisphereLight(0xa8c4e0, 0x5d6274, 1.1);
    this.scene.add(this.hemi);

    const qualityName = guessQuality();
    this.quality = QUALITY[qualityName];
    this.applyPixelRatio();

    this.terrain = new TerrainSystem(this.scene);
    this.terrain.setQuality(this.quality);
    this.props = new PropSystem(this.scene, this.quality);
    this.water = new WaterSystem(this.scene);
    const { sky, sunSprite } = createSky(this.scene);
    this.sky = sky; this.sunSprite = sunSprite;
    this.clouds = createClouds(this.scene);

    this.player = new PlayerController(this.camera, this.renderer.domElement, this.quality);

    this.hud = createHUD({
      onQualityChange: (name, renderDistOverride) => {
        if (name && QUALITY[name]) {
          this.quality = QUALITY[name];
          this.applyPixelRatio();
          this.terrain.setQuality(this.quality);
          this.props.setQuality(this.quality);
        }
        if (renderDistOverride !== undefined && renderDistOverride !== null) {
          this.quality = { ...this.quality, renderDist: renderDistOverride };
          this.terrain.setQuality(this.quality);
        }
      },
      onTimeChange: (name) => this.setTime(name),
    });
    this.setTime('golden');

    this.hud.onStart(() => {
      this.hud.hideStart();
      this.player.lock();
      setTimeout(() => this.hud.fadeHint(), 9000);
    });
    this.renderer.domElement.addEventListener('click', () => {
      if (!this.hudStartedShown()) this.player.lock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.hud.showCrosshair(document.pointerLockElement === this.renderer.domElement);
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.clock = new THREE.Clock();
    this.frames = 0; this.fpsTime = 0; this.fps = 0;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  hudStartedShown() { return document.getElementById('ah-start')?.style.display !== 'none'; }

  applyPixelRatio() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
  }

  setTime(name) {
    this.timeName = name;
    const preset = TIME_PRESETS[name] || TIME_PRESETS.golden;
    applyPreset(preset, {
      sky: this.sky,
      sunSprite: this.sunSprite,
      directional: this.dirLight,
      terrainMat: this.terrain.material,
      waterMat: this.water.material,
      clouds: this.clouds,
      renderer: this.renderer,
    });
    this.hemi.color.set(preset.ambientTop);
    this.hemi.groundColor.set(preset.ambientBot);
  }

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    this.player.update(dt);
    const px = this.player.position.x, pz = this.player.position.z;

    this.terrain.update(px, pz);
    this.props.timeUniform.value += dt;
    this.props.update(px, pz, this.quality.renderDist);
    this.water.update(dt, px, pz);
    this.clouds.update(dt, px, pz);

    // fps
    this.frames++; this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTime);
      this.frames = 0; this.fpsTime = 0;
      const info = this.renderer.info;
      this.hud.setStats(
        `${this.fps} fps · ${info.render.calls} draw calls · ${(info.render.triangles / 1000).toFixed(0)}k tris\n` +
        `chunks ${this.terrain.chunkCount} · prop meshes ${this.props.drawCalls}\n` +
        `pos ${px.toFixed(0)}, ${this.player.position.y.toFixed(0)}, ${pz.toFixed(0)} · biome ${regionName(px, pz)}`
      );
    }
    this.hud.setCompass(this.player.yaw);

    this.renderer.render(this.scene, this.camera);
  }
}

function regionName(x, z) {
  if (z > 700) return 'Aubrien Peaks';
  if (x < -900) return 'Elorwood';
  if (x > 1100) return 'Cinder Terrace';
  if (z < -1400) return 'Sunder Shore';
  return 'Verdanne Fields';
}

function guessQuality() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (mem <= 4 || cores <= 4) return 'low';
  if (mem >= 8 && cores >= 8) return 'high';
  return 'medium';
}

new Game();
