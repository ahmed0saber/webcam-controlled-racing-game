export const LANES = [-0.7, 0, 0.7];
export const PLAYER_HW = 0.16;

const SECTION = 240;
const BEND_PATTERN = [0, 0, 0.45, 0.9, 0.55, 0, 0, -0.4, -1, -0.7, 0, 0.3, -0.25, 0];

export function roadBend(meters) {
  const index = Math.floor(meters / SECTION);
  const wrapped = ((index % BEND_PATTERN.length) + BEND_PATTERN.length) % BEND_PATTERN.length;
  const target = BEND_PATTERN[wrapped];
  const f = (meters % SECTION) / SECTION;
  return target * Math.sin(f * Math.PI);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function moveToward(current, target, maxDelta) {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

export class Game {
  constructor() {
    this.events = [];
    this.reset();
  }

  reset() {
    this.position = 0;
    this.speed = 0;
    this.playerX = 0;
    this.steer = 0;
    this.score = 0;
    this.coins = 0;
    this.collisions = 0;
    this.lives = 3;
    this.topSpeed = 0;
    this.timeAlive = 0;
    this.boostTimer = 0;
    this.invuln = 0;
    this.offRoad = false;
    this._wasOffRoad = false;
    this.shake = 0;
    this.crashing = false;
    this.crashTimer = 0;
    this.over = false;
    this.demo = false;
    this.practice = false;
    this.difficulty = 0;
    this.maxSpeed = 42;
    this.entities = [];
    this.events.length = 0;
    this.spawnZ = 115;
    while (this.spawnZ < 320) {
      this.spawnWave(this.spawnZ);
      this.spawnZ += 68;
    }
  }

  lookAhead() {
    return 145 + this.speed * 1.15;
  }

  gap() {
    const reaction = 2.05 - this.difficulty * 0.85;
    return Math.max(38, Math.max(this.speed, 28) * reaction);
  }

  makeTraffic(z, x) {
    const roll = Math.random();
    let variant = 0;
    let hw = 0.15;
    let vz = 15 + Math.random() * 6;
    let color = Math.floor(Math.random() * 5);
    if (roll > 0.84) {
      variant = 2;
      hw = 0.22;
      vz = 10 + Math.random() * 4;
      color = 3;
    } else if (roll > 0.64) {
      variant = 3;
      hw = 0.18;
      vz = 12 + Math.random() * 5;
      color = 0;
    } else if (roll > 0.38) {
      variant = 1;
      hw = 0.13;
      vz = 20 + Math.random() * 5;
      color = (color + 2) % 5;
    }
    return { kind: "traffic", z, x, hw, vz, variant, color };
  }

  spawnWave(z) {
    const lanes = LANES.slice();
    for (let i = lanes.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = lanes[i];
      lanes[i] = lanes[j];
      lanes[j] = tmp;
    }
    const roll = Math.random();
    const twoCar = this.difficulty < 0.22 ? 0 : 0.14 + (this.difficulty - 0.22) * 0.34;
    if (roll < 0.1) {
      this.entities.push({ kind: "boost", z, x: lanes[0], hw: 0.12, vz: 0, variant: 0, color: 0 });
      if (z > 420 && Math.random() < 0.55) this.entities.push(this.makeTraffic(z + 6, lanes[1]));
      return;
    }
    if (roll < 0.34) {
      const lane = lanes[0];
      const nudge = Math.sign(lane || 1) * this.difficulty * 0.06;
      for (let i = 0; i < 5; i += 1) {
        this.entities.push({
          kind: "coin",
          z: z + i * 8,
          x: clamp(lane + nudge, -0.82, 0.82),
          hw: 0.1,
          vz: 0,
          variant: 0,
          color: 0,
        });
      }
      if (z > 380 && Math.random() < 0.75) this.entities.push(this.makeTraffic(z + 10, lanes[1]));
      return;
    }
    if (roll < 0.34 + twoCar) {
      this.entities.push(this.makeTraffic(z, lanes[0]));
      this.entities.push(this.makeTraffic(z, lanes[1]));
      return;
    }
    let lane = lanes[0];
    if (z < 520 && lane === 0) lane = Math.random() < 0.5 ? LANES[0] : LANES[2];
    this.entities.push(this.makeTraffic(z, lane));
  }

  getDemoSteer() {
    if (this.playerX > 0.8) return -1;
    if (this.playerX < -0.8) return 1;
    let nearest = null;
    let best = 46;
    for (let i = 0; i < this.entities.length; i += 1) {
      const ent = this.entities[i];
      if (ent.kind !== "traffic") continue;
      const dz = ent.z - this.position;
      if (dz < 4 || dz > best) continue;
      if (Math.abs(ent.x - this.playerX) < 0.45) {
        best = dz;
        nearest = ent;
      }
    }
    if (nearest) return nearest.x >= this.playerX ? -1 : 1;
    return Math.sin(this.position * 0.04) * 0.22;
  }

  update(dt, input) {
    if (this.over) return;
    const step = clamp(dt, 0, 0.05);
    if (step <= 0) return;

    this.difficulty = clamp(this.position / 2400, 0, 1);
    this.maxSpeed = 42 + this.difficulty * 26;
    this.steer = clamp(input.steer || 0, -1, 1);

    if (this.crashing) {
      this.crashTimer -= step;
      this.speed = Math.max(0, this.speed - 36 * step);
      this.shake = Math.max(0, this.shake - step * 1.2);
      this.position += this.speed * step;
      if (this.crashTimer <= 0) this.over = true;
      return;
    }

    let target = this.maxSpeed * 0.86;
    if (input.brake) target = 8;
    else if (input.accel) target = this.maxSpeed;
    if (this.boostTimer > 0) {
      this.boostTimer = Math.max(0, this.boostTimer - step);
      target += 15;
    }

    const bend = roadBend(this.position);
    const speedRatio = clamp(this.speed / 48, 0.45, 1.25);
    const agility = this.speed < 36 ? 1.7 : 1.7 - (this.speed - 36) * 0.012;
    this.playerX += this.steer * clamp(agility, 1.05, 1.75) * step;
    this.playerX -= bend * 0.72 * speedRatio * step;
    this.playerX = clamp(this.playerX, -1.4, 1.4);
    this.offRoad = Math.abs(this.playerX) > 1.02;
    if (this.offRoad) target *= 0.5;

    const rate = this.speed < target ? (this.offRoad ? 22 : 16) : 28;
    this.speed = Math.max(0, moveToward(this.speed, target, rate * step));
    if (this.offRoad && this.speed < 12 && !input.brake) this.speed = 12;
    this.topSpeed = Math.max(this.topSpeed, this.speed);
    this.position += this.speed * step;

    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - step);
    this.shake = Math.max(0, this.shake - step * 1.15);

    if (!this.demo && !this.practice) {
      this.score += this.speed * step * 2.15;
      this.timeAlive += step;
      if (this.offRoad && !this._wasOffRoad) this.events.push({ type: "offroad" });
    }
    this._wasOffRoad = this.offRoad;

    for (let i = this.entities.length - 1; i >= 0; i -= 1) {
      const ent = this.entities[i];
      if (ent.kind === "traffic") ent.z += ent.vz * step;
      const dz = ent.z - this.position;
      if (dz < -6 || dz > 260) {
        this.entities.splice(i, 1);
        continue;
      }
      if (this.demo || this.practice) continue;
      const overlap = Math.abs(ent.x - this.playerX) < ent.hw + (ent.kind === "traffic" ? PLAYER_HW : 0.22);
      if (!overlap || dz > 4.8 || dz < -0.8) continue;
      if (ent.kind === "coin") {
        this.entities.splice(i, 1);
        this.coins += 1;
        this.score += 200;
        this.events.push({ type: "coin", x: ent.x, z: ent.z, text: "+200" });
      } else if (ent.kind === "boost") {
        this.entities.splice(i, 1);
        this.boostTimer = 3.4;
        this.score += 80;
        this.events.push({ type: "boost", x: ent.x, z: ent.z, text: "BOOST" });
      } else if (this.invuln <= 0) {
        this.entities.splice(i, 1);
        this.collisions += 1;
        this.lives -= 1;
        this.score = Math.max(0, this.score - 120);
        this.speed *= 0.58;
        this.invuln = 1.55;
        this.shake = 1;
        const away = Math.sign(this.playerX - ent.x) || (this.playerX >= 0 ? 1 : -1);
        this.playerX = clamp(this.playerX + away * 0.12, -1.4, 1.4);
        this.events.push({ type: "hit", text: "-120" });
        if (this.lives <= 0) {
          this.lives = 0;
          this.crashing = true;
          this.crashTimer = 0.72;
        }
      }
    }

    if (!this.crashing && !this.over) {
      let guard = 0;
      const horizon = this.position + this.lookAhead();
      while (this.spawnZ < horizon && guard < 6) {
        this.spawnWave(this.spawnZ);
        this.spawnZ += this.gap();
        guard += 1;
      }
    }

    if (this.entities.length > 70) {
      this.entities.splice(0, this.entities.length - 70);
    }
  }
}
