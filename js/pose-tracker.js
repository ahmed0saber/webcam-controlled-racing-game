/**
 * Webcam pose tracking via MediaPipe Tasks Vision.
 *
 * External dependencies (loaded only after the player enables the camera):
 * - https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20
 * - https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
 *
 * Frames stay in the browser. Nothing is uploaded.
 */

const VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20";
const WASM_CDN = `${VISION_CDN}/wasm`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13;
const RIGHT_ELBOW = 14;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;

function visibilityOf(landmark) {
  if (!landmark) return 0;
  if (typeof landmark.visibility === "number") return landmark.visibility;
  if (typeof landmark.presence === "number") return landmark.presence;
  return 0;
}

function mirrorPoint(landmark) {
  if (!landmark) return null;
  return {
    x: 1 - landmark.x,
    y: landmark.y,
    visibility: visibilityOf(landmark),
  };
}

function inFrame(point, minVis) {
  return Boolean(
    point
    && point.visibility >= minVis
    && point.x > -0.02 && point.x < 1.02
    && point.y > -0.02 && point.y < 1.02,
  );
}

export function assessPose(points) {
  const { leftWrist: lw, rightWrist: rw } = points;
  const leftSeen = inFrame(lw, 0.5);
  const rightSeen = inFrame(rw, 0.5);
  const wristOk = leftSeen && rightSeen;
  const wristsStrong = inFrame(lw, 0.65) && inFrame(rw, 0.65);
  let quality = "lost";
  if (wristsStrong) quality = "stable";
  else if (leftSeen || rightSeen) quality = "weak";
  return { wristOk, quality };
}

function cameraErrorMessage(error) {
  const name = error && error.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was denied. Allow camera access in the browser site settings, then try again. Keyboard mode is ready whenever you are.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found. Plug in a webcam, or play with the keyboard.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is busy or could not be opened. Close other apps using it, then try again. Keyboard mode still works.";
  }
  if (name === "SecurityError") {
    return "This page is not allowed to use the camera. Open it on localhost or over HTTPS.";
  }
  if (name === "AbortError") {
    return "Camera startup was interrupted. Please try again.";
  }
  return "The camera could not be started. You can still race with the keyboard.";
}

export class PoseTracker {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.landmarker = null;
    this.active = false;
    this.busy = false;
    this.snapshot = null;
    this.error = null;
    this.onDisconnect = null;
    this._starting = null;
    this._loading = null;
    this.lastTs = -1;
    this._lastInfer = 0;
    this._inferErrorLogged = false;
  }

  async loadModel() {
    if (this.landmarker) return;
    if (this._loading) return this._loading;
    this._loading = this._loadModel();
    try {
      await this._loading;
    } finally {
      this._loading = null;
    }
  }

  async _loadModel() {
    let visionModule;
    try {
      visionModule = await import(VISION_CDN);
    } catch (error) {
      const failure = new Error("The pose library could not be downloaded. Check your connection. Keyboard mode still works.");
      failure.cause = error;
      throw failure;
    }
    const { PoseLandmarker, FilesetResolver } = visionModule;
    let fileset;
    try {
      fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    } catch (error) {
      const failure = new Error("Pose tracking files could not be loaded. Check your connection. Keyboard mode still works.");
      failure.cause = error;
      throw failure;
    }
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      try {
        this.landmarker = await PoseLandmarker.createFromOptions(fileset, options("CPU"));
      } catch (error) {
        const failure = new Error("The pose model could not be loaded. Check your connection and try again. Keyboard mode still works.");
        failure.cause = error;
        throw failure;
      }
    }
  }

  async enable() {
    if (this.active && this.stream) return { ok: true };
    if (this._starting) return this._starting;
    this._starting = this._enable();
    try {
      return await this._starting;
    } finally {
      this._starting = null;
    }
  }

  async _enable() {
    this.error = null;
    if (!window.isSecureContext) {
      this.error = "Camera access needs localhost or HTTPS. Keyboard mode does not need a camera.";
      return { ok: false, message: this.error };
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.error = "This browser cannot open a camera. Play with the keyboard, or use a current version of Chrome, Edge, or Firefox.";
      return { ok: false, message: this.error };
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch (error) {
      if (error && error.name === "OverconstrainedError") {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user" } });
        } catch (fallbackError) {
          this.stop();
          this.error = cameraErrorMessage(fallbackError);
          return { ok: false, message: this.error };
        }
      } else {
        this.stop();
        this.error = cameraErrorMessage(error);
        return { ok: false, message: this.error };
      }
    }

    try {
      await this.loadModel();
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      this.error = error.message || "The pose model could not be loaded.";
      return { ok: false, message: this.error };
    }

    this.stream = stream;
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    try {
      await this.video.play();
    } catch {
      this.stop();
      this.error = "The camera preview could not start. Try the enable button again, or play with the keyboard.";
      return { ok: false, message: this.error };
    }

    const [track] = stream.getVideoTracks();
    if (track) {
      track.onended = () => {
        if (!this.active) return;
        this.active = false;
        this.snapshot = null;
        this.error = "The camera disconnected. Reconnect it, or switch to keyboard controls.";
        if (this.onDisconnect) this.onDisconnect(this.error);
      };
    }

    this.active = true;
    this.lastTs = -1;
    this._lastInfer = 0;
    return { ok: true };
  }

  stop() {
    this.active = false;
    this.busy = false;
    this.snapshot = null;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }

  requestFrame(now) {
    if (!this.active || this.busy || !this.landmarker) return;
    if (now - this._lastInfer < 50) return;
    if (!this.video || this.video.readyState < 2) return;
    this._lastInfer = now;
    this.busy = true;
    let ts = now;
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    try {
      const result = this.landmarker.detectForVideo(this.video, ts);
      this.snapshot = this._parse(result);
    } catch (error) {
      this.snapshot = null;
      if (!this._inferErrorLogged) {
        this._inferErrorLogged = true;
        console.error("Pose inference failed", error);
      }
    } finally {
      this.busy = false;
    }
  }

  _parse(result) {
    const landmarks = result && result.landmarks && result.landmarks[0];
    if (!landmarks) {
      return {
        leftWrist: null,
        rightWrist: null,
        leftShoulder: null,
        rightShoulder: null,
        leftElbow: null,
        rightElbow: null,
        wristOk: false,
        shouldersOk: false,
        elbowsOk: false,
        armsPlausible: false,
        quality: "lost",
      };
    }
    const points = {
      leftWrist: mirrorPoint(landmarks[LEFT_WRIST]),
      rightWrist: mirrorPoint(landmarks[RIGHT_WRIST]),
      leftShoulder: mirrorPoint(landmarks[LEFT_SHOULDER]),
      rightShoulder: mirrorPoint(landmarks[RIGHT_SHOULDER]),
      leftElbow: mirrorPoint(landmarks[LEFT_ELBOW]),
      rightElbow: mirrorPoint(landmarks[RIGHT_ELBOW]),
    };
    return { ...points, ...assessPose(points) };
  }

  drawPreview(canvas, steering) {
    const video = this.video;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const vw = video && video.videoWidth ? video.videoWidth : 640;
    const vh = video && video.videoHeight ? video.videoHeight : 480;
    const maxW = 480;
    const scale = vw > maxW ? maxW / vw : 1;
    const cw = Math.max(2, Math.round(vw * scale));
    const ch = Math.max(2, Math.round(vh * scale));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#071018";
    ctx.fillRect(0, 0, cw, ch);
    if (video && video.readyState >= 2) {
      ctx.save();
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, cw, ch);
      ctx.restore();
    }

    const snap = this.snapshot;
    const quality = steering ? steering.quality : "lost";
    const color = quality === "stable" ? "#3ee0ff" : quality === "weak" ? "#ffd15c" : "#ff5d73";
    const lw = snap && snap.leftWrist;
    const rw = snap && snap.rightWrist;

    const mark = (point, radius, strong) => {
      if (!point) return;
      ctx.beginPath();
      ctx.fillStyle = strong ? color : "rgba(232, 244, 255, 0.75)";
      ctx.arc(point.x * cw, point.y * ch, radius, 0, Math.PI * 2);
      ctx.fill();
    };
    if (lw && rw && snap.wristOk) {
      const x1 = lw.x * cw;
      const y1 = lw.y * ch;
      const x2 = rw.x * cw;
      const y2 = rw.y * ch;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const radius = Math.max(28, Math.hypot(x2 - x1, y2 - y1) / 2);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.lineCap = "round";
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(-radius, 0);
      ctx.lineTo(radius, 0);
      ctx.moveTo(0, -radius * 0.72);
      ctx.lineTo(0, radius * 0.72);
      ctx.stroke();
      ctx.restore();
      mark(lw, 7, true);
      mark(rw, 7, true);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.strokeStyle = "#ff5d73";
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cw / 2, ch / 2, Math.min(cw, ch) * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  dispose() {
    this.stop();
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch {
        /* already closed */
      }
      this.landmarker = null;
    }
  }
}
