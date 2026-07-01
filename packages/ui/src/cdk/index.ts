/**
 * `@weave-framework/ui/cdk` — the headless behavior layer under the styled Weave UI
 * components (the equivalent of Angular's CDK). Every primitive here is headless
 * (behavior + state, zero styling), signal-native, and zero third-party deps —
 * in-house positioning, overlay stacking, scroll strategies, focus management,
 * a11y key-managers, and observer→signal wrappers.
 *
 * U1 (foundations) ships Platform + Bidi; this barrel grows as each primitive lands.
 */

export * from './platform.js';
export * from './bidi.js';
export * from './portal.js';
export * from './overlay.js';
export * from './positioning.js';
