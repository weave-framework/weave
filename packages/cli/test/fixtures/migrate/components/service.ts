import { Injectable } from '@angular/core';

// Not a component — findComponents must yield nothing for this file (no @Component decorator).
@Injectable({ providedIn: 'root' })
export class DataService {
  load(): void {}
}
