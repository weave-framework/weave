import { Component, inject } from '@angular/core';
import { ApiService } from './api.service';

@Component({ selector: 'app-widget', standalone: true, template: '' })
export class WidgetComponent {
  private api = inject(ApiService);
  private thing: any; // no resolvable type → a call through it is dynamic

  constructor(private helper: HelperService) {}

  load(): void {
    this.refresh(); // self-call → WidgetComponent.refresh
    this.api.get('/x'); // through inject() field → ApiService.get
    this.helper.format(); // through ctor field → HelperService.format
    this.thing.doIt(); // unresolved field type → dynamic (?.doIt)
  }

  refresh(): void {}
}

class HelperService {
  format(): void {}
}
