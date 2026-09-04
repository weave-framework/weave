import { Routes } from '@angular/router';
import { SoloComponent } from './screens/solo.component';
import { SharedComponent } from './screens/shared.component';

export const routes: Routes = [
  { path: 'solo', component: SoloComponent },
  { path: 'a', component: SharedComponent },
  { path: 'b', component: SharedComponent },
];
