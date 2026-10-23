'use strict';
/** Strict ISO 8601 parsing. JavaScript's Date.parse is far too lenient for validating input. */

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?)?(Z|[+-]\d{2}:\d{2})?$/;

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/**
 * @returns {{status: 'ok', ms: number} | {status: 'no_offset'} | {status: 'invalid'}}
 *  ok         valid date-time with a UTC offset; `ms` is the instant in epoch milliseconds
 *  no_offset  a valid date or date-time that has no UTC offset
 *  invalid    anything else
 */
function parseIso(value) {
  const m = ISO.exec(value);
  if (!m) return { status: 'invalid' };
  const [, y, mo, d, h, mi, s, frac, off] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = h === undefined ? 0 : Number(h);
  const minute = mi === undefined ? 0 : Number(mi);
  const second = s === undefined ? 0 : Number(s);
  const millis = frac === undefined ? 0 : Number(frac.padEnd(3, '0').slice(0, 3));

  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return { status: 'invalid' };
  if (hour > 23 || minute > 59 || second > 59) return { status: 'invalid' };
  if (off !== undefined && h === undefined) return { status: 'invalid' }; // offset needs a time

  let offsetMinutes = 0;
  if (off !== undefined && off !== 'Z') {
    const oh = Number(off.slice(1, 3));
    const om = Number(off.slice(4, 6));
    if (oh > 23 || om > 59) return { status: 'invalid' };
    offsetMinutes = (off[0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  if (off === undefined) return { status: 'no_offset' };

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day); // setUTCFullYear avoids Date.UTC's 0-99 -> 1900s quirk
  date.setUTCHours(hour, minute, second, millis);
  return { status: 'ok', ms: date.getTime() - offsetMinutes * 60000 };
}

module.exports = { parseIso };
