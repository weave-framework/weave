import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CrumbsService {
  crumbsSig = signal<string[]>([]);
}
