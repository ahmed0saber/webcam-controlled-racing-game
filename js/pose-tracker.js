/**
 * Webcam hand tracking via MediaPipe Tasks Vision.
 *
 * External dependencies (loaded only after the player enables the camera):
 * - https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20
 * - https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
 *
 * Frames stay in the browser. Nothing is uploaded.
 */

const VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20";
const WASM_CDN = `${VISION_CDN}/wasm`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const PALM = [0, 5, 9, 17];
const FINGERTIPS = [4, 8, 12, 16, 20];

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
  const { leftHand: lh, rightHand: rh } = points;
  const leftSeen = inFrame(lh, 0.5);
  const rightSeen = inFrame(rh, 0.5);
  const handsOk = leftSeen && rightSeen;
  const handsStrong = inFrame(lh, 0.6) && inFrame(rh, 0.6);
  let quality = "lost";
  if (handsStrong) quality = "stable";
  else if (leftSeen || rightSeen) quality = "weak";
  return { handsOk, quality };
}

function palmPoint(landmarks, score) {
  const pts = PALM.map((index) => landmarks[index]).filter(Boolean);
  if (pts.length < 3) return null;
  const x = pts.reduce((sum, point) => sum + point.x, 0) / pts.length;
  const y = pts.reduce((sum, point) => sum + point.y, 0) / pts.length;
  return mirrorPoint({ x, y, visibility: score });
}

function cameraErrorMessage(error) {
  const name = error && error.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was denied. Allow camera access in the browser site settings, then try again. Keyboard mode is ready whenever you are.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found. Plug in a webcam, start NVIDIA Broadcast, or play with the keyboard.";
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
    this.deviceId = "";
  }

  async listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === "videoinput" && device.deviceId);
    } catch {
      return [];
    }
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
      const failure = new Error("The hand tracker could not be downloaded. Check your connection. Keyboard mode still works.");
      failure.cause = error;
      throw failure;
    }
    const { HandLandmarker, FilesetResolver } = visionModule;
    let fileset;
    try {
      fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    } catch (error) {
      const failure = new Error("Hand tracking files could not be loaded. Check your connection. Keyboard mode still works.");
      failure.cause = error;
      throw failure;
    }
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options("CPU"));
      } catch (error) {
        const failure = new Error("The hand model could not be loaded. Check your connection and try again. Keyboard mode still works.");
        failure.cause = error;
        throw failure;
      }
    }
  }

  async enable(options = {}) {
    const deviceId = typeof options.deviceId === "string" ? options.deviceId : "";
    const preferBroadcast = !deviceId && options.preferBroadcast !== false;
    if (this.active && this.stream && (!deviceId || deviceId === this.deviceId)) {
      const devices = await this.listCameras();
      return { ok: true, deviceId: this.deviceId, devices };
    }
    const run = (this._starting || Promise.resolve()).then(() => this._enable(deviceId, preferBroadcast));
    this._starting = run;
    try {
      return await run;
    } finally {
      if (this._starting === run) this._starting = null;
    }
  }

  async _openStream(deviceId) {
    const sized = {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30, max: 30 },
    };
    // Virtual cameras such as NVIDIA Broadcast do not report facingMode.
    // Asking for a user-facing camera hides them from Chrome, Edge, and Firefox.
    const attempts = deviceId
      ? [
        { audio: false, video: { deviceId: { exact: deviceId }, ...sized } },
        { audio: false, video: { deviceId: { exact: deviceId } } },
      ]
      : [
        { audio: false, video: sized },
        { audio: false, video: true },
      ];
    let lastError;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
        const name = error && error.name;
        if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") throw error;
      }
    }
    throw lastError;
  }

  _releaseStream() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }

  _trackDeviceId(stream) {
    const [track] = stream.getVideoTracks();
    const settings = track && track.getSettings ? track.getSettings() : null;
    return (settings && settings.deviceId) || "";
  }

  _watchTrack(stream) {
    const [track] = stream.getVideoTracks();
    if (!track) return;
    track.onended = () => {
      if (!this.active || this.stream !== stream) return;
      this.active = false;
      this.snapshot = null;
      this.error = "The camera disconnected. Reconnect it, or switch to keyboard controls.";
      if (this.onDisconnect) this.onDisconnect(this.error);
    };
  }

  async _play(stream) {
    this.stream = stream;
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    this._watchTrack(stream);
    this.deviceId = this._trackDeviceId(stream);
    this.active = true;
    this.lastTs = -1;
    this._lastInfer = 0;
  }

  async _enable(deviceId, preferBroadcast) {
    this.error = null;
    if (!window.isSecureContext) {
      this.error = "Camera access needs localhost or HTTPS. Keyboard mode does not need a camera.";
      return { ok: false, message: this.error, devices: [] };
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.error = "This browser cannot open a camera. Play with the keyboard, or use a current version of Chrome, Edge, or Firefox.";
      return { ok: false, message: this.error, devices: [] };
    }
    if (this.active && this.stream && deviceId && deviceId === this.deviceId) {
      const devices = await this.listCameras();
      return { ok: true, deviceId: this.deviceId, devices };
    }

    const previousId = this.deviceId;
    this.active = false;
    this._releaseStream();

    let stream;
    try {
      stream = await this._openStream(deviceId);
    } catch (error) {
      const denied = error && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError" || error.name === "SecurityError");
      if (!denied) {
        try {
          stream = await this._openStream("");
        } catch (fallbackError) {
          this.stop();
          this.error = cameraErrorMessage(fallbackError);
          return { ok: false, message: this.error, devices: await this.listCameras() };
        }
      } else {
        this.stop();
        this.error = cameraErrorMessage(error);
        return { ok: false, message: this.error, devices: [] };
      }
    }

    try {
      await this.loadModel();
      await this._play(stream);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
      if (this.video) this.video.srcObject = null;
      this.active = false;
      if (previousId && previousId !== deviceId) {
        try {
          const restored = await this._openStream(previousId);
          await this._play(restored);
          const devices = await this.listCameras();
          this.error = "That camera could not be opened. The previous camera is still on.";
          return { ok: false, message: this.error, deviceId: this.deviceId, devices };
        } catch {
          this.stop();
        }
      }
      this.error = error && error.message && error.message.includes("hand")
        ? error.message
        : (error && error.name === "NotAllowedError"
          ? cameraErrorMessage(error)
          : "The camera preview could not start. Try the enable button again, or play with the keyboard.");
      return { ok: false, message: this.error, devices: await this.listCameras() };
    }

    let devices = await this.listCameras();
    const broadcast = devices.find((device) => /nvidia\s*broadcast/i.test(device.label || ""));
    const shouldUseBroadcast = preferBroadcast && broadcast && broadcast.deviceId && broadcast.deviceId !== this.deviceId;
    const requestedMissing = deviceId && deviceId !== this.deviceId && devices.some((device) => device.deviceId === deviceId);
    const switchId = shouldUseBroadcast ? broadcast.deviceId : (requestedMissing ? deviceId : "");
    if (switchId) {
      const openedId = this.deviceId;
      this.active = false;
      this._releaseStream();
      try {
        const switched = await this._openStream(switchId);
        await this._play(switched);
        devices = await this.listCameras();
      } catch {
        try {
          const restored = await this._openStream(openedId);
          await this._play(restored);
        } catch {
          this.stop();
          this.error = cameraErrorMessage(new DOMException("", "NotReadableError"));
          return { ok: false, message: this.error, devices };
        }
      }
    }

    return { ok: true, deviceId: this.deviceId, devices };
  }

  stop() {
    this.active = false;
    this.busy = false;
    this.snapshot = null;
    this.deviceId = "";
    this._releaseStream();
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
        console.error("Hand inference failed", error);
      }
    } finally {
      this.busy = false;
    }
  }

  _parse(result) {
    const empty = {
      leftHand: null,
      rightHand: null,
      leftFingers: [],
      rightFingers: [],
      handsOk: false,
      quality: "lost",
    };
    const landmarks = result && result.landmarks;
    if (!landmarks || !landmarks.length) return empty;
    const hands = [];
    for (let i = 0; i < landmarks.length; i += 1) {
      const lm = landmarks[i];
      const category = result.handedness && result.handedness[i] && result.handedness[i][0];
      const score = category && typeof category.score === "number" ? category.score : 1;
      const palm = palmPoint(lm, score);
      if (!palm) continue;
      const fingers = FINGERTIPS
        .map((index) => (lm[index] ? mirrorPoint({ ...lm[index], visibility: score }) : null))
        .filter(Boolean);
      hands.push({ palm, fingers });
    }
    if (!hands.length) return empty;
    hands.sort((a, b) => a.palm.x - b.palm.x);
    let leftHand = null;
    let rightHand = null;
    let leftFingers = [];
    let rightFingers = [];
    if (hands.length === 1) {
      if (hands[0].palm.x < 0.5) {
        leftHand = hands[0].palm;
        leftFingers = hands[0].fingers;
      } else {
        rightHand = hands[0].palm;
        rightFingers = hands[0].fingers;
      }
    } else {
      leftHand = hands[0].palm;
      rightHand = hands[hands.length - 1].palm;
      leftFingers = hands[0].fingers;
      rightFingers = hands[hands.length - 1].fingers;
    }
    return { leftHand, rightHand, leftFingers, rightFingers, ...assessPose({ leftHand, rightHand }) };
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
    const lw = snap && snap.leftHand;
    const rw = snap && snap.rightHand;

    const mark = (point, radius, strong) => {
      if (!point) return;
      ctx.beginPath();
      ctx.fillStyle = strong ? color : "rgba(232, 244, 255, 0.75)";
      ctx.arc(point.x * cw, point.y * ch, radius, 0, Math.PI * 2);
      ctx.fill();
    };
    if (snap) {
      for (const finger of [...(snap.leftFingers || []), ...(snap.rightFingers || [])]) {
        mark(finger, 3, false);
      }
    }
    if (lw && rw && snap.handsOk) {
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
