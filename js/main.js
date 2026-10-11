import { AudioEngine } from "./audio.js";
import { Game } from "./game.js";
import { PoseTracker } from "./pose-tracker.js";
import { Renderer } from "./renderer.js";
import { SteeringController } from "./steering.js";
import { loadSave, writeSave } from "./storage.js";

const $ = (id) => document.getElementById(id);

const game = new Game();
const steering = new SteeringController();
const audio = new AudioEngine();
const renderer = new Renderer($("game-canvas"));
const pose = new PoseTracker($("webcam"));

let save = loadSave();
let state = "MENU";
let mode = "keyboard";
let setupStep = 1;
let flow = "onboarding";
let sensitivity = save.sensitivity;
let kbSteer = 0;
let poseHold = 0;
let positionReady = false;
let uiAcc = 0;
let last = 0;
let raf = 0;
let running = false;
let toastTimer = 0;
let finished = false;

const held = new Set();
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = motionQuery.matches;

const countdown = { elapsed: 0, label: "" };

pose.onDisconnect = (message) => {
  showToast(message);
  $("camera-error").hidden = false;
  $("camera-error").textContent = message;
  if (mode === "camera" && state === "PLAYING") {
    pauseGame();
    $("pause-note").textContent = message;
  }
  setLive(message);
};

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function formatInt(n) {
  return Math.floor(n).toLocaleString("en-US");
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.floor(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function setLive(message) {
  $("live-region").textContent = message;
}

function showToast(message) {
  const toast = $("toast");
  toast.hidden = false;
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

function setState(next) {
  state = next;
  document.body.dataset.state = next;
  if (next !== "GAME_OVER") finished = false;
  showOverlays();
}

function showOverlays() {
  $("overlay-menu").hidden = state !== "MENU";
  $("overlay-pause").hidden = state !== "PAUSED";
  $("overlay-over").hidden = state !== "GAME_OVER";
  $("overlay-countdown").hidden = state !== "COUNTDOWN";
  const setup = state === "CAMERA_SETUP" || state === "CALIBRATING";
  $("overlay-setup").hidden = !setup;
  if (setup) showSetupStep();
  const pauseVisible = state === "PLAYING" || state === "PAUSED";
  $("btn-pause").hidden = !pauseVisible;
  $("btn-pause").textContent = state === "PAUSED" ? "Resume" : "Pause";
  $("btn-pause").setAttribute("aria-label", state === "PAUSED" ? "Resume game" : "Pause game");
  syncModeButtons();
}

function showSetupStep() {
  for (let step = 1; step <= 3; step += 1) {
    $(`step-${step}`).hidden = setupStep !== step;
  }
  $("overlay-setup").dataset.step = String(setupStep);
  const titles = ["Camera", "Position", "Calibrate"];
  $("setup-title").textContent = flow === "recalibrate" && setupStep === 3 ? "Recalibrate" : titles[setupStep - 1];
  $("setup-kicker").textContent = flow === "recalibrate" ? "Steering" : `Step ${setupStep} of 3`;
  if (setupStep === 1) updateCameraActions();
}

function syncSoundButtons() {
  const label = save.sound ? "Sound on" : "Sound off";
  for (const id of ["btn-menu-sound", "btn-sound", "btn-pause-sound"]) {
    const button = $(id);
    button.textContent = label;
    button.setAttribute("aria-pressed", String(save.sound));
  }
}

function syncModeButtons() {
  const camera = mode === "camera";
  $("btn-mode-camera").classList.toggle("is-active", camera);
  $("btn-mode-keyboard").classList.toggle("is-active", !camera);
  $("btn-mode-camera").setAttribute("aria-pressed", String(camera));
  $("btn-mode-keyboard").setAttribute("aria-pressed", String(!camera));
  $("btn-switch-mode").textContent = camera ? "Switch to keyboard" : "Switch to camera";
  $("control-hint").textContent = camera
    ? "Turn the wheel in the air. Space pauses. Esc opens the pause menu."
    : "A/D or arrow keys steer. The car cruises. W speeds up, S brakes. Space pauses.";
  document.body.dataset.mode = mode;
}

function setSound(on) {
  save = writeSave({ sound: on });
  audio.setEnabled(save.sound);
  syncSoundButtons();
}

function updateCameraActions() {
  const live = pose.active;
  const ready = live && steering.calibrated;
  $("btn-enable-camera").textContent = live ? "Camera on" : "Enable camera";
  $("btn-step1-next").hidden = !live;
  $("btn-step1-recal").hidden = !ready;
}

function directionLabel(value) {
  if (value < -0.12) return "Left";
  if (value > 0.12) return "Right";
  return "Straight";
}

function inputFor(dt) {
  if (mode === "keyboard") {
    const target = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
    const alpha = 1 - Math.exp(-8 * Math.max(0, dt));
    kbSteer += (target - kbSteer) * alpha;
    if (Math.abs(kbSteer) < 0.001) kbSteer = 0;
    return { steer: kbSteer, accel: held.has("up"), brake: held.has("down") };
  }
  return { steer: steering.steer, accel: false, brake: false };
}

function beginCountdown() {
  game.reset();
  game.demo = false;
  game.practice = false;
  countdown.elapsed = 0;
  countdown.label = "";
  setState("COUNTDOWN");
  $("countdown-label").textContent = "3";
  $("countdown-label").classList.remove("is-go");
  audio.playCountdown("3");
  countdown.label = "3";
}

function updateCountdown(dt) {
  countdown.elapsed += dt;
  const labels = ["3", "2", "1", "GO"];
  const index = Math.min(3, Math.floor(countdown.elapsed / 0.85));
  const label = labels[index];
  if (label !== countdown.label) {
    countdown.label = label;
    $("countdown-label").textContent = label;
    $("countdown-label").classList.toggle("is-go", label === "GO");
    audio.playCountdown(label);
  }
  const preview = inputFor(dt);
  game.steer = preview.steer;
  game.playerX += (clamp(preview.steer, -1, 1) * 0.45 - game.playerX) * Math.min(1, dt * 3);
  if (countdown.elapsed >= 3.45) {
    game.speed = 20;
    game.playerX = clamp(game.playerX, -0.4, 0.4);
    setState("PLAYING");
    $("stage").focus();
    setLive("Go.");
  }
}

function pauseGame() {
  if (state !== "PLAYING") return;
  setState("PAUSED");
  audio.setEngine(0, false);
  $("pause-note").textContent = "The road is frozen.";
  $("btn-resume").focus();
}

function resumeGame() {
  if (state !== "PAUSED") return;
  last = 0;
  setState("PLAYING");
  $("stage").focus();
}

function finishGame() {
  if (finished) return;
  finished = true;
  const score = Math.floor(game.score);
  const record = score > save.bestScore && score > 0;
  if (record) save = writeSave({ bestScore: score });
  $("over-title").textContent = record ? "New record" : "Run complete";
  $("over-record").hidden = !record;
  $("over-score").textContent = formatInt(score);
  $("over-distance").textContent = formatDistance(game.position);
  $("over-coins").textContent = formatInt(game.coins);
  $("over-collisions").textContent = String(game.collisions);
  $("over-top").textContent = `${Math.round(game.topSpeed * 3.6)} km/h`;
  $("over-time").textContent = formatTime(game.timeAlive);
  $("over-best").textContent = formatInt(save.bestScore);
  $("menu-best").textContent = formatInt(save.bestScore);
  $("hud-best").textContent = formatInt(save.bestScore);
  setState("GAME_OVER");
  audio.playGameOver();
  setLive(record ? `New record, ${formatInt(score)}.` : `Run complete. Score ${formatInt(score)}.`);
  $("btn-again").focus();
}

function clearPreview() {
  const canvas = $("preview-canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#071018";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function toMenu() {
  pose.stop();
  clearPreview();
  game.reset();
  game.demo = true;
  game.speed = 36;
  mode = "keyboard";
  kbSteer = 0;
  audio.setEngine(0, false);
  setState("MENU");
  $("btn-play-camera").focus();
}

function startCalibration(nextFlow) {
  flow = nextFlow;
  steering.beginCalibration();
  setupStep = 3;
  $("calib-status").textContent = "Hold the imaginary wheel straight and keep still.";
  $("calib-progress").style.width = "0%";
  $("calib-progress-bar").setAttribute("aria-valuenow", "0");
  setState("CALIBRATING");
}

function playAgain() {
  audio.unlock();
  if (mode === "camera" && (!pose.active || !steering.calibrated)) {
    flow = "onboarding";
    if (pose.active) startCalibration("onboarding");
    else {
      setupStep = 1;
      setState("CAMERA_SETUP");
    }
    return;
  }
  beginCountdown();
}

function fillCameraList(devices, selectedId) {
  const select = $("camera-select");
  const picker = $("camera-picker");
  if (!devices.length) {
    picker.hidden = true;
    return;
  }
  const current = selectedId || select.value;
  select.replaceChildren();
  for (const device of devices) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || "Camera";
    select.append(option);
  }
  if (devices.some((device) => device.deviceId === current)) select.value = current;
  picker.hidden = false;
}

async function refreshCameraList() {
  const devices = await pose.listCameras();
  const labeled = devices.some((device) => device.label);
  if (!labeled && !pose.active) {
    $("camera-picker").hidden = true;
    return;
  }
  fillCameraList(devices, pose.deviceId || save.cameraId);
}

async function enableCamera(deviceId) {
  audio.unlock();
  const button = $("btn-enable-camera");
  const requested = typeof deviceId === "string" ? deviceId : (save.cameraId || "");
  button.disabled = true;
  button.textContent = pose.active ? "Switching camera…" : "Starting camera…";
  $("camera-error").hidden = true;
  const result = await pose.enable({
    deviceId: requested,
    preferBroadcast: !requested,
  });
  button.disabled = false;
  fillCameraList(result.devices || [], result.deviceId || requested);
  if (!result.ok && !pose.active) {
    button.textContent = "Enable camera";
    $("camera-error").hidden = false;
    $("camera-error").textContent = result.message;
    setLive(result.message);
    return;
  }
  if (result.deviceId) save = writeSave({ cameraId: result.deviceId });
  if (!result.ok && result.message) {
    $("camera-error").hidden = false;
    $("camera-error").textContent = result.message;
  }
  mode = "camera";
  syncModeButtons();
  updateCameraActions();
  const selected = $("camera-select").selectedOptions[0];
  const name = selected ? selected.textContent : "Camera";
  setLive(`${name} on. Keep both hands in view.`);
}

function selectKeyboard() {
  audio.unlock();
  mode = "keyboard";
  syncModeButtons();
  if (state === "PLAYING") pauseGame();
}

function selectCamera() {
  audio.unlock();
  if (state === "PLAYING") pauseGame();
  mode = "camera";
  syncModeButtons();
  if (!pose.active || !steering.calibrated) {
    flow = state === "PAUSED" ? "recalibrate" : "onboarding";
    if (!pose.active) {
      setupStep = 1;
      setState("CAMERA_SETUP");
    } else {
      startCalibration(flow);
    }
  }
}

function requestCalibrate() {
  audio.unlock();
  if (state === "PLAYING") pauseGame();
  const nextFlow = state === "PAUSED" ? "recalibrate" : "onboarding";
  mode = "camera";
  syncModeButtons();
  if (!pose.active) {
    flow = nextFlow;
    setupStep = 1;
    setState("CAMERA_SETUP");
    showToast("Enable the camera, then hold the wheel straight.");
    return;
  }
  startCalibration(nextFlow);
}

function runCalibration(now) {
  const result = steering.sampleCalibration(pose.snapshot, now);
  $("calib-status").textContent = result.message;
  const pct = Math.round((result.progress || 0) * 100);
  $("calib-progress").style.width = `${pct}%`;
  $("calib-progress-bar").setAttribute("aria-valuenow", String(pct));
  if (result.status !== "success") return;
  setLive(result.message);
  if (flow === "recalibrate") {
    setState("PAUSED");
    $("pause-note").textContent = "Steering calibrated. Resume when you are ready.";
    return;
  }
  beginCountdown();
}

function refreshTracking() {
  const snap = pose.snapshot;
  let quality = pose.active ? steering.quality : "lost";
  let message = pose.active ? steering.message : "Camera off";
    if (mode === "keyboard" && !pose.active) {
      quality = "idle";
      message = "Keyboard control";
    } else if (mode === "keyboard" && (state === "PLAYING" || state === "PAUSED" || state === "COUNTDOWN" || state === "GAME_OVER")) {
      message = `Keyboard control. ${steering.message}`;
    }
  $("tracking-dot").dataset.quality = quality;
  if ($("tracking-text").textContent !== message) $("tracking-text").textContent = message;
  const activeSteer = mode === "camera" ? steering.steer : kbSteer;
  const shownAngle = steering.calibrated ? steering.relativeDeg : steering.angleDeg;
  $("steer-needle").style.transform = `rotate(${clamp(shownAngle, -55, 55)}deg)`;
  $("steer-direction").textContent = directionLabel(activeSteer);
  $("debug-angle").textContent = `${steering.angleDeg.toFixed(1)}°`;
  $("debug-neutral").textContent = steering.calibrated ? `${steering.neutral.toFixed(1)}°` : "Not set";
  $("debug-relative").textContent = `${steering.relativeDeg.toFixed(1)}°`;
  $("debug-steer").textContent = activeSteer.toFixed(2);
  $("debug-quality").textContent = quality === "stable" ? "Stable" : quality === "weak" ? "Weak" : "Lost";
}

function refreshSetup(dt) {
  if (state === "CAMERA_SETUP" && setupStep === 1) updateCameraActions();
  if (!(state === "CAMERA_SETUP" && setupStep === 2)) {
    poseHold = 0;
    positionReady = false;
    return;
  }
  const snap = pose.snapshot;
  const wrists = Boolean(snap && snap.wristOk);
  setCheck("check-wrists", "Wrists", wrists);
  if (!positionReady) {
    poseHold = wrists ? poseHold + dt : 0;
    if (poseHold > 0.35) positionReady = true;
  }
  const button = $("btn-step2-next");
  button.disabled = !positionReady;
  button.textContent = positionReady ? "Next" : "Hold that pose";
}

function setCheck(id, label, ok) {
  const item = $(id);
  item.textContent = `${label}: ${ok ? "visible" : "not in view"}`;
  item.classList.toggle("is-ok", ok);
  item.classList.toggle("is-bad", !ok);
}

function refreshHud() {
  const score = Math.floor(game.demo || game.practice ? 0 : game.score);
  $("hud-score").textContent = formatInt(score);
  $("hud-coins").textContent = formatInt(game.demo || game.practice ? 0 : game.coins);
  $("hud-speed").textContent = String(Math.round(game.speed * 3.6));
  $("hud-best").textContent = formatInt(save.bestScore);
  const pips = $("hud-lives").children;
  for (let i = 0; i < pips.length; i += 1) pips[i].classList.toggle("is-spent", i >= game.lives);
  $("hud-lives").setAttribute("aria-label", `${game.lives} lives remaining`);
  const boosting = state === "PLAYING" && game.boostTimer > 0.05;
  $("hud-boost").hidden = !boosting;
  if (boosting) $("hud-boost").textContent = `Boost ${game.boostTimer.toFixed(1)}s`;
  $("offroad-banner").hidden = !(state === "PLAYING" && game.offRoad);
}

function playEventSounds() {
  if (!game.events.length || state !== "PLAYING") return;
  for (let i = 0; i < game.events.length; i += 1) {
    const event = game.events[i];
    if (event.type === "coin") audio.playCoin();
    else if (event.type === "boost") audio.playBoost();
    else if (event.type === "hit") {
      audio.playCollision();
      setLive(game.lives > 0 ? `Collision. ${game.lives} lives left.` : "Collision. That's the last life.");
    } else if (event.type === "offroad") audio.playOffroad();
  }
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  if (dt < 0 || dt > 0.05) dt = Math.min(Math.max(dt, 0), 0.05);

  if (pose.active) pose.requestFrame(now);
  if (pose.active || mode === "camera") steering.update(pose.snapshot, dt, sensitivity);

  if (state === "PLAYING") {
    game.update(dt, inputFor(dt));
    playEventSounds();
    if (game.over) finishGame();
  } else if (state === "COUNTDOWN") {
    updateCountdown(dt);
  } else if (state === "CALIBRATING") {
    runCalibration(now);
    if (game.demo) game.update(dt, { steer: game.getDemoSteer(), accel: false, brake: false });
  } else if (game.demo && (state === "MENU" || state === "CAMERA_SETUP")) {
    game.update(dt, { steer: game.getDemoSteer(), accel: false, brake: false });
  }

  const engineOn = save.sound && state === "PLAYING";
  audio.setEngine(game.speed, engineOn);

  renderer.reducedMotion = reducedMotion;
  renderer.render(game, state === "PAUSED" ? 0 : dt);
  if (pose.active || state === "CAMERA_SETUP" || state === "CALIBRATING") {
    pose.drawPreview($("preview-canvas"), steering);
  }
  renderer.emit(game);

  uiAcc += dt;
  if (uiAcc >= 0.1) {
    refreshHud();
    refreshTracking();
    refreshSetup(uiAcc);
    uiAcc = 0;
  }
}

function startLoop() {
  if (running) return;
  running = true;
  last = 0;
  raf = requestAnimationFrame(frame);
}

function bindHold(button, code) {
  const press = (event) => {
    event.preventDefault();
    held.add(code);
    button.classList.add("is-held");
    try { button.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
  };
  const release = () => {
    held.delete(code);
    button.classList.remove("is-held");
  };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
}

function onKeyDown(event) {
  const field = event.target.closest("input, textarea, select");
  if (field) return;
  const map = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    KeyA: "left",
    KeyD: "right",
    KeyW: "up",
    KeyS: "down",
  };
  if (map[event.code] && (state === "PLAYING" || state === "COUNTDOWN")) {
    if (mode === "keyboard" || event.code === "ArrowUp" || event.code === "ArrowDown" || event.code === "KeyW" || event.code === "KeyS") {
      event.preventDefault();
      held.add(map[event.code]);
    } else {
      event.preventDefault();
    }
  }
  if (event.code === "Space") {
    const onButton = event.target.closest("button, a, summary");
    if (!onButton && (state === "PLAYING" || state === "PAUSED")) {
      event.preventDefault();
      if (state === "PLAYING") pauseGame();
      else resumeGame();
    }
  }
  if (event.code === "Escape") {
    event.preventDefault();
    if (state === "PLAYING") pauseGame();
    else if (state === "PAUSED") resumeGame();
    else if ((state === "CALIBRATING" || state === "CAMERA_SETUP") && flow === "recalibrate") setState("PAUSED");
    else if (state === "COUNTDOWN" || state === "CAMERA_SETUP" || state === "CALIBRATING") toMenu();
  }
}

function onKeyUp(event) {
  const map = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    KeyA: "left",
    KeyD: "right",
    KeyW: "up",
    KeyS: "down",
  };
  if (map[event.code]) held.delete(map[event.code]);
}

function init() {
  audio.setEnabled(save.sound);
  sensitivity = save.sensitivity;
  $("sensitivity").value = String(sensitivity);
  $("sensitivity-value").textContent = `${sensitivity.toFixed(2)}×`;
  $("menu-best").textContent = formatInt(save.bestScore);
  $("hud-best").textContent = formatInt(save.bestScore);
  syncSoundButtons();
  game.reset();
  game.demo = true;
  game.speed = 36;
  setState("MENU");
  renderer.resize();

  $("btn-play-camera").addEventListener("click", () => {
    audio.unlock();
    mode = "camera";
    flow = "onboarding";
    setupStep = 1;
    syncModeButtons();
    setState("CAMERA_SETUP");
  });
  $("btn-play-keyboard").addEventListener("click", () => {
    audio.unlock();
    mode = "keyboard";
    syncModeButtons();
    beginCountdown();
  });
  $("btn-menu-sound").addEventListener("click", () => { audio.unlock(); setSound(!save.sound); });
  $("btn-sound").addEventListener("click", () => { audio.unlock(); setSound(!save.sound); });
  $("btn-pause-sound").addEventListener("click", () => { audio.unlock(); setSound(!save.sound); });
  $("btn-enable-camera").addEventListener("click", () => { enableCamera(); });
  $("camera-select").addEventListener("change", () => {
    const id = $("camera-select").value;
    save = writeSave({ cameraId: id });
    if (pose.active) enableCamera(id);
  });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => { refreshCameraList(); });
  }
  $("btn-step1-next").addEventListener("click", () => { setupStep = 2; showSetupStep(); });
  $("btn-step1-recal").addEventListener("click", () => startCalibration("onboarding"));
  $("btn-step1-keyboard").addEventListener("click", () => {
    audio.unlock();
    mode = "keyboard";
    syncModeButtons();
    beginCountdown();
  });
  $("btn-step2-back").addEventListener("click", () => { setupStep = 1; showSetupStep(); });
  $("btn-step2-next").addEventListener("click", () => startCalibration("onboarding"));
  $("btn-step3-back").addEventListener("click", () => {
    if (flow === "recalibrate") setState("PAUSED");
    else { setupStep = 2; setState("CAMERA_SETUP"); }
  });
  $("btn-setup-close").addEventListener("click", () => {
    audio.unlock();
    if (flow === "recalibrate") setState("PAUSED");
    else toMenu();
  });
  $("btn-pause").addEventListener("click", () => {
    audio.unlock();
    if (state === "PLAYING") pauseGame();
    else if (state === "PAUSED") resumeGame();
  });
  $("btn-resume").addEventListener("click", () => { audio.unlock(); resumeGame(); });
  $("btn-restart").addEventListener("click", () => { audio.unlock(); playAgain(); });
  $("btn-recalibrate").addEventListener("click", requestCalibrate);
  $("btn-switch-mode").addEventListener("click", () => {
    if (mode === "camera") selectKeyboard();
    else selectCamera();
  });
  $("btn-quit").addEventListener("click", () => { audio.unlock(); toMenu(); });
  $("btn-again").addEventListener("click", playAgain);
  $("btn-over-menu").addEventListener("click", () => { audio.unlock(); toMenu(); });
  $("btn-mode-camera").addEventListener("click", selectCamera);
  $("btn-mode-keyboard").addEventListener("click", selectKeyboard);
  $("btn-calibrate").addEventListener("click", requestCalibrate);
  $("sensitivity").addEventListener("input", () => {
    sensitivity = Number($("sensitivity").value);
    $("sensitivity-value").textContent = `${sensitivity.toFixed(2)}×`;
  });
  $("sensitivity").addEventListener("change", () => {
    save = writeSave({ sensitivity });
  });

  bindHold($("touch-left"), "left");
  bindHold($("touch-right"), "right");
  bindHold($("touch-gas"), "up");
  bindHold($("touch-brake"), "down");

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => held.clear());
  window.addEventListener("resize", () => renderer.resize());
  document.addEventListener("visibilitychange", () => {
    last = 0;
    held.clear();
    if (document.hidden && state === "PLAYING") {
      pauseGame();
      $("pause-note").textContent = "Paused because this tab was hidden.";
      setLive("Paused because this tab was hidden.");
    }
  });
  window.addEventListener("pagehide", () => {
    running = false;
    cancelAnimationFrame(raf);
    pose.dispose();
    audio.close();
  });
  if (motionQuery.addEventListener) {
    motionQuery.addEventListener("change", () => { reducedMotion = motionQuery.matches; });
  }
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => renderer.resize());
    observer.observe($("stage"));
  }

  startLoop();
  $("btn-play-camera").focus();
}

init();
