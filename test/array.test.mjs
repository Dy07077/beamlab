import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEG, TAPERS, ELEMENTS, chebyshev, taylor, steeringPhases, afMag, pattern, beamMetrics,
  directivity, directivityIsotropic, taperEfficiency, gratingFreeScan, failedElements, planarGrid,
  planarGratingLobes,
} from "../js/array.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b} (tol ${tol})`);
const uniform = (N) => new Array(N).fill(1);

test("uniform broadside array peaks at N with nulls at sin(theta) = k / (N d)", () => {
  const N = 8, d = 0.5, ph = steeringPhases(N, d, 0);
  close(afMag(uniform(N), ph, d, 0), N, 1e-12);
  close(afMag(uniform(N), ph, d, 1 / (N * d)), 0, 1e-12, "first null");
  close(afMag(uniform(N), ph, d, 2 / (N * d)), 0, 1e-12, "second null");
});

test("half-power beamwidth approaches 0.886 / (N d) radians", () => {
  const N = 32, d = 0.5;
  const p = pattern(uniform(N), steeringPhases(N, d, 0), d, ELEMENTS.isotropic.f, 20001);
  const m = beamMetrics(p.theta, p.totalDb);
  close(m.hpbw, 0.886 / (N * d), 0.01 * (0.886 / (N * d)));
  close(m.sll, -13.26, 0.1, "first sidelobe of a uniform array");
});

test("steering moves the main lobe to theta0", () => {
  for (const deg of [-40, 15, 55]) {
    const N = 16, d = 0.5;
    const p = pattern(uniform(N), steeringPhases(N, d, deg * DEG), d, ELEMENTS.isotropic.f, 7201);
    close(beamMetrics(p.theta, p.totalDb).peak / DEG, deg, 0.05);
  }
});

test("grating lobes appear where theory predicts", () => {
  const N = 16, d = 1.0, t0 = 30 * DEG;
  const p = pattern(uniform(N), steeringPhases(N, d, t0), d, ELEMENTS.isotropic.f, 7201);
  const m = beamMetrics(p.theta, p.totalDb, t0);
  close(m.peak / DEG, 30, 0.05);
  assert.equal(m.gratingLobes.length, 1);
  close(m.gratingLobes[0] / DEG, Math.asin(Math.sin(t0) - 1 / d) / DEG, 0.05);
  close(gratingFreeScan(0.6) / DEG, Math.asin(1 / 0.6 - 1) / DEG, 1e-9);
  assert.equal(gratingFreeScan(0.5), Math.PI / 2);
});

test("endfire grating lobes at the edge of the visible region are reported", () => {
  // d = λ at broadside: the replicas of the main beam sit exactly at ±90°
  const N = 16, d = 1.0;
  const p = pattern(uniform(N), steeringPhases(N, d, 0), d, ELEMENTS.isotropic.f, 7201);
  const m = beamMetrics(p.theta, p.totalDb, 0);
  close(m.peak, 0, 1e-12);
  assert.deepEqual(m.gratingLobes.map((t) => Math.round(t / DEG)), [-90, 90]);
  close(m.sll, 0, 1e-6);
});

test("Dolph-Chebyshev weights give equal sidelobes at the requested level", () => {
  for (const [N, sll] of [[16, 30], [11, 40], [24, 25]]) {
    const w = chebyshev(N, sll);
    const p = pattern(w, steeringPhases(N, 0.5, 0), 0.5, ELEMENTS.isotropic.f, 20001);
    close(beamMetrics(p.theta, p.totalDb).sll, -sll, 0.05, `N=${N}`);
    for (let i = 0; i < N; i++) close(w[i], w[N - 1 - i], 1e-9, "symmetry");
  }
});

test("Chebyshev weights match scipy.signal.windows.chebwin (even and odd N)", () => {
  const ref8 = [0.26221649, 0.51874705, 0.81196007, 1.0, 1.0, 0.81196007, 0.51874705, 0.26221649];
  chebyshev(8, 30).forEach((w, i) => close(w, ref8[i], 1e-7));
  const ref7 = [0.15941069, 0.47936432, 0.83973877, 1.0, 0.83973877, 0.47936432, 0.15941069];
  chebyshev(7, 40).forEach((w, i) => close(w, ref7[i], 1e-7));
});

test("Taylor weights match scipy.signal.windows.taylor(10, nbar=4, sll=30)", () => {
  const ref = [0.26649818, 0.4299229, 0.66206478, 0.8662078, 0.9843294, 0.9843294, 0.8662078, 0.66206478, 0.4299229, 0.26649818];
  taylor(10, 30, 4).forEach((w, i) => close(w, ref[i], 1e-7));
});

test("Taylor taper holds its near-in sidelobes close to the design level", () => {
  const N = 32, w = TAPERS.taylor.weights(N, 35, 5);
  const p = pattern(w, steeringPhases(N, 0.5, 0), 0.5, ELEMENTS.isotropic.f, 20001);
  close(beamMetrics(p.theta, p.totalDb).sll, -35, 1.0);
});

test("directivity: N for a uniform half-wavelength array, and the integrator agrees with the closed form", () => {
  for (const N of [4, 16, 33]) {
    const w = uniform(N), ph = steeringPhases(N, 0.5, 0);
    close(directivityIsotropic(w, ph, 0.5), N, 1e-6 * N);
    close(10 * Math.log10(directivity(w, ph, 0.5)), 10 * Math.log10(N), 0.05);
  }
  const w = TAPERS.hamming.weights(12), ph = steeringPhases(12, 0.7, 25 * DEG);
  close(10 * Math.log10(directivity(w, ph, 0.7)), 10 * Math.log10(directivityIsotropic(w, ph, 0.7)), 0.05);
});

test("a cosine element turns the fan beam into a pencil beam: +6 dB at broadside", () => {
  // the isotropic array radiates a fan around its axis; a cos(theta) element keeps a quarter of that
  // circle's power-weighted average (front half, cos^2 weighting), i.e. 10 log10(4) = 6.02 dB
  const w = uniform(64), ph = steeringPhases(64, 0.5, 0);
  const gain = 10 * Math.log10(directivity(w, ph, 0.5, ELEMENTS.cosine) / directivity(w, ph, 0.5));
  close(gain, 6.02, 0.1);
});

test("directivity stays exact for long, widely spaced arrays (64 elements at d = λ gives N = 18.06 dBi)", () => {
  // these are the arrays a coarse sphere grid gets wrong: lobes far narrower than the grid
  for (const [N, d, deg, taper] of [[64, 1.0, 0, "uniform"], [64, 1.5, 0, "uniform"], [64, 0.5, 0, "uniform"], [48, 0.8, 40, "chebyshev"], [60, 1.2, 15, "hamming"]]) {
    const w = TAPERS[taper].weights(N, 30), ph = steeringPhases(N, d, deg * DEG);
    close(10 * Math.log10(directivity(w, ph, d)), 10 * Math.log10(directivityIsotropic(w, ph, d)), 0.01, `N=${N} d=${d}`);
  }
  close(10 * Math.log10(directivity(uniform(64), steeringPhases(64, 1, 0), 1)), 10 * Math.log10(64), 0.01);
});

test("single elements: λ/2 dipole 2.15 dBi, cosine element 10 log10 6", () => {
  close(10 * Math.log10(directivity([1], [0], 0.5, ELEMENTS.dipole)), 2.15, 0.005);
  close(directivity([1], [0], 0.5, ELEMENTS.cosine), 6, 1e-6);
  close(directivity([1], [0], 0.5, ELEMENTS.isotropic), 1, 1e-9);
});

test("dipole arrays agree with a brute-force sphere integral of the 3-D pattern", () => {
  // independent of the u / azimuth split: integrate over (polar, azimuth) with |E|^2 from the direction
  const brute = (w, ph, d, n = 600) => {
    let power = 0, peak = 0;
    for (let i = 0; i < n; i++) {
      const th = ((i + 0.5) * Math.PI) / n, st = Math.sin(th);
      for (let j = 0; j < 2 * n; j++) {
        const u = st * Math.cos(((j + 0.5) * Math.PI) / n);
        const p = afMag(w, ph, d, u) ** 2 * (1 - u * u < 1e-12 ? 0 : Math.cos((Math.PI / 2) * u) ** 2 / (1 - u * u));
        power += p * st;
        peak = Math.max(peak, p);
      }
    }
    return (4 * Math.PI * peak) / (power * (Math.PI / n) ** 2);
  };
  for (const [N, d, deg] of [[4, 0.5, 0], [3, 0.9, 20]]) {
    const w = uniform(N), ph = steeringPhases(N, d, deg * DEG);
    close(10 * Math.log10(directivity(w, ph, d, ELEMENTS.dipole)), 10 * Math.log10(brute(w, ph, d)), 0.01, `N=${N}`);
  }
});

test("taper efficiency: 1 for uniform, below 1 for tapers", () => {
  close(taperEfficiency(uniform(10)), 1, 1e-12);
  const eff = taperEfficiency(TAPERS.hann.weights(64));
  assert.ok(eff > 0.6 && eff < 0.7, `got ${eff}`);
});

test("phase quantisation raises the sidelobes", () => {
  const N = 32, d = 0.5, t0 = 7 * DEG;
  const sll = (bits) => {
    const p = pattern(uniform(N), steeringPhases(N, d, t0, bits), d, ELEMENTS.isotropic.f, 20001);
    return beamMetrics(p.theta, p.totalDb).sll;
  };
  assert.ok(sll(2) > sll(0) + 1, `${sll(2)} vs ${sll(0)}`);
});

test("element failures are reproducible", () => {
  const a = failedElements(32, 0.25, 7), b = failedElements(32, 0.25, 7);
  assert.equal(a.size, 8);
  assert.deepEqual([...a].sort(), [...b].sort());
});

test("planar array peaks at the steering direction", () => {
  const { grid, n } = planarGrid(uniform(8), uniform(8), 0.5, 0.5, 30 * DEG, 45 * DEG, 201);
  let best = 0;
  for (let i = 1; i < grid.length; i++) if (grid[i] > grid[best]) best = i;
  const u = -1 + (2 * (best % n)) / (n - 1), v = -1 + (2 * Math.floor(best / n)) / (n - 1);
  close(u, Math.sin(30 * DEG) * Math.cos(45 * DEG), 0.011);
  close(v, Math.sin(30 * DEG) * Math.sin(45 * DEG), 0.011);
});

test("planar directivity reduces to the linear result for a 1 x N array", async () => {
  const { planarDirectivity } = await import("../js/array.js");
  const w = TAPERS.hamming.weights(12);
  const lin = directivityIsotropic(w, steeringPhases(12, 0.5, 20 * DEG), 0.5);
  const pla = planarDirectivity(w, [1], 0.5, 0.5, 20 * DEG, 0);
  close(10 * Math.log10(pla), 10 * Math.log10(lin), 1e-4);
  // broadside aperture of area A = (N d)^2 wavelengths^2 radiating into both half-spaces: D ~ 2 pi A
  const D = planarDirectivity(new Array(10).fill(1), new Array(10).fill(1), 0.5, 0.5, 0, 0);
  close(10 * Math.log10(D), 10 * Math.log10(2 * Math.PI * 25), 0.4);
});

test("planar directivity agrees with a brute-force sphere integral", async () => {
  const { planarDirectivity } = await import("../js/array.js");
  const wx = TAPERS.hamming.weights(6), wy = uniform(4), dx = 0.6, dy = 0.45, t0 = 30 * DEG, p0 = 20 * DEG;
  const u0 = Math.sin(t0) * Math.cos(p0), v0 = Math.sin(t0) * Math.sin(p0);
  const phx = steeringPhases(6, dx, Math.asin(u0)), phy = steeringPhases(4, dy, Math.asin(v0));
  const n = 600;
  let power = 0;
  for (let i = 0; i < n; i++) {
    const th = ((i + 0.5) * Math.PI) / n, st = Math.sin(th);
    for (let j = 0; j < 2 * n; j++) {
      const p = ((j + 0.5) * Math.PI) / n;
      power += (afMag(wx, phx, dx, st * Math.cos(p)) * afMag(wy, phy, dy, st * Math.sin(p))) ** 2 * st;
    }
  }
  const peak = (afMag(wx, phx, dx, u0) * afMag(wy, phy, dy, v0)) ** 2;
  const brute = (4 * Math.PI * peak) / (power * (Math.PI / n) ** 2);
  close(10 * Math.log10(planarDirectivity(wx, wy, dx, dy, t0, p0)), 10 * Math.log10(brute), 0.01);
});

test("planar grating lobes are judged against the visible disk, not each axis alone", () => {
  // scanned to 75° at φ = 45° with 0.65λ spacing: the x replica clears |u| = 1 but lies outside the disk
  const u0 = Math.sin(75 * DEG) * Math.cos(45 * DEG), v0 = Math.sin(75 * DEG) * Math.sin(45 * DEG);
  assert.ok(0.65 > 1 / (1 + u0), "the old per-axis rule would have flagged this");
  assert.deepEqual(planarGratingLobes(0.65, 0.65, u0, v0), []);
  // 1.1λ along x scanned to 40° in the x-z plane: one replica at u0 - 1/1.1 ...
  const u1 = Math.sin(40 * DEG);
  const lobes = planarGratingLobes(1.1, 0.5, u1, 0);
  assert.equal(lobes.length, 1);
  close(lobes[0][0], u1 - 1 / 1.1, 1e-12);
  // ... and with 1.1λ along y as well, two diagonal replicas join it at v = ±1/1.1
  assert.equal(planarGratingLobes(1.1, 1.1, u1, 0).length, 3);
  // half-wavelength spacing stays clean up to the 75° scan limit of the tab
  for (const deg of [0, 30, 60, 75]) assert.deepEqual(planarGratingLobes(0.5, 0.5, Math.sin(deg * DEG), 0), []);
});

test("planar grating lobes agree with a brute-force search of the pattern", () => {
  for (const [dx, dy, th, ph] of [[0.8, 0.8, 60, 45], [0.65, 0.65, 75, 45], [1.0, 0.6, 35, 20], [0.9, 1.2, 50, 120], [0.55, 0.7, 20, -60]]) {
    const u0 = Math.sin(th * DEG) * Math.cos(ph * DEG), v0 = Math.sin(th * DEG) * Math.sin(ph * DEG);
    const n = 601;
    const { grid } = planarGrid(uniform(12), uniform(12), dx, dy, th * DEG, ph * DEG, n);
    const at = (i, j) => grid[j * n + i];
    let peaks = 0;
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const u = -1 + (2 * i) / (n - 1), v = -1 + (2 * j) / (n - 1);
        if (u * u + v * v > 1 || at(i, j) < 0.9) continue;
        if (at(i, j) >= at(i - 1, j) && at(i, j) >= at(i + 1, j) && at(i, j) >= at(i, j - 1) && at(i, j) >= at(i, j + 1)) peaks++;
      }
    }
    assert.equal(planarGratingLobes(dx, dy, u0, v0).length, peaks - 1, `dx=${dx} dy=${dy} scan ${th}/${ph}`);
  }
});
