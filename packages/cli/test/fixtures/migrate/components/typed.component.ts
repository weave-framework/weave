import { Component, Input, HostListener } from '@angular/core';

// The shape a real component has: @Inputs with BOTH a declared type and a default, plus getters. All three used
// to be thrown away — props came out as `unknown` with no defaults, and getters vanished entirely.
@Component({ selector: 'app-typed', template: '<b>{{ label }}</b>' })
export class TypedComponent {
  @Input() color: string = 'sps-default';
  @Input() enabled: boolean = true;
  @Input() items: string[] = [];
  @Input() label: string = null;
  @Input() required: number;

  get hasColor(): boolean {
    return !!this.color;
  }

  @HostListener('click') onClick(): void {}
}
