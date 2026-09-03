import { Injectable } from '@angular/core';
import { FourService } from '@fx/four';

@Injectable({ providedIn: 'root' })
export class ThreeService {
  constructor(private readonly four: FourService) {}

  ping(): void {}
}
