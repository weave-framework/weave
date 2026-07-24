import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { debounce } from 'lodash-es';
const lazy = () => import('./app/lazy.routes');
bootstrapApplication(AppComponent);
