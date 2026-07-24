import { Component, Input, Output, EventEmitter } from '@angular/core';
import { User } from '@sps-interfaces';
import { Observable } from 'rxjs';
import { UserService } from './user.service';
import { LoginComponent } from './login.component';

@Component({
  selector: 'app-root',
  standalone: true,
  template: '<router-outlet />',
})
export class AppComponent {
  @Input() user: User | null = null;
  @Output() loggedOut = new EventEmitter<void>();
  data: Observable<number> | null = null;

  constructor(private users: UserService) {}
}
