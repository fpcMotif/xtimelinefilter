/**
 * X's numeric ids — status ids, List ids and user ids alike — as they appear on
 * the wire: digits, no leading zero, bounded so a hostile message cannot smuggle
 * an unbounded string through a field that looks numeric.
 *
 * One copy, imported by every protocol family that validates one. It used to be
 * an unexported literal in both the List-cache and List-usage families, which is
 * exactly how two validators drift apart.
 */
const X_ID = /^[1-9][0-9]{0,63}$/;

export const isXId = (value: unknown): value is string =>
  typeof value === "string" && X_ID.test(value);
