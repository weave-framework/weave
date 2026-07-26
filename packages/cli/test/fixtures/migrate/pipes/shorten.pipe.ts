import { Pipe, PipeTransform } from '@angular/core';

// A pipe is the cleanest conversion available: in Weave it is simply a function.
@Pipe({ name: 'shorten', pure: false })
export class ShortenPipe implements PipeTransform {
  transform(value: string, max: number = 10): string {
    return value.length > max ? `${value.slice(0, max)}…` : value;
  }

  private helper(): void {}
}
