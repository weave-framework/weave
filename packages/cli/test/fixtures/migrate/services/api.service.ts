import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Logger } from './logger.service';

// Root singleton: constructor injection + an inject() call, public + private methods.
@Injectable({ providedIn: 'root' })
export class ApiService {
  private log = inject(Logger);

  constructor(private http: HttpClient) {}

  get(url: string): void {}
  post(url: string, body: unknown): void {}

  private buildHeaders(): void {}
}
