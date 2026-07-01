import { test, assert } from '../../../../tools/harness.js';
import { announce, clearAnnouncer, liveAnnouncerElement } from '@weave-framework/ui/cdk';

test('live-announcer: polite region is visually hidden with aria-live=polite', () => {
  const el = liveAnnouncerElement('polite');
  assert.equal(el.getAttribute('aria-live'), 'polite');
  assert.equal(el.getAttribute('aria-atomic'), 'true');
  assert.equal(el.parentElement, document.body);
  assert.ok(el.style.position === 'absolute' && el.style.width === '1px', 'sr-only');
});

test('live-announcer: announce sets the message text', () => {
  announce('3 results');
  assert.equal(liveAnnouncerElement('polite').textContent, '3 results');
});

test('live-announcer: assertive uses the assertive region (role=alert)', () => {
  announce('Error saving', 'assertive');
  const el = liveAnnouncerElement('assertive');
  assert.equal(el.getAttribute('aria-live'), 'assertive');
  assert.equal(el.getAttribute('role'), 'alert');
  assert.equal(el.textContent, 'Error saving');
  assert.notEqual(el, liveAnnouncerElement('polite'), 'separate region per politeness');
});

test('live-announcer: off is a no-op', () => {
  clearAnnouncer();
  announce('ignored', 'off');
  assert.equal(liveAnnouncerElement('polite').textContent, '');
});

test('live-announcer: identical consecutive messages are re-set (cleared first)', () => {
  announce('Saved');
  announce('Saved');
  assert.equal(liveAnnouncerElement('polite').textContent, 'Saved');
});

test('live-announcer: clearAnnouncer empties the regions', () => {
  announce('x');
  announce('y', 'assertive');
  clearAnnouncer();
  assert.equal(liveAnnouncerElement('polite').textContent, '');
  assert.equal(liveAnnouncerElement('assertive').textContent, '');
});
