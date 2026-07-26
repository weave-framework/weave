import { Directive, ElementRef, HostBinding, HostListener, Input } from '@angular/core';

// A directive becomes a Weave `use:` action — it receives the element and returns its teardown. A directive IS
// host bindings and behaviour, and both used to be commented out wholesale: the same "renames things, translates
// nothing" the components had.
@Directive({
  selector: '[appHighlight]',
  host: { class: 'app-highlight', '[attr.data-colour]': 'colour' },
})
export class HighlightDirective {
  @Input() colour: string = 'yellow';

  private active: boolean = false;

  @HostBinding('class.is-active') get isActive(): boolean {
    return this.active;
  }

  // camelCase, the way Angular is usually written: it normalises the name, Weave's `setProperty` does not.
  @HostBinding('style.outlineWidth.px') get outlineWidth(): number {
    return this.active ? 2 : 0;
  }

  constructor(private el: ElementRef) {}

  @HostListener('mouseenter') onEnter(): void {
    this.active = true;
    this.el.nativeElement.style.background = this.colour;
  }

  @HostListener('mouseleave') onLeave(): void {
    this.active = false;
  }
}
