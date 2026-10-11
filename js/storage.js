const KEY = "air-steering-wheel";

const DEFAULTS = {
  bestScore: 0,
  sound: true,
  sensitivity: 1,
};

let memory = null;

function clampSensitivity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.sensitivity;
  return Math.min(2, Math.max(0.5, Math.round(n * 100) / 100));
}

function sanitize(data) {
  return {
    bestScore: Math.max(0, Math.floor(Number(data.bestScore) || 0)),
    sound: Boolean(data.sound),
    sensitivity: clampSensitivity(data.sensitivity),
  };
}

export function loadSave() {
  if (memory) return { ...memory };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      memory = { ...DEFAULTS };
      return { ...memory };
    }
    memory = sanitize({ ...DEFAULTS, ...JSON.parse(raw) });
  } catch {
    memory = { ...DEFAULTS };
  }
  return { ...memory };
}

export function writeSave(partial) {
  const next = sanitize({ ...loadSave(), ...partial });
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode, disabled storage, or a full quota. The session copy still works.
  }
  return { ...memory };
}
