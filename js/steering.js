/** Angle of the line between two pose points, in degrees. */
export function lineAngleDegrees(left, right) {
  const rad = Math.atan2(right.y - left.y, right.x - left.x);
  return (rad * 180) / Math.PI;
}

export function wrapDegrees(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function circularStats(samples) {
  let sinSum = 0;
  let cosSum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const rad = (samples[i] * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const mean = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
  const r = Math.hypot(sinSum, cosSum) / samples.length;
  let std = 180;
  if (r > 0.0001) {
    std = Math.sqrt(Math.max(0, -2 * Math.log(Math.min(1, r)))) * (180 / Math.PI);
  }
  return { mean, std, r };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export class SteeringController {
  constructor() {
    this.neutral = 0;
    this.calibrated = false;
    this.smoothed = 0;
    this.steer = 0;
    this.angleDeg = 0;
    this.relativeDeg = 0;
    this.quality = "lost";
    this.message = "Camera off";
    this.lostFor = 0;
    this._target = 0;
    this._heldTarget = 0;
    this._window = [];
    this._calibrating = false;
    this._samples = [];
    this._calibStart = 0;
    this._lastSampleAt = 0;
    this._latched = false;
    this._lastSnap = null;
  }

  resetCalibration() {
    this.neutral = 0;
    this.calibrated = false;
    this._samples = [];
    this._calibStart = 0;
    this._calibrating = false;
  }

  beginCalibration() {
    this._calibrating = true;
    this._samples = [];
    this._calibStart = 0;
    this._lastSampleAt = 0;
    this._latched = false;
  }

  /**
   * Collect a neutral-angle sample. `now` is a millisecond timestamp.
   * Only stable, high-confidence poses are recorded.
   */
  sampleCalibration(snapshot, now) {
    if (!this._calibrating) this.beginCalibration();
    const stable = Boolean(snapshot && snapshot.quality === "stable");
    if (!stable) {
      if (this._samples.length && now - this._lastSampleAt > 450) {
        this._samples = [];
        this._calibStart = 0;
      }
      return {
        status: "pending",
        progress: 0,
        message: "Hold both hands up as a straight wheel, palms toward the camera.",
      };
    }

    const angle = lineAngleDegrees(snapshot.leftHand, snapshot.rightHand);
    if (!this._calibStart) this._calibStart = now;
    this._lastSampleAt = now;
    this._samples.push(angle);
    const elapsed = now - this._calibStart;
    const progress = clamp(elapsed / 1000, 0, 1);

    if (elapsed < 900 || this._samples.length < 8) {
      return {
        status: "pending",
        progress,
        message: "Hold the wheel straight…",
      };
    }

    const stats = circularStats(this._samples);
    if (stats.std > 12) {
      this._samples = [];
      this._calibStart = 0;
      return {
        status: "unstable",
        progress: 0,
        std: stats.std,
        message: "That reading wobbled. Hold still and we’ll measure again.",
      };
    }

    this.neutral = stats.mean;
    this.calibrated = true;
    this._calibrating = false;
    this._samples = [];
    this._window = [];
    this.smoothed = 0;
    this.steer = 0;
    this._target = 0;
    this._heldTarget = 0;
    this.relativeDeg = 0;
    return {
      status: "success",
      progress: 1,
      neutral: stats.mean,
      std: stats.std,
      message: `Neutral saved at ${stats.mean.toFixed(1)}°.`,
    };
  }

  update(snapshot, dt, sensitivity) {
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    const sens = clamp(Number(sensitivity) || 1, 0.5, 2);
    const maxAngle = Math.max(20, 50 / sens);
    const dead = 3.5;
    const stable = Boolean(snapshot && snapshot.quality === "stable" && snapshot.leftHand && snapshot.rightHand);

    if (stable) {
      const angle = lineAngleDegrees(snapshot.leftHand, snapshot.rightHand);
      if (snapshot !== this._lastSnap) {
        this._lastSnap = snapshot;
        this._window.push(angle);
        if (this._window.length > 5) this._window.shift();
      }
      const sorted = this._window.slice().sort((a, b) => a - b);
      const filtered = sorted[sorted.length >> 1];
      this.angleDeg = filtered;
      this.lostFor = 0;
      this.quality = "stable";
      const neutral = this.calibrated ? this.neutral : 0;
      this.relativeDeg = wrapDegrees(filtered - neutral);
      const mag = Math.abs(this.relativeDeg);
      let target = 0;
      if (mag > dead) {
        target = Math.sign(this.relativeDeg) * Math.min(1, (mag - dead) / (maxAngle - dead));
      }
      this._target = target;
      this._heldTarget = this.smoothed;
      this._latched = false;
      this.message = this.calibrated
        ? "Tracking stable"
        : "Tracking stable — calibrate to set the straight-ahead position";
    } else {
      if (!this._latched) {
        this._heldTarget = this.smoothed;
        this._latched = true;
      }
      this.lostFor += step;
      const weak = Boolean(snapshot && snapshot.quality === "weak");
      this.quality = weak ? "weak" : "lost";
      if (this.lostFor < 0.4) {
        this._target = this._heldTarget;
        this.message = weak
          ? "Tracking weak — holding the wheel briefly"
          : "Tracking lost — holding the wheel briefly";
      } else {
        const fade = clamp((this.lostFor - 0.4) / 0.65, 0, 1);
        this._target = this._heldTarget * (1 - fade);
        this.message = fade >= 1
          ? (weak
            ? "Tracking weak — steering recentered. Keep both hands in view."
            : "Tracking lost — steering recentered. Bring both hands back into view.")
          : "Recentering steering until tracking returns";
      }
    }

    if (step > 0) {
      const alpha = 1 - Math.exp(-12 * step);
      this.smoothed += (this._target - this.smoothed) * alpha;
    }
    if (Math.abs(this.smoothed) < 0.0008) this.smoothed = 0;
    this.steer = clamp(this.smoothed, -1, 1);
    return this.steer;
  }
}
