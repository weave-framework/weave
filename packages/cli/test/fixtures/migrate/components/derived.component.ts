import { Component, computed, signal } from '@angular/core';

// A component whose only reactive member is a DERIVED signal — no getter anywhere. Every hand-kept rule for
// "when do we need `computed`" was phrased in terms of getters, so this shape named it and never imported it.
@Component({ selector: 'sps-derived', templateUrl: './derived.component.html' })
export class DerivedComponent {
  readonly count = signal(0);
  readonly doubled = computed(() => this.count() * 2);
}
