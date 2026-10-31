// RF link-budget and receiver-chain mathematics. Pure functions shared by the app and the tests.

export const C0 = 299792458; // m/s
export const K_B = 1.380649e-23; // J/K
export const T0 = 290; // K, IEEE reference temperature

export const dB = (x) => 10 * Math.log10(x);
export const undB = (x) => 10 ** (x / 10);

/** Free-space path loss (dB) at frequency f (Hz) over distance d (m). */
export function fspl(f, d) {
  return 20 * Math.log10((4 * Math.PI * d * f) / C0);
}

/** Two-ray ground-reflection path loss (dB) with reflection coefficient gamma (default -1). */
export function twoRay(f, d, ht, hr, gamma = -1) {
  const lam = C0 / f;
  const dLos = Math.hypot(d, ht - hr);
  const dRef = Math.hypot(d, ht + hr);
  const k = (2 * Math.PI) / lam;
  // field ratio relative to free space at the direct path length
  const re = 1 + gamma * (dLos / dRef) * Math.cos(k * (dRef - dLos));
  const im = -gamma * (dLos / dRef) * Math.sin(k * (dRef - dLos));
  return fspl(f, dLos) - 20 * Math.log10(Math.max(Math.hypot(re, im), 1e-9));
}

/** Plane-earth asymptote of the two-ray model: 40 log d - 20 log(ht hr) (dB). */
export function planeEarth(d, ht, hr) {
  return 40 * Math.log10(d) - 20 * Math.log10(ht * hr);
}

/** Distance beyond which the two-ray loss falls off as d^4: 4 ht hr / lambda. */
export function breakpoint(f, ht, hr) {
  return (4 * ht * hr * f) / C0;
}

/** Log-distance path loss with exponent n referenced to free space at d0. */
export function logDistance(f, d, n, d0 = 1) {
  return fspl(f, d0) + 10 * n * Math.log10(d / d0);
}

/** Thermal noise power kTB in dBm. */
export function thermalNoise(bandwidth, T = T0) {
  return dB(K_B * T * bandwidth * 1e3);
}

/**
 * Cascade of two-port stages [{name, gain, nf, iip3}] (dB, dB, dBm).
 * Returns cumulative gain, noise figure (Friis) and input IP3 after each stage, plus each
 * stage's share of the total noise factor excess (F - 1).
 */
export function cascade(stages) {
  let g = 1; // linear gain before the current stage
  let F = 1;
  let invIp3 = 0; // 1 / IIP3 in 1/mW
  const rows = [];
  const contrib = [];
  stages.forEach((s, i) => {
    const Fi = undB(s.nf);
    const add = i === 0 ? Fi - 1 : (Fi - 1) / g;
    contrib.push(add);
    F += add;
    if (Number.isFinite(s.iip3)) invIp3 += g / undB(s.iip3);
    g *= undB(s.gain);
    rows.push({ name: s.name, gain: dB(g), nf: dB(F), iip3: invIp3 > 0 ? -dB(invIp3) : Infinity });
  });
  const total = F - 1;
  return { rows, share: contrib.map((c) => (total > 0 ? c / total : 0)), gain: dB(g), nf: dB(F), iip3: rows.length ? rows[rows.length - 1].iip3 : Infinity };
}

/** Receiver sensitivity (dBm): noise floor + noise figure + required SNR. */
export function sensitivity(nf, bandwidth, snr) {
  return thermalNoise(bandwidth) + nf + snr;
}

/** Spur-free dynamic range (dB) from input IP3 and the input-referred noise floor. */
export function sfdr(iip3, noiseFloor) {
  return (2 / 3) * (iip3 - noiseFloor);
}

/** Received power (dBm) for a given path loss and antenna gains. */
export function received(pt, gt, gr, pathLoss, losses = 0) {
  return pt + gt + gr - pathLoss - losses;
}
