import { Component, Input, Output, EventEmitter } from '@angular/core';
import { User } from '@sps-interfaces';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  template: '<router-outlet />',
})
export class AppComponent {
  @Input() user: User | null = null;
  @Output() loggedOut = new EventEmitter<void>();
  data: Observable<number> | null = null;
}
