import { roadBend } from "./game.js";

const VIEW = {
  horizon: 0.36,
  camY: 1.08,
  focal: 17.5,
  playerScreen: 0.875,
  far: 188,
  nearPad: 8,
  step: 5,
};

const FOG = [86, 168, 214];
const GRASS_A = [12, 42, 48];
const GRASS_B = [8, 32, 40];
const ROAD_A = [46, 58, 78];
const ROAD_B = [36, 46, 64];
const RUMBLE_A = [226, 242, 255];
const RUMBLE_B = [18, 96, 128];
const EDGE = [214, 230, 244];
const LANE = [242, 206, 84];

const TRAFFIC = [
  { body: "#ff5c3c", body2: "#ffb199", glass: "#1b2433", trim: "#4a1c14" },
  { body: "#f4f7fb", body2: "#c9d4e4", glass: "#243044", trim: "#6d7c90" },
  { body: "#c15bff", body2: "#ebc8ff", glass: "#1a1024", trim: "#4c1870" },
  { body: "#ffc043", body2: "#ffe3a6", glass: "#2a220f", trim: "#6a4a10" },
  { body: "#2fe08a", body2: "#bfffe4", glass: "#06281c", trim: "#0e4d34" },
];

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function rgb(c) {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
}

function roundedPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, radius);
  else ctx.rect(x, y, w, h);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.width = canvas.width;
    this.height = canvas.height;
    this.reducedMotion = false;
    this.time = 0;
    this.samples = Array.from({ length: 48 }, () => ({
      z: 0,
      shift: 0,
      worldZ: 0,
      x: 0,
      y: 0,
      half: 0,
      scale: 0,
      index: 0,
    }));
    this.sampleCount = 0;
    this.particles = Array.from({ length: 42 }, () => ({
      alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, color: "#fff", size: 2,
    }));
    this.floaters = [];
    this._particleCursor = 0;
    this.playerDepth = (VIEW.camY * VIEW.focal) / (VIEW.playerScreen - VIEW.horizon);
    this.stars = STARFIELD;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = Math.max(2, Math.round(rect.width * dpr));
    let h = Math.max(2, Math.round(rect.height * dpr));
    const maxW = 1280;
    if (w > maxW) {
      h = Math.max(2, Math.round(h * (maxW / w)));
      w = maxW;
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.width = w;
    this.height = h;
  }

  project(zRel, lateral) {
    const z = Math.max(1, zRel);
    const scale = VIEW.focal / z;
    const half = scale * this.width;
    return {
      x: this.width / 2 + lateral * half,
      y: this.height * VIEW.horizon + VIEW.camY * scale * this.height,
      half,
      scale,
    };
  }

  render(game, dt) {
    const ctx = this.ctx;
    if (!ctx) return;
    const step = Math.min(Math.max(dt || 0, 0), 0.05);
    this.time += this.reducedMotion ? 0 : step;
    const width = this.width;
    const height = this.height;
    const horizon = height * VIEW.horizon;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!this.reducedMotion && game.shake > 0.02) {
      const mag = game.shake * Math.min(10, width * 0.008);
      ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
    }

    this.drawSky(ctx, width, height, horizon);
    this.buildRoad(game);
    this.drawRoad(ctx, width, height, horizon);
    this.drawScenery(ctx, width);
    this.drawEntities(game);
    this.drawPlayer(ctx, game);
    this.updateEffects(step);
    this.drawEffects(ctx);
    if (game.boostTimer > 0) this.drawSpeedLines(ctx, width, height);
    this.drawVignette(ctx, width, height, game);
  }

  drawSky(ctx, width, height, horizon) {
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#070b16");
    sky.addColorStop(0.55, "#10243f");
    sky.addColorStop(1, "#1c628f");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(width * 0.72, horizon * 0.92, 0, width * 0.72, horizon, width * 0.42);
    glow.addColorStop(0, "rgba(90, 220, 255, 0.38)");
    glow.addColorStop(0.35, "rgba(40, 110, 190, 0.16)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, horizon + 8);

    for (let i = 0; i < this.stars.length; i += 1) {
        const star = this.stars[i];
        const twinkle = this.reducedMotion ? 0.4 : 0.28 + Math.sin(this.time * 0.8 + star.p) * 0.12;
        ctx.globalAlpha = twinkle;
        ctx.fillStyle = "#d7f6ff";
        ctx.fillRect(star.x * width, star.y * horizon, star.r, star.r);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#12304a";
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    const peaks = [0.08, 0.16, 0.12, 0.22, 0.1, 0.18, 0.09, 0.2, 0.13, 0.17];
    for (let i = 0; i < peaks.length; i += 1) {
      const x = (i / (peaks.length - 1)) * width;
      ctx.lineTo(x, horizon - peaks[i] * horizon * 0.42);
    }
    ctx.lineTo(width, horizon);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#0c1c30";
    for (let i = 0; i < 22; i += 1) {
      const bw = width / 22;
      const bh = horizon * (0.08 + ((i * 37) % 18) / 100);
      const x = i * bw + bw * 0.15;
      ctx.fillRect(x, horizon - bh, bw * 0.7, bh);
      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(120, 220, 255, 0.35)";
        ctx.fillRect(x + bw * 0.22, horizon - bh * 0.72, Math.max(1, bw * 0.08), Math.max(1, bh * 0.08));
        ctx.fillStyle = "#0c1c30";
      }
    }
  }

  buildRoad(game) {
    const camLateral = game.playerX * 0.18;
    let shift = 0;
    let heading = 0;
    const start = this.playerDepth - VIEW.nearPad;
    const count = Math.min(this.samples.length, Math.ceil((VIEW.far - start) / VIEW.step));
    this.sampleCount = count;
    for (let i = 0; i < count; i += 1) {
      const z = start + i * VIEW.step;
      const worldZ = game.position + (z - this.playerDepth);
      const sample = this.samples[i];
      sample.z = z;
      sample.shift = shift - camLateral;
      sample.worldZ = worldZ;
      sample.index = Math.floor(worldZ / VIEW.step);
      const projected = this.project(z, sample.shift);
      sample.x = projected.x;
      sample.y = projected.y;
      sample.half = projected.half;
      sample.scale = projected.scale;
      const bend = roadBend(worldZ);
      heading += bend * 0.0015;
      shift += heading;
    }
  }

  drawRoad(ctx, width, height, horizon) {
    const count = this.sampleCount;
    if (count < 2) return;
    const far = this.samples[count - 1];
    ctx.fillStyle = rgb(GRASS_A);
    ctx.fillRect(0, horizon, width, height - horizon);
    ctx.fillStyle = rgb(mix(ROAD_A, FOG, 0.72));
    ctx.beginPath();
    ctx.moveTo(width / 2, horizon);
    ctx.lineTo(far.x - far.half, far.y);
    ctx.lineTo(far.x + far.half, far.y);
    ctx.closePath();
    ctx.fill();

    for (let i = count - 2; i >= 0; i -= 1) {
      const near = this.samples[i];
      const next = this.samples[i + 1];
      const fog = i / (count - 1);
      const stripe = near.index % 2 === 0;
      const band = next.y;
      const bandH = near.y - next.y;
      if (bandH < 0.4) continue;
      ctx.fillStyle = rgb(mix(stripe ? GRASS_A : GRASS_B, FOG, fog * 0.85));
      ctx.fillRect(0, band, width, bandH + 1.5);

      const rumble = stripe ? RUMBLE_A : RUMBLE_B;
      ctx.fillStyle = rgb(mix(rumble, FOG, fog * 0.75));
      this.trapezoid(ctx, near.x, near.y, near.half * 1.16, next.x, next.y, next.half * 1.16);

      ctx.fillStyle = rgb(mix(stripe ? ROAD_A : ROAD_B, FOG, fog * 0.8));
      this.trapezoid(ctx, near.x, near.y, near.half, next.x, next.y, next.half);

      ctx.fillStyle = rgb(mix(EDGE, FOG, fog * 0.65));
      const edge = 0.045;
      this.trapezoid(
        ctx,
        near.x, near.y, near.half,
        next.x, next.y, next.half,
      );
      ctx.fillStyle = rgb(mix(stripe ? ROAD_A : ROAD_B, FOG, fog * 0.8));
      this.trapezoid(
        ctx,
        near.x, near.y, near.half * (1 - edge),
        next.x, next.y, next.half * (1 - edge),
      );

      if (near.index % 5 < 2) {
        ctx.fillStyle = rgb(mix(LANE, FOG, fog * 0.55));
        for (const lane of [-0.34, 0.34]) {
          this.trapezoid(
            ctx,
            near.x + lane * near.half, near.y, near.half * 0.018,
            next.x + lane * next.half, next.y, next.half * 0.018,
          );
        }
      }
    }
  }

  trapezoid(ctx, x1, y1, w1, x2, y2, w2) {
    ctx.beginPath();
    ctx.moveTo(x1 - w1, y1);
    ctx.lineTo(x1 + w1, y1);
    ctx.lineTo(x2 + w2, y2);
    ctx.lineTo(x2 - w2, y2);
    ctx.closePath();
    ctx.fill();
  }

  drawScenery(ctx, width) {
    for (let i = this.sampleCount - 1; i >= 2; i -= 1) {
      const sample = this.samples[i];
      if (sample.half < 8 || sample.half > this.width * 0.55) continue;
      if (sample.index % 3 !== 0) continue;
      const side = sample.index % 6 === 0 ? -1 : 1;
      const x = sample.x + side * sample.half * 1.38;
      if (x < -40 || x > width + 40) continue;
      if (sample.index % 9 === 0) this.drawLamp(ctx, x, sample.y, sample.half, side);
      else this.drawTree(ctx, x, sample.y, sample.half);
    }
  }

  drawTree(ctx, x, y, half) {
    const h = half * 0.62;
    const w = half * 0.2;
    ctx.fillStyle = "#16343c";
    ctx.fillRect(x - Math.max(1, half * 0.025), y - h * 0.38, Math.max(2, half * 0.05), h * 0.38);
    ctx.fillStyle = "#17685c";
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x + w, y - h * 0.32);
    ctx.lineTo(x - w, y - h * 0.32);
    ctx.fill();
    ctx.fillStyle = "#1f8f78";
    ctx.beginPath();
    ctx.moveTo(x, y - h * 0.78);
    ctx.lineTo(x + w * 0.7, y - h * 0.42);
    ctx.lineTo(x - w * 0.7, y - h * 0.42);
    ctx.fill();
  }

  drawLamp(ctx, x, y, half, side) {
    const h = half * 0.78;
    ctx.strokeStyle = "#b7e7ff";
    ctx.lineWidth = Math.max(1, half * 0.018);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - h);
    ctx.lineTo(x - side * half * 0.16, y - h);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 214, 120, 0.95)";
    ctx.beginPath();
    ctx.arc(x - side * half * 0.16, y - h, Math.max(1.5, half * 0.035), 0, Math.PI * 2);
    ctx.fill();
  }

  drawEntities(game) {
    const list = this._spriteList || (this._spriteList = []);
    list.length = 0;
    const position = game.position;
    for (let i = 0; i < game.entities.length; i += 1) {
      const ent = game.entities[i];
      const depth = ent.z - position + this.playerDepth;
      if (depth < this.playerDepth - 1 || depth > VIEW.far) continue;
      list.push(ent);
    }
    list.sort((a, b) => b.z - a.z);
    const ctx = this.ctx;
    for (let i = 0; i < list.length; i += 1) {
      const ent = list[i];
      const depth = ent.z - position + this.playerDepth;
      const shift = this.shiftAt(depth);
      const projected = this.project(depth, shift + ent.x);
      if (projected.y > this.height + 40 || projected.half < 2) continue;
      if (ent.kind === "coin") this.drawCoin(ctx, projected.x, projected.y - projected.half * 0.18, projected.half * 0.16, ent.z);
      else if (ent.kind === "boost") this.drawBoost(ctx, projected.x, projected.y - projected.half * 0.2, projected.half * 0.16);
      else this.drawVehicle(ctx, projected.x, projected.y, projected.half * ent.hw * 2.05, ent.variant, TRAFFIC[ent.color], 0, 1);
    }
  }

  shiftAt(depth) {
    const count = this.sampleCount;
    if (count === 0) return 0;
    if (count === 1) return this.samples[0].shift;
    const start = this.samples[0].z;
    const idx = (depth - start) / VIEW.step;
    if (idx <= 0) return this.samples[0].shift;
    const i = Math.min(count - 2, Math.max(0, Math.floor(idx)));
    const t = Math.min(1, Math.max(0, idx - i));
    const a = this.samples[i];
    const b = this.samples[i + 1];
    return a.shift + (b.shift - a.shift) * t;
  }

  drawPlayer(ctx, game) {
    const depth = this.playerDepth;
    const shift = this.shiftAt(depth);
    const projected = this.project(depth, shift + game.playerX * 0.92);
    const bob = this.reducedMotion ? 0 : Math.sin(this.time * (5 + game.speed * 0.08)) * (game.offRoad ? 3 : 1);
    const flash = game.invuln > 0 ? 0.78 + Math.sin(this.time * 8) * 0.18 : 1;
    const widthPx = Math.max(36, projected.half * 0.38);
    this.drawVehicle(ctx, projected.x, Math.min(this.height * 0.94, projected.y) + bob, widthPx, "player", null, game.steer, flash);
    if (game.invuln > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(62, 224, 255, 0.75)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(projected.x, projected.y + bob, widthPx * 0.7, widthPx * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawVehicle(ctx, x, y, widthPx, variant, colors, steer, alpha) {
    const player = variant === "player";
    const truck = variant === 2;
    const van = variant === 3;
    const sport = variant === 1;
    const w = widthPx;
    const h = w * (truck || van ? 1.12 : sport ? 0.84 : 0.96);
    const palette = player
      ? { body: "#1c7dff", body2: "#7af0ff", glass: "#07131f", trim: "#0b3e86" }
      : colors;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((steer || 0) * 0.16);
    ctx.globalAlpha = Math.max(0.35, alpha);

    ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
    ctx.beginPath();
    ctx.ellipse(0, w * 0.02, w * 0.5, w * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#10141c";
    roundedPath(ctx, -w * 0.5, -h * 0.28, w * 0.16, h * 0.3, w * 0.04);
    ctx.fill();
    roundedPath(ctx, w * 0.34, -h * 0.28, w * 0.16, h * 0.3, w * 0.04);
    ctx.fill();

    const top = truck ? -h * 0.96 : -h * 0.9;
    const bottom = -h * 0.05;
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, palette.body2);
    grad.addColorStop(0.42, palette.body);
    grad.addColorStop(1, palette.trim);
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (truck || van) {
      ctx.moveTo(-w * 0.4, bottom);
      ctx.lineTo(w * 0.4, bottom);
      ctx.lineTo(w * 0.4, top + h * 0.18);
      ctx.lineTo(w * 0.28, top);
      ctx.lineTo(-w * 0.28, top);
      ctx.lineTo(-w * 0.4, top + h * 0.18);
    } else {
      ctx.moveTo(-w * 0.46, bottom);
      ctx.lineTo(w * 0.46, bottom);
      ctx.lineTo(w * 0.36, top + h * 0.34);
      ctx.lineTo(w * 0.2, top);
      ctx.lineTo(-w * 0.2, top);
      ctx.lineTo(-w * 0.36, top + h * 0.34);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = palette.glass;
    ctx.beginPath();
    const glassTop = top + h * (truck ? 0.08 : 0.06);
    const glassBot = top + h * (truck ? 0.28 : 0.34);
    ctx.moveTo(-w * 0.16, glassTop);
    ctx.lineTo(w * 0.16, glassTop);
    ctx.lineTo(w * 0.22, glassBot);
    ctx.lineTo(-w * 0.22, glassBot);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillRect(-w * 0.05, glassTop + 2, w * 0.08, Math.max(2, (glassBot - glassTop) * 0.45));

    ctx.fillStyle = player ? "#ff4d6a" : "#ff2a45";
    roundedPath(ctx, -w * 0.38, bottom - h * 0.16, w * 0.14, h * 0.07, 2);
    ctx.fill();
    roundedPath(ctx, w * 0.24, bottom - h * 0.16, w * 0.14, h * 0.07, 2);
    ctx.fill();

    if (player && steer) {
      ctx.fillStyle = steer > 0.15 ? "#ffd36a" : "rgba(255,255,255,0.2)";
      ctx.fillRect(w * 0.22, bottom - h * 0.28, w * 0.08, h * 0.05);
      ctx.fillStyle = steer < -0.15 ? "#ffd36a" : "rgba(255,255,255,0.2)";
      ctx.fillRect(-w * 0.3, bottom - h * 0.28, w * 0.08, h * 0.05);
    }

    ctx.fillStyle = "#e7eef6";
    roundedPath(ctx, -w * 0.09, bottom - h * 0.15, w * 0.18, h * 0.08, 2);
    ctx.fill();
    ctx.restore();
  }

  drawCoin(ctx, x, y, radius, seed) {
    const spin = Math.abs(Math.cos(this.time * 4 + seed * 0.15));
    const rx = Math.max(1.5, radius * (0.28 + spin * 0.72));
    ctx.fillStyle = "#c9891a";
    ctx.beginPath();
    ctx.ellipse(x, y, rx, radius, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe08a";
    ctx.beginPath();
    ctx.ellipse(x, y, rx * 0.62, radius * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBoost(ctx, x, y, size) {
    const pulse = this.reducedMotion ? 1 : 1 + Math.sin(this.time * 6) * 0.08;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.reducedMotion ? 0 : Math.sin(this.time * 2) * 0.15);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = "#ff9a1f";
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.72, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size * 0.72, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff4d2";
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.45);
    ctx.lineTo(size * 0.28, 0);
    ctx.lineTo(0, size * 0.45);
    ctx.lineTo(-size * 0.28, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawSpeedLines(ctx, width, height) {
    ctx.save();
    ctx.strokeStyle = "rgba(190, 244, 255, 0.28)";
    ctx.lineWidth = 2;
    const rows = 10;
    for (let i = 0; i < rows; i += 1) {
      const t = (this.time * 1.4 + i / rows) % 1;
      const y = height * (0.2 + t * 0.75);
      const len = 30 + t * 90;
      const x = (i % 2 === 0 ? width * 0.08 : width * 0.86) + (i - rows / 2) * 8;
      ctx.globalAlpha = t;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawVignette(ctx, width, height, game) {
    const g = ctx.createRadialGradient(width / 2, height * 0.55, height * 0.2, width / 2, height * 0.5, height * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, game.offRoad ? "rgba(255, 50, 70, 0.28)" : "rgba(0, 0, 0, 0.28)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    if (game.crashing) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
      ctx.fillRect(0, 0, width, height);
    }
  }

  spawnBurst(x, y, color, count, speed) {
    const n = this.reducedMotion ? Math.min(4, count) : count;
    for (let i = 0; i < n; i += 1) {
      const p = this.particles[this._particleCursor];
      this._particleCursor = (this._particleCursor + 1) % this.particles.length;
      const angle = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const mag = speed * (0.5 + Math.random() * 0.8);
      p.alive = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * mag;
      p.vy = Math.sin(angle) * mag;
      p.life = 0.45 + Math.random() * 0.25;
      p.max = p.life;
      p.color = color;
      p.size = 2 + Math.random() * 3;
    }
  }

  spawnFloater(x, y, text, color) {
    if (this.floaters.length > 8) this.floaters.shift();
    this.floaters.push({ x, y, text, color, life: 0.8 });
  }

  emit(game) {
    const events = game.events;
    if (!events.length) return;
    const anchor = this.project(this.playerDepth, game.playerX * 0.5);
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (event.type === "coin") {
        this.spawnBurst(anchor.x, anchor.y - 80, "#ffd15c", 10, 90);
        this.spawnFloater(anchor.x, anchor.y - 100, event.text, "#ffd15c");
      } else if (event.type === "boost") {
        this.spawnBurst(anchor.x, anchor.y - 70, "#ff9a1f", 12, 110);
        this.spawnFloater(anchor.x, anchor.y - 110, event.text, "#ffb020");
      } else if (event.type === "hit") {
        this.spawnBurst(anchor.x, anchor.y - 60, "#ff5d73", 14, 140);
        this.spawnFloater(anchor.x, anchor.y - 90, event.text, "#ff8b9a");
      }
    }
    events.length = 0;
  }

  updateEffects(dt) {
    for (let i = 0; i < this.particles.length; i += 1) {
      const p = this.particles[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 40 * dt;
    }
    for (let i = this.floaters.length - 1; i >= 0; i -= 1) {
      const floater = this.floaters[i];
      floater.life -= dt;
      floater.y -= 36 * dt;
      if (floater.life <= 0) this.floaters.splice(i, 1);
    }
  }

  drawEffects(ctx) {
    for (let i = 0; i < this.particles.length; i += 1) {
      const p = this.particles[i];
      if (!p.alive) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.font = "700 18px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    for (let i = 0; i < this.floaters.length; i += 1) {
      const floater = this.floaters[i];
      ctx.globalAlpha = Math.max(0, floater.life / 0.8);
      ctx.fillStyle = floater.color;
      ctx.fillText(floater.text, floater.x, floater.y);
    }
    ctx.globalAlpha = 1;
  }
}

const STARFIELD = Array.from({ length: 36 }, (_, i) => ({
  x: ((i * 97) % 100) / 100,
  y: 0.08 + ((i * 53) % 70) / 100 * 0.55,
  r: (i % 3) + 1,
  p: i * 1.7,
}));
