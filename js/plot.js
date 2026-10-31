// Minimal canvas plotting: crisp on high-DPI screens, themed to match the page.

export const C = {
  bg: "#0d1117", panel: "#161b22", grid: "#30363d", grid2: "#21262d", text: "#e6edf3", muted: "#8b949e",
  accent: "#58a6ff", accent2: "#79c0ff", orange: "#ffa657", red: "#ff7b72", green: "#3fb950", purple: "#d2a8ff",
  yellow: "#e3b341", pink: "#f778ba",
};
const FONT = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const FONT_UI = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/** Size the backing store to the element's CSS size times devicePixelRatio. */
export function fit(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(10, Math.round(r.width));
  const h = Math.max(10, Math.round(r.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** "Nice" tick values covering [lo, hi]. */
export function ticks(lo, hi, target = 6) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= target) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * span; v += step) out.push(Math.abs(v) < 1e-12 * span ? 0 : v);
  return out;
}

function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    const v = 10 ** e;
    if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
  }
  return out;
}

export function fmtNum(v) {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-2) return v.toExponential(0).replace("e+", "e");
  if (Number.isInteger(v)) return String(v);
  return String(+v.toFixed(2));
}

function fmtDistance(m) {
  if (m >= 1000) return `${fmtNum(m / 1000)} km`;
  if (m >= 1) return `${fmtNum(m)} m`;
  return `${fmtNum(m * 100)} cm`;
}

/**
 * Line plot. spec = { x: {min, max, log?, label, unit?, distance?}, y: {min, max, label},
 * series: [{x, y, color, width?, dash?, fill?, alpha?}], vlines, hlines: [{v, color, dash?, label?}],
 * bands: [{x0, x1, color}], points: [{x, y, color, label?}], legend: [{label, color, dash?}] }
 */
export function linePlot(canvas, spec) {
  const { ctx, w, h } = fit(canvas);
  const pad = { l: 46, r: 14, t: 12, b: 34 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  if (pw < 20 || ph < 20) return null; // not laid out yet
  const { x: X, y: Y } = spec;
  const fx = X.log
    ? (v) => pad.l + ((Math.log10(v) - Math.log10(X.min)) / (Math.log10(X.max) - Math.log10(X.min))) * pw
    : (v) => pad.l + ((v - X.min) / (X.max - X.min)) * pw;
  const fy = (v) => pad.t + (1 - (v - Y.min) / (Y.max - Y.min)) * ph;
  ctx.font = FONT;
  ctx.lineWidth = 1;
  // bands
  for (const b of spec.bands ?? []) {
    ctx.fillStyle = b.color;
    ctx.fillRect(fx(b.x0), pad.t, fx(b.x1) - fx(b.x0), ph);
  }
  // grid + ticks
  ctx.strokeStyle = C.grid2;
  ctx.fillStyle = C.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let xt = X.log ? logTicks(X.min, X.max) : ticks(X.min, X.max, Math.max(3, Math.floor(pw / 70)));
  if (X.integer) xt = xt.filter((v) => Number.isInteger(v));
  for (const v of xt) {
    const px = Math.round(fx(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, pad.t);
    ctx.lineTo(px, pad.t + ph);
    ctx.stroke();
    const text = X.distance ? fmtDistance(v) : fmtNum(v) + (X.unit ?? "");
    const half = ctx.measureText(text).width / 2;
    ctx.fillText(text, Math.min(w - 2 - half, Math.max(half + 2, px)), pad.t + ph + 6); // keep edge labels on canvas
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const v of ticks(Y.min, Y.max, Math.max(3, Math.floor(ph / 40)))) {
    const py = Math.round(fy(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, py);
    ctx.lineTo(pad.l + pw, py);
    ctx.stroke();
    ctx.fillText(fmtNum(v), pad.l - 6, py);
  }
  ctx.strokeStyle = C.grid;
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, pw, ph);
  // axis labels
  ctx.font = FONT_UI;
  ctx.fillStyle = C.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  if (X.label) ctx.fillText(X.label, pad.l + pw / 2, h - 1);
  if (Y.label) {
    ctx.save();
    ctx.translate(11, pad.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillText(Y.label, 0, 0);
    ctx.restore();
  }
  // clip to the plot area for data
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.l, pad.t, pw, ph);
  ctx.clip();
  const line = (l, horizontal) => {
    ctx.strokeStyle = l.color;
    ctx.setLineDash(l.dash ?? []);
    ctx.lineWidth = l.width ?? 1;
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(pad.l, fy(l.v));
      ctx.lineTo(pad.l + pw, fy(l.v));
    } else {
      ctx.moveTo(fx(l.v), pad.t);
      ctx.lineTo(fx(l.v), pad.t + ph);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  for (const l of spec.hlines ?? []) line(l, true);
  for (const l of spec.vlines ?? []) line(l, false);
  for (const s of spec.series) {
    ctx.beginPath();
    for (let i = 0; i < s.x.length; i++) {
      const px = fx(s.x[i]);
      const py = fy(Math.max(Y.min - 1e3, Math.min(Y.max + 1e3, s.y[i])));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    if (s.fill) {
      ctx.save();
      ctx.lineTo(fx(s.x[s.x.length - 1]), pad.t + ph);
      ctx.lineTo(fx(s.x[0]), pad.t + ph);
      ctx.closePath();
      ctx.fillStyle = s.fill;
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      for (let i = 0; i < s.x.length; i++) {
        const px = fx(s.x[i]);
        const py = fy(Math.max(Y.min - 1e3, Math.min(Y.max + 1e3, s.y[i])));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    }
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = s.alpha ?? 1;
    ctx.lineWidth = s.width ?? 1.6;
    ctx.setLineDash(s.dash ?? []);
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  for (const p of spec.points ?? []) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(fx(p.x), fy(p.y), p.r ?? 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
  // line labels (outside the clip so they stay readable)
  ctx.font = FONT;
  ctx.textBaseline = "bottom";
  for (const l of spec.hlines ?? []) {
    if (!l.label) continue;
    ctx.fillStyle = l.color;
    ctx.textAlign = l.align === "left" ? "left" : "right";
    ctx.fillText(l.label, l.align === "left" ? pad.l + 6 : pad.l + pw - 6, fy(l.v) - 3);
  }
  for (const l of spec.vlines ?? []) {
    if (!l.label) continue;
    ctx.fillStyle = l.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(l.label, fx(l.v) + 4, pad.t + 4 + (l.row ?? 0) * 14);
  }
  if (spec.legend) legend(ctx, spec.legend, pad.l + 8, pad.t + 8);
  return { fx, fy, pad, pw, ph };
}

function legend(ctx, items, x, y) {
  ctx.font = FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let cx = x;
  for (const it of items) {
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(it.dash ?? []);
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx + 16, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.text;
    ctx.fillText(it.label, cx + 21, y);
    cx += 30 + ctx.measureText(it.label).width;
  }
}

/** Polar plot of a pattern in dB over theta in [-90, 90] deg (broadside up). */
export function polarPlot(canvas, { theta, db, range, steer, ref, color = C.accent }) {
  const { ctx, w, h } = fit(canvas);
  const cx = w / 2;
  const cy = h - 22;
  const R = Math.min(w / 2 - 26, h - 40);
  if (R < 20) return; // not laid out yet
  const rad = (v) => (Math.max(v, -range) + range) / range * R;
  ctx.font = FONT;
  // rings
  ctx.lineWidth = 1;
  for (let k = 0; k <= range; k += 10) {
    const r = rad(-k);
    ctx.strokeStyle = k === 0 ? C.grid : C.grid2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
    ctx.stroke();
    if (k > 0 && k < range) {
      ctx.fillStyle = C.muted;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`-${k}`, cx + 3, cy - r - 1);
    }
  }
  // spokes
  for (let a = -90; a <= 90; a += 30) {
    const t = (a * Math.PI) / 180;
    ctx.strokeStyle = C.grid2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.sin(t), cy - R * Math.cos(t));
    ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${a}°`, cx + (R + 14) * Math.sin(t), cy - (R + 12) * Math.cos(t));
  }
  const path = (th, d) => {
    ctx.beginPath();
    for (let i = 0; i < th.length; i++) {
      const r = rad(d[i]);
      const x = cx + r * Math.sin(th[i]);
      const y = cy - r * Math.cos(th[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  if (ref) {
    path(ref.theta, ref.db);
    ctx.strokeStyle = C.muted;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  path(theta, db);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = "rgba(88,166,255,0.16)";
  ctx.fill();
  path(theta, db);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = "round";
  ctx.stroke();
  if (steer !== undefined) {
    ctx.strokeStyle = C.orange;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.sin(steer), cy - R * Math.cos(steer));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Diverging/sequential colour maps returning [r, g, b] for t in [0, 1]. */
export function cmapInferno(t) {
  const stops = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return stops[i].map((v, k) => v + f * (stops[i + 1][k] - v));
}

/** Heat map of a square n x n grid over u, v in [-1, 1] (values already in dB, peak 0). */
export function heatmap(canvas, { grid, n, range, marker }) {
  const { ctx, w, h } = fit(canvas);
  const S = Math.min(w, h) - 30;
  if (S < 20) return; // not laid out yet
  const ox = (w - S) / 2;
  const oy = (h - S) / 2 - 4;
  const img = new ImageData(n, n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = -1 + (2 * i) / (n - 1);
      const v = -1 + (2 * j) / (n - 1);
      const k = ((n - 1 - j) * n + i) * 4;
      if (u * u + v * v > 1) {
        img.data.set([13, 17, 23, 255], k);
        continue;
      }
      const t = (Math.max(grid[j * n + i], -range) + range) / range;
      const [r, g, b] = cmapInferno(t);
      img.data.set([r, g, b, 255], k);
    }
  }
  const off = new OffscreenCanvas(n, n);
  off.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, ox, oy, S, S);
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ox + S / 2, oy + S / 2, S / 2, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.font = FONT;
  ctx.fillStyle = C.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("u = sin θ cos φ", ox + S / 2, oy + S + 6);
  ctx.save();
  ctx.translate(ox - 10, oy + S / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "middle";
  ctx.fillText("v = sin θ sin φ", 0, 0);
  ctx.restore();
  if (marker) {
    ctx.strokeStyle = C.accent2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ox + ((marker.u + 1) / 2) * S, oy + ((1 - marker.v) / 2) * S, 7, 0, 2 * Math.PI);
    ctx.stroke();
  }
}
