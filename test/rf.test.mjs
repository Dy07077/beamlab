import { test } from "node:test";
import assert from "node:assert/strict";
import { fspl, twoRay, planeEarth, breakpoint, logDistance, thermalNoise, cascade, sensitivity, sfdr, received, C0 } from "../js/rf.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b} (tol ${tol})`);

test("free-space path loss: 2.4 GHz over 1 km is 100.05 dB and grows 20 dB/decade", () => {
  close(fspl(2.4e9, 1000), 100.05, 0.01);
  close(fspl(2.4e9, 10000) - fspl(2.4e9, 1000), 20, 1e-9);
  close(fspl(C0 / (4 * Math.PI), 1), 0, 1e-9, "unit loss when d = lambda / 4 pi");
});

test("kTB is -174 dBm/Hz at 290 K", () => {
  close(thermalNoise(1), -173.98, 0.01);
  close(thermalNoise(1e6), -113.98, 0.01);
});

test("two-ray model: free space close in, d^4 plane-earth law far away", () => {
  const f = 900e6, ht = 30, hr = 1.5;
  const dc = breakpoint(f, ht, hr);
  close(dc, (4 * ht * hr * f) / C0, 1e-9);
  const far = 30 * dc;
  close(twoRay(f, far, ht, hr), planeEarth(far, ht, hr), 0.3);
  close(twoRay(f, 2 * far, ht, hr) - twoRay(f, far, ht, hr), 12.04, 0.2, "40 dB/decade = 12 dB/octave");
});

test("log-distance model reduces to free space for n = 2", () => {
  close(logDistance(5e9, 250, 2), fspl(5e9, 250), 1e-9);
  close(logDistance(5e9, 100, 3.5) - logDistance(5e9, 10, 3.5), 35, 1e-9);
});

test("Friis noise cascade: LNA + mixer + IF amplifier", () => {
  const r = cascade([
    { name: "LNA", gain: 20, nf: 1.5, iip3: -5 },
    { name: "Mixer", gain: -7, nf: 7, iip3: 10 },
    { name: "IF amp", gain: 30, nf: 10, iip3: 15 },
  ]);
  // F = F1 + (F2 - 1)/G1 + (F3 - 1)/(G1 G2)
  const F = 10 ** 0.15 + (10 ** 0.7 - 1) / 100 + (10 - 1) / (100 * 10 ** -0.7);
  close(r.nf, 10 * Math.log10(F), 1e-9);
  close(r.gain, 43, 1e-9);
  // 1/IIP3 = 1/IIP3_1 + G1/IIP3_2 + G1 G2/IIP3_3 (mW)
  const inv = 1 / 10 ** -0.5 + 100 / 10 ** 1 + (100 * 10 ** -0.7) / 10 ** 1.5;
  close(r.iip3, -10 * Math.log10(inv), 1e-9);
  close(r.share.reduce((a, b) => a + b, 0), 1, 1e-12);
  assert.ok(r.share[0] > r.share[1], "the first stage dominates");
});

test("a lossy first stage adds its loss to the noise figure", () => {
  const r = cascade([{ name: "Cable", gain: -3, nf: 3, iip3: Infinity }, { name: "LNA", gain: 20, nf: 1, iip3: 0 }]);
  close(r.nf, 3 + 1, 0.05);
});

test("sensitivity, SFDR and received power", () => {
  close(sensitivity(3, 1e6, 10), -173.98 + 60 + 3 + 10, 0.01);
  close(sfdr(-10, -100), 60, 1e-12);
  close(received(20, 3, 3, 100, 2), -76, 1e-12);
});
