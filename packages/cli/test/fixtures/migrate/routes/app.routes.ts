import { Routes } from '@angular/router';
import { HomeComponent } from './home.component';
import { AuthGuard } from './auth.guard';

// A standalone `Routes`-typed config: a plain route, a guarded route with children, a lazy route, a redirect.
export const routes: Routes = [
  { path: '', component: HomeComponent },
  {
    path: 'admin',
    component: HomeComponent,
    canActivate: [AuthGuard],
    canDeactivate: [AuthGuard],
    children: [{ path: 'users', component: HomeComponent }],
  },
  { path: 'lazy', loadComponent: () => import('./lazy.component') },
  { path: '**', redirectTo: '' },
];
