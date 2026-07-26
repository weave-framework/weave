import { Component, Input } from '@angular/core';

// The library's own declarations. `index.ts` used to re-export a file that did not exist, so opening this lib up
// added nothing — which made "coverage is recomputed over the combined source" impossible to actually test.
@Component({ selector: 'ui-badge', standalone: true, template: '<span>{{ label }}</span>' })
export class BadgeComponent {
  @Input() label: string = '';
}
