import { OneService } from '@fx/one';
import { TwoService } from '@fx/two';
import { ThreeService } from '@fx/three';
import { ShellComponent } from './app/shell/shell.component';
import { routes } from './app/routes';

export class AppShell {
  readonly routes = routes;

  constructor(
    private readonly one: OneService,
    private readonly two: TwoService,
    private readonly three: ThreeService,
    private readonly shell: ShellComponent,
  ) {}
}
