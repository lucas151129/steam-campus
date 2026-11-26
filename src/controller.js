import * as THREE from '../vendor/three.module.js?v=202611261812';

const STEP = Math.PI / 4;

export class Controller {
  constructor(x = 0, z = 0, yaw = 0) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = yaw;
    this.targetYaw = yaw;
    this.speed = 0;
    this.maxSpeed = 3.4;
    this.radius = 0.38;
    this._fwd = new THREE.Vector3();
  }

  turnLeft() {
    this.targetYaw += STEP;
  }

  turnRight() {
    this.targetYaw -= STEP;
  }

  face(yaw) {
    this.yaw = yaw;
    this.targetYaw = yaw;
    this.speed = 0;
  }

  forward(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  update(dt, wish, colliders, bounds) {
    const k = 1 - Math.exp(-11 * dt);
    this.yaw += (this.targetYaw - this.yaw) * k;

    const want = wish * this.maxSpeed;
    this.speed += (want - this.speed) * (1 - Math.exp(-9 * dt));

    if (Math.abs(this.speed) > 0.02) {
      this.forward(this._fwd).multiplyScalar(this.speed * dt);
      this.move(this._fwd.x, this._fwd.z, colliders);
    }
    this.clamp(bounds);
  }

  move(dx, dz, colliders) {
    const x = this.pos.x + dx;
    if (!this.blocked(x, this.pos.z, colliders)) this.pos.x = x;

    const z = this.pos.z + dz;
    if (!this.blocked(this.pos.x, z, colliders)) this.pos.z = z;
  }

  blocked(x, z, colliders) {
    if (!colliders) return false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const rr = c.r + this.radius;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  clamp(bounds) {
    if (!bounds) return;
    if (bounds.type === 'circle') {
      const r = bounds.r - this.radius;
      const d = Math.hypot(this.pos.x, this.pos.z);
      if (d > r && d > 0.0001) {
        const s = r / d;
        this.pos.x *= s;
        this.pos.z *= s;
      }
    } else {
      this.pos.x = Math.min(bounds.maxX - this.radius, Math.max(bounds.minX + this.radius, this.pos.x));
      this.pos.z = Math.min(bounds.maxZ - this.radius, Math.max(bounds.minZ + this.radius, this.pos.z));
    }
  }
}
