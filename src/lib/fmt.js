// Number formatting shared by the fitting readouts.
//
// React-free on purpose so `regression.test.mjs` (Node, which cannot import .jsx) can pin the
// examples below directly.

const UNITS = [['', 1], ['k', 1e3], ['M', 1e6], ['B', 1e9]];

/**
 * Resource readouts, formatted the way pyfa does it: a fixed number of SIGNIFICANT digits, with a
 * k/M suffix once the value outgrows its column. Four digits is pyfa's own choice — it shows
 * 1362.0 / 1363.8 as `1.362k` / `1.364k` and 19678.0 / 20843.8 as `19.68k` / `20.84k`. Same four
 * digits either way; only the decimal point moves. That is what makes it useful in a narrow strip:
 * the string width is near-constant, but you never lose precision to a blanket `.toFixed(1)` that
 * would render both of a battleship's 19678/20843 grid figures as "19.7k"/"20.8k".
 *
 * Trailing zeros are dropped, so a round total reads `400` and `5k` rather than `400.0` / `5.000k`.
 */
export function fmtResource(v, sig = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  let i = 0;
  while (i < UNITS.length - 1 && a >= UNITS[i + 1][1]) i++;
  let s = (n / UNITS[i][1]).toPrecision(sig);
  // Rounding can push the mantissa up a whole unit (999,960 would render "1000k"); promote instead.
  if (Math.abs(Number(s)) >= 1000 && i < UNITS.length - 1) {
    i++;
    s = (n / UNITS[i][1]).toPrecision(sig);
  }
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s + UNITS[i][0];
}
