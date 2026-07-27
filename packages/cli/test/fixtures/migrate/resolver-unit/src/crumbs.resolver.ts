// A route resolver: a class with a `resolve(route)` method and no decorator. It becomes a loader FUNCTION, so
// its name changes — and anything importing the class has to be repointed with it.
export class CrumbsResolver {
  resolve(route: { path: string }): string[] {
    return [route.path];
  }
}
