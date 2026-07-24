export class Logic {
  // 2 ifs (one with else), 1 ternary, 1 switch.
  decide(n: number): string {
    if (n > 0) {
      if (n > 10) {
        return 'big';
      } else {
        return 'small';
      }
    }
    const sign = n < 0 ? 'neg' : 'zero';
    switch (sign) {
      case 'neg':
        return 'negative';
      default:
        return 'zero';
    }
  }

  // no branches → omitted from the facts.
  noop(): void {}
}
