import {
  DEG, TAPERS, ELEMENTS, steeringPhases, afMag, pattern, beamMetrics, directivity, taperEfficiency,
  gratingFreeScan, failedElements, planarGrid, planarDirectivity, planarGratingLobes,
} from "./array.js";
import { C0, fspl, twoRay, breakpoint, logDistance, thermalNoise, cascade, sensitivity, sfdr, received } from "./rf.js";
import { C, fit, linePlot, polarPlot, heatmap, fmtNum } from "./plot.js";
import { encodeStages, decodeStages, MAX_STAGES, MAX_NAME } from "./share.js";

const $ = (s) => document.querySelector(s);
const db20 = (x) => 20 * Math.log10(Math.max(x, 1e-12));
const deg = (r) => r / DEG;

// ------------------------------------------------------------------ presets
const RX_PRESETS = {
  superhet: {
    label: "Superheterodyne receiver",
    stages: [
      { name: "Band filter", gain: -1.5, nf: 1.5, iip3: 40 },
      { name: "LNA", gain: 18, nf: 1.2, iip3: -2 },
      { name: "Image filter", gain: -2, nf: 2, iip3: 40 },
      { name: "Mixer", gain: -6, nf: 8, iip3: 12 },
      { name: "IF amplifier", gain: 25, nf: 5, iip3: 10 },
    ],
  },
  lnafirst: {
    label: "LNA at the antenna",
    stages: [
      { name: "LNA", gain: 20, nf: 1, iip3: -5 },
      { name: "10 m cable", gain: -6, nf: 6, iip3: 50 },
      { name: "Receiver", gain: 30, nf: 8, iip3: 0 },
    ],
  },
  cablefirst: {
    label: "Cable before the LNA",
    stages: [
      { name: "10 m cable", gain: -6, nf: 6, iip3: 50 },
      { name: "LNA", gain: 20, nf: 1, iip3: -5 },
      { name: "Receiver", gain: 30, nf: 8, iip3: 0 },
    ],
  },
  zeroif: {
    label: "Direct conversion",
    stages: [
      { name: "LNA", gain: 15, nf: 2, iip3: -8 },
      { name: "I/Q mixer", gain: 10, nf: 12, iip3: 5 },
      { name: "Baseband VGA", gain: 30, nf: 15, iip3: 0 },
    ],
  },
};

const ARRAY_PRESETS = [
  ["Radar · Taylor −35 dB", { N: 32, d: 0.5, steer: 0, taper: "taylor", sll: 35, nbar: 5, element: "cosine", bits: 0, fail: 0, freq: 10 }],
  ["Grating lobes", { N: 12, d: 1.0, steer: 25, taper: "uniform", element: "isotropic", bits: 0, fail: 0 }],
  ["2-bit phase shifters", { N: 32, d: 0.5, steer: 8, taper: "uniform", element: "isotropic", bits: 2, fail: 0 }],
  ["mmWave 8 × @ 28 GHz", { N: 8, d: 0.5, steer: 30, taper: "uniform", element: "cosine", bits: 0, fail: 0, freq: 28 }],
  ["Broken elements", { N: 32, d: 0.5, steer: 0, taper: "chebyshev", sll: 40, element: "isotropic", bits: 0, fail: 20 }],
];

// -------------------------------------------------------------------- state
const DEFAULTS = {
  array: { N: 16, d: 0.5, steer: 20, taper: "taylor", sll: 30, nbar: 4, element: "isotropic", bits: 0, fail: 0, freq: 10, range: 50 },
  planar: { Nx: 12, Ny: 12, dx: 0.5, dy: 0.5, theta: 30, phi: 45, taper: "taylor", sll: 30, range: 45 },
  link: { freq: 2.4, pt: 20, gt: 6, gr: 3, dist: 2000, loss: 3, model: "tworay", ht: 20, hr: 1.5, n: 3, bw: 20, nf: 6, snr: 10 },
  rx: { preset: "superhet", bw: 20, snr: 10 },
};
const state = JSON.parse(JSON.stringify(DEFAULTS));
let active = "array";
let stages = JSON.parse(JSON.stringify(RX_PRESETS.superhet.stages));

const labels = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.label]));
const fmtDist = (m) => (m >= 1000 ? `${fmtNum(+(m / 1000).toPrecision(3))} km` : `${fmtNum(+m.toPrecision(3))} m`);
const fmtBw = (mhz) => (mhz >= 1 ? `${fmtNum(+mhz.toPrecision(3))} MHz` : `${fmtNum(+(mhz * 1000).toPrecision(3))} kHz`);
const logSlider = { toSlider: (v) => Math.log10(v), fromSlider: (s) => +(10 ** s).toPrecision(4) };

const SPECS = {
  array: [
    { key: "N", label: "Elements N", min: 2, max: 64, step: 1 },
    { key: "d", label: "Spacing d / λ", min: 0.1, max: 1.5, step: 0.01, fmt: (v) => v.toFixed(2) },
    { key: "steer", label: "Steering angle θ₀", min: -80, max: 80, step: 1, fmt: (v) => `${v}°` },
    { key: "taper", label: "Amplitude taper", options: labels(TAPERS) },
    { key: "sll", label: "Design sidelobe level", min: 15, max: 60, step: 1, fmt: (v) => `−${v} dB`, show: (s) => TAPERS[s.taper].usesSll },
    { key: "nbar", label: "Taylor n̄", min: 2, max: 8, step: 1, show: (s) => s.taper === "taylor" },
    { key: "element", label: "Element pattern", options: labels(ELEMENTS) },
    { key: "bits", label: "Phase-shifter resolution", min: 0, max: 6, step: 1, fmt: (v) => (v ? `${v} bit` : "ideal") },
    { key: "fail", label: "Failed elements", min: 0, max: 40, step: 1, fmt: (v) => `${v}%` },
    { key: "freq", label: "Frequency", min: 0.5, max: 40, step: 0.1, fmt: (v) => `${v.toFixed(1)} GHz` },
    { key: "range", label: "Plot dynamic range", min: 20, max: 80, step: 5, fmt: (v) => `${v} dB` },
  ],
  planar: [
    { key: "Nx", label: "Elements along x", min: 2, max: 32, step: 1 },
    { key: "Ny", label: "Elements along y", min: 2, max: 32, step: 1 },
    { key: "dx", label: "Spacing dx / λ", min: 0.2, max: 1.2, step: 0.01, fmt: (v) => v.toFixed(2) },
    { key: "dy", label: "Spacing dy / λ", min: 0.2, max: 1.2, step: 0.01, fmt: (v) => v.toFixed(2) },
    { key: "theta", label: "Scan angle θ₀", min: 0, max: 75, step: 1, fmt: (v) => `${v}°` },
    { key: "phi", label: "Scan azimuth φ₀", min: -180, max: 180, step: 5, fmt: (v) => `${v}°` },
    { key: "taper", label: "Taper (both axes)", options: labels(TAPERS) },
    { key: "sll", label: "Design sidelobe level", min: 15, max: 60, step: 1, fmt: (v) => `−${v} dB`, show: (s) => TAPERS[s.taper].usesSll },
    { key: "range", label: "Colour range", min: 20, max: 60, step: 5, fmt: (v) => `${v} dB` },
  ],
  link: [
    { key: "freq", label: "Frequency", min: -1, max: 1.8, step: 0.005, ...logSlider, fmt: (v) => `${fmtNum(+v.toPrecision(3))} GHz` },
    { key: "pt", label: "Transmit power", min: -10, max: 50, step: 1, fmt: (v) => `${v} dBm` },
    { key: "gt", label: "Tx antenna gain", min: -5, max: 40, step: 0.5, fmt: (v) => `${v} dBi` },
    { key: "gr", label: "Rx antenna gain", min: -5, max: 40, step: 0.5, fmt: (v) => `${v} dBi` },
    { key: "dist", label: "Distance", min: 0, max: 5, step: 0.005, ...logSlider, fmt: fmtDist },
    { key: "loss", label: "Other losses", min: 0, max: 30, step: 0.5, fmt: (v) => `${v} dB` },
    { key: "model", label: "Propagation model", options: { free: "Free space (Friis)", tworay: "Two-ray ground reflection", logdist: "Log-distance, exponent n" } },
    { key: "ht", label: "Tx antenna height", min: 1, max: 100, step: 0.5, fmt: (v) => `${v} m`, show: (s) => s.model === "tworay" },
    { key: "hr", label: "Rx antenna height", min: 0.5, max: 30, step: 0.5, fmt: (v) => `${v} m`, show: (s) => s.model === "tworay" },
    { key: "n", label: "Path-loss exponent n", min: 1.6, max: 5, step: 0.1, fmt: (v) => v.toFixed(1), show: (s) => s.model === "logdist" },
    { key: "bw", label: "Bandwidth", min: -2, max: 3, step: 0.01, ...logSlider, fmt: fmtBw },
    { key: "nf", label: "Receiver noise figure", min: 0.5, max: 15, step: 0.1, fmt: (v) => `${v.toFixed(1)} dB` },
    { key: "snr", label: "Required SNR", min: -5, max: 30, step: 0.5, fmt: (v) => `${v} dB` },
  ],
  rx: [
    { key: "preset", label: "Load a preset chain", options: labels(RX_PRESETS) },
    { key: "bw", label: "Bandwidth", min: -2, max: 3, step: 0.01, ...logSlider, fmt: fmtBw },
    { key: "snr", label: "Required SNR", min: -5, max: 30, step: 0.5, fmt: (v) => `${v} dB` },
  ],
};

// ---------------------------------------------------------------- controls
function buildControls(name) {
  const host = $(`#${name}-controls`);
  host.replaceChildren();
  for (const spec of SPECS[name]) {
    const label = document.createElement("label");
    label.className = "ctl";
    label.dataset.key = spec.key;
    const head = document.createElement("span");
    head.className = "ctl-h";
    const title = document.createElement("span");
    title.textContent = spec.label;
    const out = document.createElement("output");
    head.append(title, out);
    let input;
    if (spec.options) {
      input = document.createElement("select");
      for (const [value, text] of Object.entries(spec.options)) input.add(new Option(text, value));
    } else {
      input = document.createElement("input");
      input.type = "range";
      Object.assign(input, { min: spec.min, max: spec.max, step: spec.step });
    }
    input.id = `${name}-${spec.key}`;
    input.addEventListener("input", () => {
      let v = spec.options ? input.value : Number(input.value);
      if (spec.fromSlider) v = spec.fromSlider(v);
      state[name][spec.key] = v;
      if (name === "rx" && spec.key === "preset") {
        stages = JSON.parse(JSON.stringify(RX_PRESETS[v].stages));
        buildStages();
      }
      syncControls(name);
      schedule();
    });
    label.append(head, input);
    host.append(label);
  }
  syncControls(name);
}

function syncControls(name) {
  for (const spec of SPECS[name]) {
    const label = document.querySelector(`#${name}-controls .ctl[data-key="${spec.key}"]`);
    const input = label.querySelector("input, select");
    const v = state[name][spec.key];
    input.value = spec.toSlider ? spec.toSlider(v) : v;
    label.querySelector("output").textContent = spec.options ? "" : spec.fmt ? spec.fmt(v) : String(v);
    label.hidden = spec.show ? !spec.show(state[name]) : false;
  }
}

function buildPresets() {
  const host = $("#array-presets");
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = "Try";
  host.append(title);
  for (const [text, values] of ARRAY_PRESETS) {
    const b = document.createElement("button");
    b.textContent = text;
    b.addEventListener("click", () => {
      Object.assign(state.array, values);
      syncControls("array");
      schedule();
    });
    host.append(b);
  }
}

function metricCards(host, items) {
  host.replaceChildren(
    ...items.map((m) => {
      const card = document.createElement("div");
      card.className = `metric ${m.cls ?? ""}`;
      for (const [cls, text] of [["k", m.k], ["v", m.v], ["s", m.s]]) {
        if (text === undefined) continue;
        const el = document.createElement("div");
        el.className = cls;
        el.textContent = text;
        card.append(el);
      }
      return card;
    }),
  );
}

// -------------------------------------------------------------- wave field
const Field = {
  canvas: null,
  ready: false,
  compute(w, ph, d, steer) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return; // not laid out yet
    const gw = Math.max(80, Math.round(rect.width / 2.4));
    const gh = Math.max(40, Math.round(rect.height / 2.4));
    const N = w.length;
    const halfX = Math.max(5, ((N - 1) * d) * 0.62 + 2.5);
    const Y = (2 * halfX * gh) / gw;
    const xs = Array.from({ length: N }, (_, n) => (n - (N - 1) / 2) * d);
    const A = new Float32Array(gw * gh);
    const P = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      const y = Y * (1 - (j + 0.5) / gh) + 0.35;
      for (let i = 0; i < gw; i++) {
        const x = -halfX + (2 * halfX * (i + 0.5)) / gw;
        let re = 0;
        let im = 0;
        for (let n = 0; n < N; n++) {
          if (w[n] === 0) continue;
          const dx = x - xs[n];
          const r = Math.sqrt(dx * dx + y * y);
          const a = ph[n] - 2 * Math.PI * r;
          const g = w[n] / Math.sqrt(r);
          re += g * Math.cos(a);
          im += g * Math.sin(a);
        }
        const k = j * gw + i;
        A[k] = Math.hypot(re, im);
        P[k] = Math.atan2(im, re);
      }
    }
    const far = Array.from(A.subarray(0, Math.floor(gh * 0.6) * gw)).sort((a, b) => a - b);
    Object.assign(this, {
      gw, gh, A, P, halfX, Y, xs, w, steer,
      scale: far[Math.floor(far.length * 0.995)] || 1,
      img: new ImageData(gw, gh),
      off: new OffscreenCanvas(gw, gh),
      ready: true,
    });
  },
  draw(time) {
    if (!this.ready) return;
    const { gw, gh, A, P, img } = this;
    const data = img.data;
    const wt = -2 * Math.PI * 0.75 * time;
    const inv = 1.25 / this.scale;
    for (let k = 0; k < gw * gh; k++) {
      const v = Math.tanh(inv * A[k] * Math.cos(P[k] + wt));
      const o = 4 * k;
      if (v >= 0) {
        data[o] = 5 + v * 250;
        data[o + 1] = 7 + v * 159;
        data[o + 2] = 10 + v * 77;
      } else {
        data[o] = 5 - v * 83;
        data[o + 1] = 7 - v * 159;
        data[o + 2] = 10 - v * 245;
      }
      data[o + 3] = 255;
    }
    this.off.getContext("2d").putImageData(img, 0, 0);
    const { ctx, w, h } = fit(this.canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.off, 0, 0, w, h);
    // beam direction from the array centre
    const sx = w / (2 * this.halfX);
    const x0 = w / 2;
    const y0 = h + 0.35 * sx;
    ctx.strokeStyle = "rgba(230,237,243,0.55)";
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + 2 * h * Math.sin(this.steer), y0 - 2 * h * Math.cos(this.steer));
    ctx.stroke();
    ctx.setLineDash([]);
    // elements
    for (let n = 0; n < this.xs.length; n++) {
      const px = x0 + this.xs[n] * sx;
      ctx.fillStyle = this.w[n] === 0 ? C.red : C.text;
      ctx.beginPath();
      ctx.arc(px, h - 4, Math.max(1.6, Math.min(3.5, sx * 0.12)), 0, 2 * Math.PI);
      ctx.fill();
    }
    // one-wavelength scale bar
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(14, 18);
    ctx.lineTo(14 + sx, 18);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = C.text;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText("1 λ", 20 + sx, 22);
  },
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// `?t=1.25` in the page URL freezes the animation at that time (handy for screenshots)
const fixedTime = (() => {
  const t = Number(new URLSearchParams(location.search).get("t"));
  return Number.isFinite(t) && new URLSearchParams(location.search).has("t") ? t : null;
})();
function loop(ts) {
  if (active === "array" && !document.hidden && !reduceMotion && fixedTime === null) Field.draw(ts / 1000);
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------ linear array
function drawExcitation(canvas, w, ph) {
  const { ctx, w: W, h: H } = fit(canvas);
  const pad = { l: 44, r: 44, t: 12, b: 30 };
  const pw = W - pad.l - pad.r;
  const phh = H - pad.t - pad.b;
  const N = w.length;
  const bw = pw / N;
  const maxw = Math.max(...w, 1e-9);
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.strokeStyle = C.grid2;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const y = pad.t + (1 - f) * phh + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + pw, y);
    ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(f.toFixed(2), pad.l - 6, y);
    ctx.textAlign = "left";
    ctx.fillText(`${Math.round(-180 + 360 * f)}°`, pad.l + pw + 6, y);
  }
  for (let n = 0; n < N; n++) {
    const x = pad.l + n * bw;
    const hgt = (w[n] / maxw) * phh;
    ctx.fillStyle = w[n] === 0 ? "rgba(255,123,114,0.35)" : "rgba(88,166,255,0.75)";
    ctx.fillRect(x + bw * 0.15, pad.t + phh - (w[n] === 0 ? 3 : hgt), bw * 0.7, w[n] === 0 ? 3 : hgt);
    const wrapped = ((((ph[n] + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    ctx.fillStyle = C.orange;
    ctx.beginPath();
    ctx.arc(x + bw / 2, pad.t + (1 - (wrapped + Math.PI) / (2 * Math.PI)) * phh, Math.max(1.8, Math.min(3.2, bw * 0.22)), 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.fillStyle = C.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const step = Math.ceil(N / 8);
  for (let n = 0; n < N; n += step) ctx.fillText(String(n + 1), pad.l + (n + 0.5) * bw, pad.t + phh + 6);
  ctx.strokeStyle = C.grid;
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, pw, phh);
}

function renderArray() {
  const s = state.array;
  const t0 = s.steer * DEG;
  const failed = failedElements(s.N, s.fail / 100, 7);
  const w = TAPERS[s.taper].weights(s.N, s.sll, s.nbar).map((x, i) => (failed.has(i) ? 0 : x));
  const ph = steeringPhases(s.N, s.d, t0, s.bits);
  const el = ELEMENTS[s.element];
  const pat = pattern(w, ph, s.d, el.f, 1441);
  const uni = new Array(s.N).fill(1);
  const ideal = steeringPhases(s.N, s.d, t0);
  const ref = pattern(uni, ideal, s.d, el.f, 721);
  const m = beamMetrics(pat.theta, pat.totalDb, t0);
  const D = directivity(w, ph, s.d, el);
  const Dref = directivity(uni, ideal, s.d, el);
  const lamCm = (C0 / (s.freq * 1e9)) * 100;
  const limit = gratingFreeScan(s.d);
  const gl = m.gratingLobes.length > 0;
  metricCards($("#array-metrics"), [
    { k: "Beam direction", v: `${deg(m.peak).toFixed(1)}°`, s: `steered to ${s.steer}°` },
    { k: "Half-power beamwidth", v: m.hpbw ? `${deg(m.hpbw).toFixed(2)}°` : "—", s: "−3 dB width" },
    { k: "Peak sidelobe", v: m.sll !== null ? `${m.sll.toFixed(1)} dB` : "—", s: TAPERS[s.taper].usesSll ? `design −${s.sll} dB` : TAPERS[s.taper].label },
    { k: "Directivity", v: `${(10 * Math.log10(D)).toFixed(1)} dBi`, s: `uniform, ideal: ${(10 * Math.log10(Dref)).toFixed(1)} dBi` },
    { k: "Taper efficiency", v: `${(100 * taperEfficiency(w)).toFixed(0)}%`, s: failed.size ? `${failed.size} of ${s.N} elements failed` : "all elements working" },
    { k: "Grating lobes", v: gl ? `${m.gratingLobes.length} in view` : "none", s: s.d <= 0.5 ? "free at any scan angle" : limit > 0 ? `free up to ±${deg(limit).toFixed(0)}°` : "present at every scan", cls: gl ? "bad" : "good" },
    { k: "Aperture", v: `${((s.N - 1) * s.d * lamCm).toFixed(1)} cm`, s: `λ = ${lamCm.toFixed(2)} cm at ${s.freq.toFixed(1)} GHz` },
  ]);
  polarPlot($("#polar"), { theta: pat.theta, db: pat.totalDb, range: s.range, steer: t0, ref: { theta: ref.theta, db: ref.totalDb } });
  const tdeg = Array.from(pat.theta, deg);
  linePlot($("#cart"), {
    x: { min: -90, max: 90, label: "angle from broadside θ", unit: "°" },
    y: { min: -s.range, max: 0, label: "dB" },
    series: [
      { x: Array.from(ref.theta, deg), y: ref.totalDb, color: C.muted, width: 1, dash: [3, 3] },
      { x: tdeg, y: pat.totalDb, color: C.accent, width: 1.7, fill: "rgba(88,166,255,0.10)" },
    ],
    hlines: [
      { v: -3, color: C.green, dash: [2, 4], label: "−3 dB" },
      ...(m.sll !== null ? [{ v: m.sll, color: C.red, dash: [4, 4], label: `peak SLL ${m.sll.toFixed(1)} dB`, align: "left" }] : []),
    ],
    vlines: [{ v: s.steer, color: C.orange, dash: [4, 4] }],
  });
  drawExcitation($("#weights"), w, ph);
  const umax = Math.min(6, Math.max(2, 1 / s.d + 1.2));
  const us = Array.from({ length: 1201 }, (_, k) => -umax + (2 * umax * k) / 1200);
  const afu = us.map((u) => afMag(w, ph, s.d, u));
  const mx = Math.max(...afu);
  linePlot($("#uspace"), {
    x: { min: -umax, max: umax, label: "u = sin θ (visible region shaded)" },
    y: { min: -s.range, max: 0, label: "dB" },
    bands: [{ x0: -1, x1: 1, color: "rgba(63,185,80,0.09)" }],
    series: [{ x: us, y: afu.map((a) => db20(a / mx)), color: C.purple, width: 1.4 }],
    vlines: [
      { v: -1, color: C.green, dash: [2, 3] },
      { v: 1, color: C.green, dash: [2, 3] },
      { v: Math.sin(t0), color: C.orange, dash: [4, 4], label: "u₀ = sin θ₀" },
    ],
  });
  Field.compute(w, ph, s.d, t0);
  Field.draw(fixedTime ?? performance.now() / 1000); // never leave the field blank between frames
}

// ------------------------------------------------------------ planar array
function renderPlanar() {
  const s = state.planar;
  const wx = TAPERS[s.taper].weights(s.Nx, s.sll, 4);
  const wy = TAPERS[s.taper].weights(s.Ny, s.sll, 4);
  const t0 = s.theta * DEG;
  const p0 = s.phi * DEG;
  const n = 181;
  const { grid, u0, v0 } = planarGrid(wx, wy, s.dx, s.dy, t0, p0, n);
  const gdb = Float64Array.from(grid, (g) => db20(g));
  heatmap($("#uv"), { grid: gdb, n, range: s.range, marker: { u: u0, v: v0 } });
  const phx = steeringPhases(s.Nx, s.dx, Math.asin(u0));
  const phy = steeringPhases(s.Ny, s.dy, Math.asin(v0));
  const ts = Array.from({ length: 801 }, (_, k) => -1 + k / 400);
  const cutU = ts.map((u) => afMag(wx, phx, s.dx, u));
  const cutV = ts.map((v) => afMag(wy, phy, s.dy, v));
  const mu = Math.max(...cutU);
  const mv = Math.max(...cutV);
  const du = cutU.map((a) => db20(a / mu));
  const dv = cutV.map((a) => db20(a / mv));
  linePlot($("#cuts"), {
    x: { min: -1, max: 1, label: "u (along x) / v (along y)" },
    y: { min: -s.range, max: 0, label: "dB" },
    series: [
      { x: ts, y: du, color: C.accent, width: 1.6 },
      { x: ts, y: dv, color: C.orange, width: 1.4, dash: [5, 3] },
    ],
    vlines: [{ v: u0, color: C.accent, dash: [2, 3] }, { v: v0, color: C.orange, dash: [2, 3] }],
    legend: [{ label: "u-cut", color: C.accent }, { label: "v-cut", color: C.orange, dash: [5, 3] }],
  });
  const halfWidth = (ys, center) => {
    let a = null;
    let b = null;
    const i0 = Math.round((center + 1) * 400);
    for (let i = i0; i > 0; i--) if (ys[i - 1] < -3) { a = ts[i - 1]; break; }
    for (let i = i0; i < ys.length - 1; i++) if (ys[i + 1] < -3) { b = ts[i + 1]; break; }
    return a !== null && b !== null ? b - a : null;
  };
  const bwU = halfWidth(du, u0);
  const bwV = halfWidth(dv, v0);
  const D = planarDirectivity(wx, wy, s.dx, s.dy, t0, p0);
  const gl = planarGratingLobes(s.dx, s.dy, u0, v0).length;
  metricCards($("#planar-metrics"), [
    { k: "Elements", v: `${s.Nx * s.Ny}`, s: `${s.Nx} × ${s.Ny}` },
    { k: "Directivity", v: `${(10 * Math.log10(D)).toFixed(1)} dBi`, s: "isotropic elements" },
    { k: "Beamwidth in u", v: bwU ? `${(deg(2 * Math.asin(bwU / 2))).toFixed(2)}°` : "—", s: "−3 dB, sine space" },
    { k: "Beamwidth in v", v: bwV ? `${(deg(2 * Math.asin(bwV / 2))).toFixed(2)}°` : "—", s: "−3 dB, sine space" },
    { k: "Grating lobes", v: gl ? `${gl} in view` : "none", s: gl ? "reduce spacing or scan" : "none inside the visible disk", cls: gl ? "bad" : "good" },
  ]);
}

// --------------------------------------------------------------- link budget
function pathLoss(s, d) {
  const f = s.freq * 1e9;
  if (s.model === "tworay") return twoRay(f, d, s.ht, s.hr);
  if (s.model === "logdist") return logDistance(f, d, s.n);
  return fspl(f, d);
}

function renderLink() {
  const s = state.link;
  const f = s.freq * 1e9;
  const B = s.bw * 1e6;
  const pl = pathLoss(s, s.dist);
  const pr = received(s.pt, s.gt, s.gr, pl, s.loss);
  const floor = thermalNoise(B) + s.nf;
  const sens = floor + s.snr;
  const snr = pr - floor;
  const margin = pr - sens;
  const ds = Array.from({ length: 900 }, (_, k) => 10 ** ((5 * k) / 899));
  const prModel = ds.map((d) => received(s.pt, s.gt, s.gr, pathLoss(s, d), s.loss));
  const prFree = ds.map((d) => received(s.pt, s.gt, s.gr, fspl(f, d), s.loss));
  let maxRange = null;
  for (let k = ds.length - 1; k >= 0; k--) if (prModel[k] >= sens) { maxRange = ds[k]; break; }
  metricCards($("#link-metrics"), [
    { k: "Path loss", v: `${pl.toFixed(1)} dB`, s: s.model === "free" ? "free space" : s.model === "tworay" ? "two-ray ground" : `log-distance, n = ${s.n}` },
    { k: "Received power", v: `${pr.toFixed(1)} dBm`, s: `at ${fmtDist(s.dist)}` },
    { k: "Noise floor", v: `${floor.toFixed(1)} dBm`, s: `kTB + NF over ${fmtBw(s.bw)}` },
    { k: "SNR", v: `${snr.toFixed(1)} dB`, s: `need ${s.snr} dB` },
    { k: "Link margin", v: `${margin >= 0 ? "+" : ""}${margin.toFixed(1)} dB`, s: margin >= 0 ? "link closes" : "link fails", cls: margin >= 0 ? "good" : "bad" },
    { k: "Maximum range", v: maxRange ? fmtDist(maxRange) : "< 1 m", s: maxRange && maxRange >= 99999 ? "beyond the plot" : "where margin = 0" },
  ]);
  const ymax = Math.ceil((Math.max(...prModel.slice(0, 10), ...prFree.slice(0, 10)) + 5) / 10) * 10;
  const ymin = Math.floor((sens - 35) / 10) * 10;
  const vlines = [{ v: s.dist, color: C.text, dash: [2, 3] }];
  if (s.model === "tworay") {
    const bp = breakpoint(f, s.ht, s.hr);
    if (bp > 1 && bp < 1e5) vlines.push({ v: bp, color: C.purple, dash: [4, 4], label: "breakpoint 4hₜhᵣ/λ" });
  }
  linePlot($("#linkplot"), {
    x: { min: 1, max: 1e5, log: true, distance: true, label: "distance" },
    y: { min: ymin, max: ymax, label: "received power (dBm)" },
    series: [
      ...(s.model !== "free" ? [{ x: ds, y: prFree, color: C.muted, width: 1, dash: [3, 3] }] : []),
      { x: ds, y: prModel, color: C.accent, width: 1.7 },
    ],
    hlines: [
      { v: floor, color: C.red, dash: [4, 4], label: `noise floor ${floor.toFixed(1)} dBm` },
      { v: sens, color: C.orange, dash: [6, 3], label: `sensitivity ${sens.toFixed(1)} dBm` },
    ],
    vlines,
    points: [{ x: s.dist, y: pr, color: margin >= 0 ? C.green : C.red, r: 5 }],
    legend: [
      { label: s.model === "free" ? "free space" : s.model === "tworay" ? "two-ray" : `log-distance n=${s.n}`, color: C.accent },
      ...(s.model !== "free" ? [{ label: "free space", color: C.muted, dash: [3, 3] }] : []),
    ],
  });
  const rows = [
    ["Transmit power", s.pt, "dBm"],
    ["+ Tx antenna gain", s.gt, "dB"],
    ["− Path loss", -pl, "dB"],
    ["− Other losses", -s.loss, "dB"],
    ["+ Rx antenna gain", s.gr, "dB"],
    ["= Received power", pr, "dBm", "total"],
    ["Noise floor (kTB + NF)", floor, "dBm"],
    ["SNR", snr, "dB"],
    ["Required SNR", s.snr, "dB"],
    ["Margin", margin, "dB", margin >= 0 ? "total pos" : "total neg"],
  ];
  const host = $("#budget");
  host.replaceChildren();
  for (const [name, value, unit, cls] of rows) {
    const a = document.createElement("div");
    a.textContent = name;
    const b = document.createElement("div");
    b.className = `num ${cls ?? ""}`;
    b.textContent = `${value >= 0 && unit === "dB" && name !== "SNR" && name !== "Required SNR" ? "+" : ""}${value.toFixed(1)} ${unit}`;
    if (cls) a.className = cls;
    host.append(a, b);
  }
}

// ------------------------------------------------------------ receiver chain
function buildStages() {
  const table = $("#stages");
  table.replaceChildren();
  const add = $("#add-stage");
  add.disabled = stages.length >= MAX_STAGES;
  add.title = add.disabled ? `A shared link holds at most ${MAX_STAGES} stages` : "";
  const head = table.insertRow();
  for (const t of ["#", "Stage", "Gain (dB)", "NF (dB)", "IIP3 (dBm)", ""]) {
    const th = document.createElement("th");
    th.textContent = t;
    head.append(th);
  }
  stages.forEach((st, i) => {
    const row = table.insertRow();
    const idx = row.insertCell();
    idx.className = "idx";
    idx.textContent = String(i + 1);
    for (const key of ["name", "gain", "nf", "iip3"]) {
      const cell = row.insertCell();
      const input = document.createElement("input");
      input.type = key === "name" ? "text" : "number";
      if (key !== "name") input.step = "0.1";
      input.className = key === "name" ? "name" : "";
      if (key === "name") input.maxLength = MAX_NAME;
      input.value = st[key];
      input.setAttribute("aria-label", `${key} of stage ${i + 1}`);
      input.addEventListener("input", () => {
        st[key] = key === "name" ? input.value : Number(input.value);
        schedule();
      });
      cell.append(input);
    }
    const del = row.insertCell();
    const b = document.createElement("button");
    b.textContent = "×";
    b.title = "Remove stage";
    b.addEventListener("click", () => {
      stages.splice(i, 1);
      buildStages();
      schedule();
    });
    del.append(b);
  });
}

function renderRx() {
  const s = state.rx;
  const B = s.bw * 1e6;
  if (!stages.length) {
    metricCards($("#rx-metrics"), [{ k: "Chain", v: "empty", s: "add a stage" }]);
    fit($("#rxplot"));
    fit($("#rxshare"));
    return;
  }
  const r = cascade(stages.map((x) => ({ ...x, gain: +x.gain || 0, nf: Math.max(0, +x.nf || 0), iip3: Number.isFinite(+x.iip3) ? +x.iip3 : Infinity })));
  const F = 10 ** (r.nf / 10);
  const kTB = thermalNoise(B);
  const floorIn = kTB + r.nf;
  metricCards($("#rx-metrics"), [
    { k: "Total gain", v: `${r.gain.toFixed(1)} dB` },
    { k: "Noise figure", v: `${r.nf.toFixed(2)} dB`, s: `Te = ${(290 * (F - 1)).toFixed(0)} K` },
    { k: "Input IP3", v: Number.isFinite(r.iip3) ? `${r.iip3.toFixed(1)} dBm` : "∞" },
    { k: "Sensitivity", v: `${sensitivity(r.nf, B, s.snr).toFixed(1)} dBm`, s: `${fmtBw(s.bw)}, SNR ${s.snr} dB` },
    { k: "Spur-free dynamic range", v: Number.isFinite(r.iip3) ? `${sfdr(r.iip3, floorIn).toFixed(1)} dB` : "∞", s: "⅔ (IIP3 − noise floor)" },
  ]);
  const xs = r.rows.map((_, i) => i + 1);
  const nfs = r.rows.map((row) => row.nf);
  const gains = r.rows.map((row) => row.gain);
  const lo = Math.min(0, ...gains, ...nfs) - 5;
  const hi = Math.max(...gains, ...nfs) + 5;
  linePlot($("#rxplot"), {
    x: { min: 0.7, max: xs.length + 0.3, label: "after stage", integer: true },
    y: { min: lo, max: hi, label: "dB" },
    series: [
      { x: xs, y: gains, color: C.orange, width: 1.6 },
      { x: xs, y: nfs, color: C.accent, width: 1.8 },
    ],
    points: [
      ...xs.map((x, i) => ({ x, y: gains[i], color: C.orange, r: 4 })),
      ...xs.map((x, i) => ({ x, y: nfs[i], color: C.accent, r: 4 })),
    ],
    legend: [{ label: "cumulative gain", color: C.orange }, { label: "cumulative NF", color: C.accent }],
  });
  const { ctx, w, h } = fit($("#rxshare"));
  const rowH = Math.min(30, (h - 16) / stages.length);
  const left = 120;
  ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  stages.forEach((st, i) => {
    const y = 8 + i * rowH;
    const share = r.share[i];
    ctx.fillStyle = C.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(st.name).slice(0, 16), left - 10, y + rowH / 2);
    ctx.fillStyle = C.grid2;
    ctx.fillRect(left, y + 4, w - left - 60, rowH - 8);
    ctx.fillStyle = i === 0 ? C.accent : "rgba(88,166,255,0.6)";
    ctx.fillRect(left, y + 4, Math.max(0, (w - left - 60) * share), rowH - 8);
    ctx.fillStyle = C.text;
    ctx.textAlign = "left";
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText(`${(100 * share).toFixed(1)}%`, w - 54, y + rowH / 2);
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  });
}

// ----------------------------------------------------------- tabs, URL, loop
const RENDER = { array: renderArray, planar: renderPlanar, link: renderLink, rx: renderRx };
let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    RENDER[active]();
    writeHash();
  });
}

function writeHash() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state[active])) p.set(k, typeof v === "number" ? String(+v.toPrecision(6)) : v);
  if (active === "rx") {
    // an edited chain travels in full; an untouched preset needs only its name
    const chain = encodeStages(stages);
    if (chain !== encodeStages(RX_PRESETS[state.rx.preset].stages)) p.set("stages", chain);
  }
  history.replaceState(null, "", `#${active}?${p}`);
}

function readHash() {
  const m = location.hash.match(/^#(\w+)(?:\?(.*))?$/);
  if (!m || !(m[1] in state)) return;
  active = m[1];
  const params = new URLSearchParams(m[2] ?? "");
  for (const [k, raw] of params) {
    const spec = SPECS[active].find((x) => x.key === k);
    if (!spec) continue;
    if (spec.options) {
      if (raw in spec.options) state[active][k] = raw;
    } else {
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      const sv = spec.toSlider ? spec.toSlider(v) : v;
      if (sv >= spec.min - 1e-9 && sv <= spec.max + 1e-9) state[active][k] = v;
    }
  }
  if (active === "rx") {
    const custom = params.has("stages") ? decodeStages(params.get("stages")) : null;
    stages = custom ?? JSON.parse(JSON.stringify(RX_PRESETS[state.rx.preset].stages));
  }
}

function showTab(name) {
  active = name;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const sec of document.querySelectorAll(".tab")) sec.hidden = sec.id !== `tab-${name}`;
  syncControls(name);
  schedule();
}

function init() {
  readHash();
  for (const name of Object.keys(SPECS)) buildControls(name);
  buildPresets();
  buildStages();
  Field.canvas = $("#field");
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => showTab(b.dataset.tab));
  $("#add-stage").addEventListener("click", () => {
    if (stages.length >= MAX_STAGES) return;
    stages.push({ name: `Stage ${stages.length + 1}`, gain: 10, nf: 3, iip3: 10 });
    buildStages();
    schedule();
  });
  $("#share").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $("#share").textContent = "Copied ✓";
    } catch {
      $("#share").textContent = "Copy the URL";
    }
    setTimeout(() => ($("#share").textContent = "Copy link"), 1600);
  });
  // back/forward and hand-edited links (replaceState in writeHash does not fire this)
  window.addEventListener("hashchange", () => {
    readHash();
    if (active === "rx") buildStages();
    for (const name of Object.keys(SPECS)) syncControls(name);
    showTab(active);
  });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(schedule, 120);
  });
  showTab(active);
  requestAnimationFrame(loop);
}

init();
