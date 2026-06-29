import tseslint from 'typescript-eslint';

/**
 * Weave lint config — enforce EXPLICIT TYPES everywhere in the v0.2 TypeScript source:
 * every variable declaration and parameter is annotated, and every function declares its
 * return type. These rules are syntactic (no type-checking pass needed), so linting is fast.
 *
 * Scope: the eight `packages/*` and the `examples/demo` app. The v0.1 reference (`src/`,
 * `test/`, `examples/v2`, `types/`) and all JS (`*.mjs` tools/bin — no annotations possible)
 * are out of scope.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'node_modules/.weave/**',
      'src/**',
      'test/**',
      'types/**',
      'examples/v2/**',
      '**/*.mjs',
      '**/*.js',
    ],
  },
  {
    files: ['packages/**/*.ts', 'examples/demo/**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: { parser: tseslint.parser },
    rules: {
      '@typescript-eslint/typedef': [
        'error',
        {
          variableDeclaration: true,
          parameter: true,
          memberVariableDeclaration: true,
          propertyDeclaration: true,
          // `const f = () => …` is covered by explicit-function-return-type below.
          variableDeclarationIgnoreFunction: true,
        },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true, // exempt inline callbacks (arr.map(x => …))
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
    },
  }
);
