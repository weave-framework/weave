import { Component, input, output, model } from '@angular/core';

// Modern signal-based component: external template + styleUrls, standalone true, signal inputs/outputs.
@Component({
  selector: 'app-signal',
  standalone: true,
  templateUrl: './signal.component.html',
  styleUrls: ['./signal.component.css', './theme.css'],
})
export class SignalComponent {
  name = input('');
  id = input.required<number>();
  size = model(10);
  changed = output<string>();
}
