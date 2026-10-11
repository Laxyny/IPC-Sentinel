import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'tests/fixtures/**'] },
  ...tseslint.configs.recommended,
);
