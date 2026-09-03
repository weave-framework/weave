import { OneService } from '@fx/one';
import { TwoService } from '@fx/two';
import { ThreeService } from '@fx/three';
import { ShellComponent } from './app/shell/shell.component';

export class AppShell {
  constructor(
    private readonly one: OneService,
    private readonly two: TwoService,
    private readonly three: ThreeService,
    private readonly shell: ShellComponent,
  ) {}
}
