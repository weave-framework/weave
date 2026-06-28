import { mountComponent } from '@weave/runtime/dom';
import Counter from './counter.weave';

const app = document.getElementById('app');
if (app) mountComponent(Counter, app);
