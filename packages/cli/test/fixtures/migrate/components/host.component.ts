import { Component, HostBinding, HostListener, Input } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

// The host element, declared BOTH ways Angular allows: decorators on members and the decorator's own `host: {}`.
// All of it used to be read past. A @HostBinding getter became a `computed` that nothing read, so a class that was
// always on the element became one that never is — the value was right and the component was still broken.
@Component({
  selector: 'sps-host',
  templateUrl: './host.component.html',
  imports: [RouterModule],
  host: { class: 'sps-block', '[attr.role]': 'role', '(mouseenter)': 'hover(true)' },
})
export class HostComponent {
  @Input() routerLink: string = '';
  @Input() role: string = 'img';

  @HostBinding('attr.aria-label') label: string = 'the logo';
  lastSeen: Date;

  @HostBinding('class.sps-logo') get classSpsLogo(): boolean {
    return true;
  }

  @HostBinding('class.cursor-pointer') get classCursorPointer(): boolean {
    return this.hasRoute;
  }

  @HostBinding('style.width.px') get widthPx(): number {
    return 240;
  }

  get hasRoute(): boolean {
    return this.routerLink.length > 0;
  }

  constructor(private router: Router) {}

  @HostListener('click') onClick(): void {
    if (this.hasRoute) {
      this.router.navigate(this.routerLink);
    }
  }

  @HostListener('window:resize', ['$event']) onResize($event: Event): void {
    this.hover(false);
  }

  hover(on: boolean): void {
    this.label = on ? 'hovered' : 'the logo';
  }
}
