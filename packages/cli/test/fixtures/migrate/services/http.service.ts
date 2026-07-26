import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

// Calls only get/post/delete — the guidance must name those and stay quiet about put/patch.
@Injectable({ providedIn: 'root' })
export class HttpService {
  constructor(private http: HttpClient) {}

  load(id: string): void {
    this.http.get<{ id: string }>(`/items/${id}`);
  }

  save(body: unknown): void {
    this.http.post<void>('/items', body);
  }

  remove(id: string): void {
    this.http.delete<void>(`/items/${id}`);
  }
}
