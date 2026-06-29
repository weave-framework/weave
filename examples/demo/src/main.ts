import { mountComponent } from '@weave/runtime/dom';
import './components/register-elements'; // defines <weave-badge> before first render
import App from './app/shell';

const root = document.getElementById('app');
if (root) mountComponent(App, root);
