import { OneService } from '@fx/one';
import { TwoService } from '@fx/two';

export class AppShell {
  constructor(
    private readonly one: OneService,
    private readonly two: TwoService,
  ) {}
}
