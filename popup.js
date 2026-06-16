// Meet White Balance Fix — popup (UI)
// Reads/writes parameters and presets in chrome.storage.local. Propagation to
// the engine is handled by bridge.js, which listens to storage.onChanged.
"use strict";

const DEFAULTS = {
  enabled: true, temperature: 0, r: 1, g: 1, b: 1,
  brightness: 0, contrast: 0, saturation: 0,
};

const SLIDERS = [
  { key: "temperature", label: "Temperature", min: -100, max: 100, step: 1 },
  { key: "r", label: "Gain R", min: 0, max: 2, step: 0.01 },
  { key: "g", label: "Gain G", min: 0, max: 2, step: 0.01 },
  { key: "b", label: "Gain B", min: 0, max: 2, step: 0.01 },
  { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1 },
  { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1 },
  { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1 },
];

// Built-in presets. "Neutral 3100K" compensates the auto-WB yellow in software
// (measured: R106 G98 B78 → gains that rebalance to R≈G≈B).
const BUILTIN = {
  "None": { ...DEFAULTS },
  "Neutral 3100K": { ...DEFAULTS, r: 0.92, g: 1.0, b: 1.26 },
  "Warm": { ...DEFAULTS, temperature: 40 },
  "Cool": { ...DEFAULTS, temperature: -40 },
};

let params = { ...DEFAULTS };
let custom = {};

const $ = (id) => document.getElementById(id);
const fmt = (v, step) => (+v).toFixed(step < 1 ? 2 : 0);
const saveParams = () => chrome.storage.local.set({ params });

function renderSliders() {
  const box = $("sliders");
  box.innerHTML = "";
  for (const s of SLIDERS) {
    const wrap = document.createElement("div");
    wrap.className = "slider";

    const lab = document.createElement("label");
    lab.textContent = s.label;

    const input = document.createElement("input");
    input.type = "range";
    input.min = s.min; input.max = s.max; input.step = s.step;
    input.value = params[s.key];

    const val = document.createElement("span");
    val.className = "val";
    val.textContent = fmt(params[s.key], s.step);

    input.addEventListener("input", () => {
      params[s.key] = parseFloat(input.value);
      val.textContent = fmt(params[s.key], s.step);
      saveParams();
    });

    wrap.append(lab, input, val);
    box.appendChild(wrap);
  }
}

function refreshPresetSelect() {
  const sel = $("preset");
  sel.innerHTML = "";
  const head = document.createElement("option");
  head.value = ""; head.textContent = "— presets —";
  head.disabled = true; head.selected = true;
  sel.appendChild(head);

  const addGroup = (label, obj, isCustom) => {
    const names = Object.keys(obj);
    if (!names.length) return;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const name of names) {
      const o = document.createElement("option");
      o.value = (isCustom ? "c:" : "b:") + name;
      o.textContent = name;
      g.appendChild(o);
    }
    sel.appendChild(g);
  };
  addGroup("Built-in", BUILTIN, false);
  addGroup("Custom", custom, true);
}

function applyPreset(preset) {
  params = { ...DEFAULTS, ...preset, enabled: params.enabled };
  $("enabled").checked = params.enabled;
  renderSliders();
  saveParams();
}

function init() {
  chrome.storage.local.get(["params", "customPresets"], (res) => {
    params = { ...DEFAULTS, ...(res.params || {}) };
    custom = res.customPresets || {};
    $("enabled").checked = params.enabled;
    renderSliders();
    refreshPresetSelect();
  });

  $("enabled").addEventListener("change", () => {
    params.enabled = $("enabled").checked;
    saveParams();
  });

  $("preset").addEventListener("change", (e) => {
    const v = e.target.value;
    if (!v) return;
    const kind = v.slice(0, 1);
    const name = v.slice(2);
    const src = kind === "c" ? custom : BUILTIN;
    if (src[name]) applyPreset(src[name]);
  });

  $("save").addEventListener("click", () => {
    const name = (prompt("Preset name:") || "").trim();
    if (!name) return;
    const { enabled, ...vals } = params;
    custom[name] = vals;
    chrome.storage.local.set({ customPresets: custom }, refreshPresetSelect);
  });

  $("delPreset").addEventListener("click", () => {
    const v = $("preset").value;
    if (v.slice(0, 1) !== "c") return; // only delete user presets
    delete custom[v.slice(2)];
    chrome.storage.local.set({ customPresets: custom }, refreshPresetSelect);
  });

  $("reset").addEventListener("click", () => applyPreset(BUILTIN["None"]));
}

init();
