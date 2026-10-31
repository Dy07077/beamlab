// Linear phased-array mathematics. Pure functions, no DOM: shared by the app and the tests.
// Geometry: elements on the x axis, spacing d (in wavelengths), angles measured from broadside.

export const DEG = Math.PI / 180;

// ---------------------------------------------------------------- tapers
function binom(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function normalise(w) {
  const m = Math.max(...w.map(Math.abs));
  return w.map((x) => x / m);
}

/** Dolph–Chebyshev weights: equal sidelobes at -sll dB (port of scipy.signal.windows.chebwin). */
export function chebyshev(N, sll) {
  if (N === 1) return [1];
  const order = N - 1;
  const beta = Math.cosh(Math.acosh(10 ** (Math.abs(sll) / 20)) / order);
  const p = [];
  for (let k = 0; k < N; k++) {
    const x = beta * Math.cos((Math.PI * k) / N);
    if (x > 1) p.push(Math.cosh(order * Math.acosh(x)));
    else if (x < -1) p.push((2 * (N % 2) - 1) * Math.cosh(order * Math.acosh(-x)));
    else p.push(Math.cos(order * Math.acos(x)));
  }
  // real part of the DFT (N <= a few hundred, so O(N^2) is fine)
  const dft = (re, im) => {
    const out = [];
    for (let m = 0; m < N; m++) {
      let s = 0;
      for (let k = 0; k < N; k++) {
        const a = (-2 * Math.PI * m * k) / N;
        s += re[k] * Math.cos(a) - im[k] * Math.sin(a);
      }
      out.push(s);
    }
    return out;
  };
  let w;
  if (N % 2) {
    const W = dft(p, new Array(N).fill(0));
    const n = (N + 1) / 2;
    const half = W.slice(0, n);
    w = half.slice(1).reverse().concat(half);
  } else {
    const re = p.map((v, k) => v * Math.cos((Math.PI / N) * k));
    const im = p.map((v, k) => v * Math.sin((Math.PI / N) * k));
    const W = dft(re, im);
    const n = N / 2 + 1;
    w = W.slice(1, n).reverse().concat(W.slice(1, n));
  }
  return normalise(w);
}

/** Taylor n-bar weights (port of scipy.signal.windows.taylor). */
export function taylor(N, sll, nbar) {
  const B = 10 ** (Math.abs(sll) / 20);
  const A = Math.acosh(B) / Math.PI;
  const s2 = nbar ** 2 / (A ** 2 + (nbar - 0.5) ** 2);
  const Fm = [];
  for (let m = 1; m < nbar; m++) {
    let num = 1;
    let den = 1;
    for (let n = 1; n < nbar; n++) {
      num *= 1 - (m * m) / s2 / (A * A + (n - 0.5) ** 2);
      if (n !== m) den *= 1 - (m * m) / (n * n);
    }
    Fm.push(((m % 2 ? 1 : -1) * num) / (2 * den));
  }
  const W = (x) => 1 + 2 * Fm.reduce((s, f, i) => s + f * Math.cos((2 * Math.PI * (i + 1) * (x - N / 2 + 0.5)) / N), 0);
  const w = Array.from({ length: N }, (_, n) => W(n));
  return w.map((v) => v / W((N - 1) / 2));
}

export const TAPERS = {
  uniform: { label: "Uniform", weights: (N) => new Array(N).fill(1) },
  hann: { label: "Hann", weights: (N) => Array.from({ length: N }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (n + 1)) / (N + 1))) },
  hamming: { label: "Hamming", weights: (N) => (N === 1 ? [1] : Array.from({ length: N }, (_, n) => 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (N - 1)))) },
  blackman: {
    label: "Blackman",
    weights: (N) => Array.from({ length: N }, (_, n) => {
      const x = (2 * Math.PI * (n + 1)) / (N + 1);
      return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
    }),
  },
  binomial: { label: "Binomial", weights: (N) => normalise(Array.from({ length: N }, (_, n) => binom(N - 1, n))) },
  taylor: { label: "Taylor", weights: (N, sll = 30, nbar = 4) => taylor(N, sll, nbar), usesSll: true, usesNbar: true },
  chebyshev: { label: "Dolph–Chebyshev", weights: (N, sll = 30) => chebyshev(N, sll), usesSll: true },
};

// ------------------------------------------------------------ elements
/** |E|^2 of a half-wave dipole at direction cosine u measured along its own axis. */
function dipole2(u) {
  const s2 = 1 - u * u;
  return s2 < 1e-12 ? 0 : Math.cos((Math.PI / 2) * u) ** 2 / s2;
}

// Each element pattern comes in three forms. f(t) is the amplitude in the plotted plane (x-z, angle t
// from broadside). For the directivity integral a direction is written as u = cos(angle from the
// array axis x) plus an azimuth a around that axis (a = 90° points along z): peak(u) is the largest
// |E|^2 on the cone of constant u, and ring(u) is the integral of |E|^2 over a full turn in a.
export const ELEMENTS = {
  isotropic: { label: "Isotropic", f: () => 1, peak: () => 1, ring: () => 2 * Math.PI },
  cosine: {
    // |E| = cos(angle from z) in the front half-space; on the cone that is sqrt(1 - u^2) sin(a)
    label: "Cosine (patch-like)",
    f: (t) => Math.max(Math.cos(t), 0),
    peak: (u) => 1 - u * u,
    ring: (u) => (Math.PI / 2) * (1 - u * u),
  },
  dipole: {
    // half-wave dipole lying along the array axis: the same pattern at every azimuth; u = sin t in the plot
    label: "λ/2 dipole along the array",
    f: (t) => Math.sqrt(dipole2(Math.sin(t))),
    peak: dipole2,
    ring: (u) => 2 * Math.PI * dipole2(u),
  },
};

// ------------------------------------------------------- array factor
/** Element phases that steer the beam to theta0 (rad), optionally quantised to `bits`. */
export function steeringPhases(N, d, theta0, bits = 0) {
  const out = [];
  for (let n = 0; n < N; n++) {
    const x = n - (N - 1) / 2;
    let ph = -2 * Math.PI * d * x * Math.sin(theta0);
    if (bits > 0) {
      const q = (2 * Math.PI) / 2 ** bits;
      ph = Math.round(ph / q) * q;
    }
    out.push(ph);
  }
  return out;
}

/** Complex array factor sum_n w_n exp(j (2 pi d x_n u + phi_n)) at direction cosine u = sin(theta). */
export function afComplex(w, ph, d, u) {
  const N = w.length;
  let re = 0;
  let im = 0;
  for (let n = 0; n < N; n++) {
    const a = 2 * Math.PI * d * (n - (N - 1) / 2) * u + ph[n];
    re += w[n] * Math.cos(a);
    im += w[n] * Math.sin(a);
  }
  return [re, im];
}

export function afMag(w, ph, d, u) {
  const [re, im] = afComplex(w, ph, d, u);
  return Math.hypot(re, im);
}

/** Pattern over theta in [-90, 90] deg; returns normalised power in dB of AF * element factor. */
export function pattern(w, ph, d, element = ELEMENTS.isotropic.f, samples = 1441) {
  const theta = new Float64Array(samples);
  const af = new Float64Array(samples);
  const total = new Float64Array(samples);
  let maxAf = 1e-300;
  let maxT = 1e-300;
  for (let i = 0; i < samples; i++) {
    const t = (-90 + (180 * i) / (samples - 1)) * DEG;
    theta[i] = t;
    af[i] = afMag(w, ph, d, Math.sin(t));
    total[i] = af[i] * element(t);
    maxAf = Math.max(maxAf, af[i]);
    maxT = Math.max(maxT, total[i]);
  }
  const db = (x, m) => 20 * Math.log10(Math.max(x / m, 1e-12));
  return {
    theta,
    afDb: Float64Array.from(af, (x) => db(x, maxAf)),
    totalDb: Float64Array.from(total, (x) => db(x, maxT)),
  };
}

/**
 * Beam metrics from a sampled pattern (dB, peak = 0): main-lobe direction, half-power beamwidth,
 * null-to-null width, peak sidelobe level and grating lobes (other lobes within 3 dB of the peak).
 * When several lobes tie (grating lobes of isotropic elements), the one nearest `steer` is the main lobe.
 */
export function beamMetrics(theta, db, steer = null) {
  const n = db.length;
  let ip = 0;
  for (let i = 1; i < n; i++) if (db[i] > db[ip]) ip = i;
  if (steer !== null) {
    const top = db[ip];
    for (let i = 1; i < n - 1; i++) {
      const isPeak = db[i] >= db[i - 1] && db[i] >= db[i + 1] && db[i] > top - 0.5;
      if (isPeak && Math.abs(theta[i] - steer) < Math.abs(theta[ip] - steer)) ip = i;
    }
  }
  const cross = (dir) => {
    for (let i = ip; i >= 0 && i < n; i += dir) {
      const j = i + dir;
      if (j < 0 || j >= n) return null;
      if (db[j] <= -3 && db[i] > -3) {
        const f = (db[i] + 3) / (db[i] - db[j]);
        return theta[i] + f * (theta[j] - theta[i]);
      }
    }
    return null;
  };
  const lo = cross(-1);
  const hi = cross(1);
  // main lobe extends to the first local minima on either side
  let a = ip;
  while (a > 0 && db[a - 1] <= db[a]) a--;
  let b = ip;
  while (b < n - 1 && db[b + 1] <= db[b]) b++;
  let sll = -Infinity;
  const lobes = [];
  // a lobe cut off by the edge of the visible region (e.g. an endfire grating lobe) still counts
  for (let i = 0; i < n; i++) {
    if (i >= a && i <= b) continue;
    if ((i === 0 || db[i] >= db[i - 1]) && (i === n - 1 || db[i] >= db[i + 1])) {
      sll = Math.max(sll, db[i]);
      if (db[i] > -3) lobes.push(theta[i]);
    }
  }
  return {
    peak: theta[ip],
    hpbw: lo !== null && hi !== null ? hi - lo : null,
    fnbw: theta[b] - theta[a],
    sll: Number.isFinite(sll) ? sll : null,
    gratingLobes: lobes,
  };
}

/**
 * Directivity (linear) of the array with an element pattern from ELEMENTS. Elements lie on x.
 * |AF|^2 depends only on u = cos(angle from the array axis), so the azimuth integral is the
 * element's ring(u) and the sphere integral reduces to the 1-D integral of |AF(u)|^2 ring(u) over
 * [-1, 1]. Simpson's rule with about 16 samples per sidelobe keeps long, sparse arrays accurate.
 */
export function directivity(w, ph, d, element = ELEMENTS.isotropic) {
  const m = 2 * Math.max(1000, Math.ceil(16 * d * w.length)); // even number of intervals
  const h = 2 / m;
  const power = (u) => afMag(w, ph, d, u) ** 2 * element.peak(u);
  let integral = 0;
  let best = -1;
  let ib = 0;
  for (let i = 0; i <= m; i++) {
    const u = -1 + i * h;
    const a2 = afMag(w, ph, d, u) ** 2;
    integral += (i === 0 || i === m ? 1 : i % 2 ? 4 : 2) * a2 * element.ring(u);
    const p = a2 * element.peak(u);
    if (p > best) {
      best = p;
      ib = i;
    }
  }
  integral *= h / 3;
  // golden-section search for the true peak between the neighbouring samples
  const g = (Math.sqrt(5) - 1) / 2;
  let a = Math.max(-1, -1 + (ib - 1) * h);
  let b = Math.min(1, -1 + (ib + 1) * h);
  let x1 = b - g * (b - a);
  let x2 = a + g * (b - a);
  let f1 = power(x1);
  let f2 = power(x2);
  for (let k = 0; k < 40; k++) {
    if (f1 > f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - g * (b - a);
      f1 = power(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (b - a);
      f2 = power(x2);
    }
  }
  return (4 * Math.PI * Math.max(best, f1, f2)) / integral;
}

/** Exact directivity of a linear array of isotropic elements (closed form, used to test the integrator). */
export function directivityIsotropic(w, ph, d) {
  const N = w.length;
  let integral = 0;
  for (let m = 0; m < N; m++) {
    for (let n = 0; n < N; n++) {
      const a = 2 * Math.PI * d * (m - n);
      const sinc = a === 0 ? 1 : Math.sin(a) / a;
      integral += w[m] * w[n] * Math.cos(ph[m] - ph[n]) * 2 * sinc;
    }
  }
  let peak = 0;
  for (let k = 0; k <= 20000; k++) {
    const u = -1 + k / 10000;
    peak = Math.max(peak, afMag(w, ph, d, u) ** 2);
  }
  return (2 * peak) / integral;
}

/** Taper (aperture) efficiency: |sum w|^2 / (N sum w^2). */
export function taperEfficiency(w) {
  const s = w.reduce((a, b) => a + b, 0);
  const s2 = w.reduce((a, b) => a + b * b, 0);
  return (s * s) / (w.length * s2);
}

/** Largest scan angle (rad) free of grating lobes for spacing d (in wavelengths). */
export function gratingFreeScan(d) {
  if (d <= 0.5) return Math.PI / 2;
  if (d >= 1) return 0;
  return Math.asin(1 / d - 1);
}

/** Deterministic pseudo-random element failures (mulberry32), for reproducible what-ifs. */
export function failedElements(N, fraction, seed = 1) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: N }, (_, i) => [rand(), i]).sort((p, q) => p[0] - q[0]);
  return new Set(order.slice(0, Math.round(fraction * N)).map((p) => p[1]));
}

// --------------------------------------------------------- planar array
/** Separable uniform rectangular array: |AF(u, v)| normalised, on an n x n grid of (u, v). */
export function planarGrid(wx, wy, dx, dy, theta0, phi0, n = 181) {
  const u0 = Math.sin(theta0) * Math.cos(phi0);
  const v0 = Math.sin(theta0) * Math.sin(phi0);
  const phx = wx.map((_, i) => -2 * Math.PI * dx * (i - (wx.length - 1) / 2) * u0);
  const phy = wy.map((_, i) => -2 * Math.PI * dy * (i - (wy.length - 1) / 2) * v0);
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const t = -1 + (2 * k) / (n - 1);
    ax[k] = afMag(wx, phx, dx, t);
    ay[k] = afMag(wy, phy, dy, t);
  }
  const mx = Math.max(...ax);
  const my = Math.max(...ay);
  const out = new Float64Array(n * n); // row j = v, column i = u
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j * n + i] = (ax[i] / mx) * (ay[j] / my);
  return { grid: out, n, u0, v0 };
}

/**
 * Grating lobes of a rectangular lattice steered to (u0, v0): the replicas of the main beam at
 * (u0 - p / dx, v0 - q / dy) that land inside the visible disk u^2 + v^2 <= 1 (the rim counts,
 * as an endfire lobe does). Checking each axis on its own is not enough: a replica can clear the
 * line |u| = 1 and still lie outside the disk.
 */
export function planarGratingLobes(dx, dy, u0, v0) {
  const out = [];
  const P = Math.ceil(2 * dx);
  const Q = Math.ceil(2 * dy); // |u0 - p / dx| <= 1 needs |p| <= 2 dx
  for (let p = -P; p <= P; p++) {
    for (let q = -Q; q <= Q; q++) {
      if (p === 0 && q === 0) continue;
      const u = u0 - p / dx;
      const v = v0 - q / dy;
      if (u * u + v * v <= 1 + 1e-12) out.push([u, v]);
    }
  }
  return out;
}

/**
 * Directivity (linear) of a separable rectangular array of isotropic elements, in closed form:
 * the radiated power is 4 pi sum_mn a_m a_n cos(phi_m - phi_n) sinc(k |r_m - r_n|), summed here
 * over element-pair offsets with the autocorrelation of each axis's excitation.
 */
export function planarDirectivity(wx, wy, dx, dy, theta0, phi0) {
  const u0 = Math.sin(theta0) * Math.cos(phi0);
  const v0 = Math.sin(theta0) * Math.sin(phi0);
  const phx = steeringPhases(wx.length, dx, Math.asin(u0));
  const phy = steeringPhases(wy.length, dy, Math.asin(v0));
  const corr = (w, ph) => {
    const N = w.length;
    const out = [];
    for (let s = 1 - N; s < N; s++) {
      let re = 0;
      let im = 0;
      for (let m = Math.max(0, -s); m < Math.min(N, N - s); m++) {
        re += w[m + s] * w[m] * Math.cos(ph[m + s] - ph[m]);
        im += w[m + s] * w[m] * Math.sin(ph[m + s] - ph[m]);
      }
      out.push([s, re, im]);
    }
    return out;
  };
  const cy = corr(wy, phy);
  let integral = 0;
  for (const [sx, ax, bx] of corr(wx, phx)) {
    for (const [sy, ay, by] of cy) {
      const r = 2 * Math.PI * Math.hypot(dx * sx, dy * sy);
      integral += (ax * ay - bx * by) * (r === 0 ? 1 : Math.sin(r) / r);
    }
  }
  return (afMag(wx, phx, dx, u0) ** 2 * afMag(wy, phy, dy, v0) ** 2) / integral;
}
