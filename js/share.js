// Receiver chains in share links. Pure functions, no DOM: shared by the app and the tests.

// The editor enforces the same limits, so every chain it can build fits in a link unchanged.
export const MAX_STAGES = 24;
export const MAX_NAME = 40;

/** Encode stages as JSON rows [name, gain, nf, iip3]; a blank (non-finite) number becomes null. */
export function encodeStages(stages) {
  const num = (x) => (Number.isFinite(+x) ? +(+x).toPrecision(6) : null);
  return JSON.stringify(stages.map((s) => [String(s.name).slice(0, MAX_NAME), num(s.gain), num(s.nf), num(s.iip3)]));
}

/** Inverse of encodeStages. Returns null for anything malformed, so the caller can fall back to a preset. */
export function decodeStages(text) {
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length > MAX_STAGES) return null;
  const num = (x) => (typeof x === "number" ? x : NaN);
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 4) return null;
    const [name, gain, nf, iip3] = row;
    out.push({ name: String(name).slice(0, MAX_NAME), gain: num(gain), nf: num(nf), iip3: num(iip3) });
  }
  return out;
}
