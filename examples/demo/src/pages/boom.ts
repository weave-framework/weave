/** A route that fails on purpose — demonstrates the <ErrorBoundary> in app.html. */
export const template: string = `<p>This is never reached — setup throws first.</p>`;

export function setup(): never {
  throw new Error('Boom! This route throws during setup, on purpose.');
}
