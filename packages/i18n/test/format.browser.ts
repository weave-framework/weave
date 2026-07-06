import { test, assert } from '../../../tools/harness.js';
import {
  createI18n,
  setLocale,
  formatNumber,
  formatCurrency,
  formatPercent,
  formatDate,
  formatRelativeTime,
  formatList,
} from '@weave-framework/i18n';

/* Explicit-locale formatters are deterministic and touch no i18n instance. */

test('formatNumber with an explicit locale + options', () => {
  assert.equal(formatNumber(1234.5, undefined, 'en-US'), '1,234.5');
  assert.equal(
    formatNumber(1234.5, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, 'en-US'),
    '1,234.50'
  );
  assert.equal(formatNumber(1234.5, undefined, 'de-DE'), '1.234,5', 'locale-correct grouping/decimal');
});

test('formatCurrency applies the currency style', () => {
  const out: string = formatCurrency(9.9, 'EUR', undefined, 'en-US');
  assert.ok(out.includes('9.90'), `has the amount (got ${out})`);
  assert.ok(out.includes('€'), `has the currency symbol (got ${out})`);
});

test('formatPercent treats the value as a ratio', () => {
  assert.equal(formatPercent(0.42, undefined, 'en-US'), '42%');
});

test('formatDate accepts a Date / epoch / string and honors options', () => {
  const d: Date = new Date(Date.UTC(2026, 6, 6)); // 2026-07-06 UTC
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' };
  assert.equal(formatDate(d, opts, 'en-US'), '07/06/2026', 'from a Date');
  assert.equal(formatDate(d.getTime(), opts, 'en-US'), '07/06/2026', 'from epoch ms');
  assert.equal(formatDate('2026-07-06T00:00:00Z', opts, 'en-US'), '07/06/2026', 'from an ISO string');
});

test('formatRelativeTime formats past and future', () => {
  assert.equal(formatRelativeTime(-3, 'day', undefined, 'en-US'), '3 days ago');
  assert.equal(formatRelativeTime(2, 'hour', undefined, 'en-US'), 'in 2 hours');
});

test('formatList joins locale-correctly', () => {
  assert.equal(formatList(['a', 'b', 'c'], undefined, 'en-US'), 'a, b, and c');
});

test('formatters do not throw when no i18n instance exists (runtime default locale)', () => {
  // No createI18n() called yet in this test — currentLocale() → undefined → Intl default.
  const out: string = formatNumber(1000);
  assert.ok(typeof out === 'string' && out.length > 0, `returns a string with the default locale (got ${out})`);
});

test('the default locale follows the active i18n instance (reactive source)', async () => {
  // Creating the global instance last, so the no-instance test above is unaffected.
  createI18n({ lang: 'en-US', messages: { 'en-US': {}, 'de-DE': {} } });
  assert.equal(formatNumber(1234.5), '1,234.5', 'uses the active locale when none is passed');
  await setLocale('de-DE');
  assert.equal(formatNumber(1234.5), '1.234,5', 're-resolves to the new active locale');
});
