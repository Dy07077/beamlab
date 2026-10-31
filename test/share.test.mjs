import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeStages, decodeStages, MAX_STAGES, MAX_NAME } from "../js/share.js";

// what the app does: put the chain in the URL hash, then read it back from a fresh page load
const throughUrl = (stages) => {
  const p = new URLSearchParams();
  p.set("preset", "superhet");
  p.set("stages", encodeStages(stages));
  const m = new URL(`https://example.org/beamlab/#rx?${p}`).hash.match(/^#(\w+)(?:\?(.*))?$/); // as in readHash
  return decodeStages(new URLSearchParams(m[2]).get("stages"));
};

test("an edited receiver chain survives edit -> share -> reopen", () => {
  const edited = [
    { name: "LNA & filter #1", gain: 21.5, nf: 0.85, iip3: -3 },
    { name: "混频器", gain: -7, nf: 9.2, iip3: 14.5 },
    { name: "Stage 3", gain: 30, nf: 6, iip3: 2 },
  ];
  assert.deepEqual(throughUrl(edited), edited);
  assert.deepEqual(throughUrl([]), []);
});

test("blank fields stay blank instead of turning into zeros", () => {
  const [st] = throughUrl([{ name: "Amp", gain: 12, nf: NaN, iip3: NaN }]);
  assert.equal(st.gain, 12);
  assert.ok(Number.isNaN(st.nf) && Number.isNaN(st.iip3));
});

test("malformed or oversized chains are rejected so the preset is used", () => {
  for (const bad of ["not json", "{}", "[[1,2,3]]", '[["a",1,2,3,4]]', JSON.stringify(new Array(25).fill(["s", 1, 1, 1]))]) {
    assert.equal(decodeStages(bad), null, bad);
  }
});

test("the largest chain the editor allows still fits in a link unchanged", () => {
  // the editor stops adding stages at MAX_STAGES and caps names at MAX_NAME characters
  const name = (i) => `级 ${i} · ${"x".repeat(MAX_NAME)}`.slice(0, MAX_NAME);
  const big = Array.from({ length: MAX_STAGES }, (_, i) => ({ name: name(i), gain: i - 3.5, nf: i / 10, iip3: 20 - i }));
  assert.equal(big[0].name.length, MAX_NAME);
  assert.deepEqual(throughUrl(big), big);
  // a name typed past the cap elsewhere is cut the same way on both sides of the link
  const [st] = throughUrl([{ name: "y".repeat(MAX_NAME + 9), gain: 1, nf: 1, iip3: 1 }]);
  assert.equal(st.name, "y".repeat(MAX_NAME));
});
