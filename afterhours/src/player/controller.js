// First-person explorer controller with terrain collision.
// Pointer-lock mouse look + WASD, sprint, jump, gravity, slope-aware grounding,
// water buoyancy, and a free-fly debug camera (V key).

import * as THREE from 'three';
import { heightAt, WATERLINE } from '../world/terrainField.js';

const EYE = 1.7;
const WALK = 10;
const SPRINT = 19;
const JUMP_V = 9.2;
const GRAVITY = 24;
const FLY_SPEED = 60;

export class PlayerController {
  constructor(camera, domElement, quality) {
    this.camera = camera;
    this.dom = domElement;
    this.enabled = true;
    this.flyMode = false;

    this.position = new THREE.Vector3(0, 40, 0);
    this.velocityY = 0;
    this.grounded = false;
    this.yaw = Math.PI; // face south-ish initially
    this.pitch = -0.08;
    this.keys = {};
    this.sensitivity = 0.0022;
    this.locked = false;

    // spawn: riverbank overlook near the waterfall — cinematic first view
    this.spawn = { x: 120, z: -780 };
    const h = heightAt(this.spawn.x, this.spawn.z);
    this.position.set(this.spawn.x, h + EYE + 0.2, this.spawn.z);

    this._onKeyDown = (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyV') this.flyMode = !this.flyMode;
    };
    this._onKeyUp = (e) => { this.keys[e.code] = false; };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);

    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  lock() { this.dom.requestPointerLock(); }

  update(dt) {
    const k = this.keys;
    let fwd = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    let str = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const sprint = k.ShiftLeft || k.ShiftRight;

    const dirF = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const dirR = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.flyMode) {
      const speed = FLY_SPEED * (sprint ? 2.4 : 1);
      const up = (k.Space ? 1 : 0) - (k.KeyC ? 1 : 0);
      this.position.addScaledVector(dirF, fwd * speed * dt);
      this.position.addScaledVector(dirR, str * speed * dt);
      this.position.y += up * speed * dt;
    } else {
      const inWater = this.position.y - EYE < WATERLINE + 0.4;
      const speed = (inWater ? WALK * 0.55 : sprint ? SPRINT : WALK);
      let mx = dirF.x * fwd + dirR.x * str;
      let mz = dirF.z * fwd + dirR.z * str;
      const ml = Math.hypot(mx, mz);
      if (ml > 0.001) { mx /= ml; mz /= ml; }
      const nx = this.position.x + mx * speed * dt;
      const nz = this.position.z + mz * speed * dt;

      // simple slope limit: don't climb walls steeper than ~55 deg
      const gh = heightAt(nx, nz);
      const curG = heightAt(this.position.x, this.position.z);
      const dy = gh - curG;
      const allowStep = dy <= speed * dt * 1.35 + 0.6;
      if (allowStep) { this.position.x = nx; this.position.z = nz; }

      // vertical motion
      const groundY = heightAt(this.position.x, this.position.z) + EYE;
      const buoyantFloor = Math.max(groundY, WATERLINE + EYE * 0.55);
      if (k.Space && (this.grounded || inWater)) {
        this.velocityY = inWater ? 5.2 : JUMP_V;
        this.grounded = false;
      }
      this.velocityY -= GRAVITY * (inWater ? 0.25 : 1) * dt;
      this.position.y += this.velocityY * dt;
      if (this.position.y <= buoyantFloor) {
        this.position.y = buoyantFloor;
        this.velocityY = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
    }

    // keep inside continent bounds
    this.position.x = Math.max(-2000, Math.min(2000, this.position.x));
    this.position.z = Math.max(-2000, Math.min(2000, this.position.z));

    this.euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this.euler);
    this.camera.position.copy(this.position);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
