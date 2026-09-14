// Number formatting shared by the fitting readouts.
//
// React-free on purpose so `regression.test.mjs` (Node, which cannot import .jsx) can pin the
// examples below directly.

import { t } from './i18n.js';

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

/**
 * pyfa's `roundToPrec(v, 3)`: three significant digits, but never rounded past the decimal point —
 * 117.988 is 118, not 120. Reproduced rather than approximated because these strings sit next to
 * pyfa's on the user's screen and a disagreement here reads as a calculation disagreement.
 *
 * Distinct from `fmtResource` above, which carries four digits and adds a k/M suffix itself.
 */
export function sig3(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '0';
  return String(+n.toFixed(Math.max(0, 2 - Math.floor(Math.log10(Math.abs(n))))));
}

/**
 * How old a cached market price is, for the line that sits beside it.
 *
 * Coarse on purpose — the question it answers is "is this number still worth anything", and no one
 * decides that on the minute. It rounds DOWN so a figure is never described as fresher than it is:
 * 23 hours reads as hours, not as a day.
 *
 * Null while the price is still inside its refresh window, so a current price carries no label at
 * all and the marker only ever appears when it means something.
 */
export function fmtPriceAge(asOf, now = Date.now()) {
  // `null` is "never priced", not "priced at the epoch" — the subtraction would otherwise turn a
  // missing timestamp into an age of twenty thousand days.
  if (!Number.isFinite(asOf)) return null;
  const ms = now - asOf;
  if (!Number.isFinite(ms) || ms < 3600000) return null;
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return t({ one: '{n} hour old', other: '{n} hours old' }, { n: hours });
  const days = Math.floor(hours / 24);
  return t({ one: '{n} day old', other: '{n} days old' }, { n: days });
}

/**
 * The range chip's tooltip for a missile launcher.
 *
 * A missile's flight time is fractional but it travels in whole-second ticks, so the final tick
 * either happens or it does not: the chip's single figure is the EXPECTED distance, which is a
 * distance the missile never actually flies. pyfa spells the two real outcomes out
 * (`gui/builtinViewColumns/maxRange.py`) and so do we — same wording, same rounding.
 *
 * Both percentages are derived from the SAME rounded figure so they always sum to 100. A whole
 * flight time has only one outcome and drops the split entirely, rather than printing "100% chance
 * to fly 116km", which is just the chip repeating itself.
 *
 * Null for anything that is not a missile, so the caller keeps its own optimal/falloff wording.
 */
export function missileRangeTip(e) {
  if (!e?.isMissile || e.higherChance == null) return null;
  const p = +(e.higherChance * 100).toFixed(1);
  const heading = t('Missile flight range');
  if (!(p > 0)) return heading;
  // One key per outcome line rather than a shared "{pct}% chance to fly" fragment plus a number:
  // the two lines are the same sentence, and splitting the distance out of it leaves a translator
  // no way to reorder the clause.
  const outcome = (pct, m) => t('{pct}% chance to fly {km}km', { pct: sig3(pct), km: sig3(m / 1000) });
  return `${heading}\n${outcome(100 - p, e.lowerRange)}\n${outcome(p, e.higherRange)}`;
}
