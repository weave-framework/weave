import { Component, Input, Output, EventEmitter } from '@angular/core';

// Classic decorator-based component: inline template + inline styles, @Input/@Output, standalone stated false.
@Component({
  selector: 'app-decorator',
  standalone: false,
  template: '<h1>{{ title }}</h1>',
  styles: ['h1 { color: red }', 'h1 { font-weight: bold }'],
})
export class DecoratorComponent {
  @Input() title = '';
  @Input('aliased') count = 0;
  @Output() saved = new EventEmitter<void>();
}
