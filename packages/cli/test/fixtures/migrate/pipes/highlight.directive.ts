import { Directive, ElementRef, Input } from '@angular/core';

// A directive becomes a Weave `use:` action — it receives the element and returns its teardown.
@Directive({ selector: '[appHighlight]' })
export class HighlightDirective {
  @Input() colour = 'yellow';

  constructor(private el: ElementRef) {}

  onEnter(): void {
    this.el.nativeElement.style.background = this.colour;
  }
}
