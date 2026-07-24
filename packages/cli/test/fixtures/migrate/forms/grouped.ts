// No @angular/forms import — a plain .group() call here must NOT be mistaken for a form (the import is the gate).
const chart = { group: (o: unknown) => o };
export const g = chart.group({ notAControl: 1 });
