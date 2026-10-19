import { test } from 'node:test';
import assert from 'node:assert/strict';
import policy from './maintenance-policy.cjs';
const make = () => {
  const base = {
    name: 'example',
    scripts: { test: 'test' },
    dependencies: { typescript: '5.9.3' },
    devDependencies: {
      vitest: '5.0.3',
      '@vitest/coverage-v8': '5.0.3',
      'typescript-eslint': '8.71.1',
    },
  };
  const head = structuredClone(base);
  head.devDependencies['typescript-eslint'] = '8.71.2';
  const lock = (pkg) => ({
    name: 'example',
    lockfileVersion: 3,
    packages: {
      '': structuredClone(pkg),
      'node_modules/typescript': { version: '5.9.3' },
      'node_modules/typescript-eslint': {
        dev: true,
        version: pkg.devDependencies['typescript-eslint'],
        resolved: 'https://registry.npmjs.org/typescript-eslint/example.tgz',
      },
    },
  });
  return [
    base,
    head,
    lock(base),
    lock(head),
    ['package.json', 'package-lock.json'],
  ];
};
test('accepts only allowlisted development patches with production identity intact', () =>
  assert.equal(policy.approvedPatch(...make()), true));
for (const [name, mutate] of [
  [
    'production changes',
    (args) => {
      args[1].dependencies.typescript = '7.0.2';
    },
  ],
  [
    'script injection',
    (args) => {
      args[1].scripts.test = 'curl attacker';
    },
  ],
  ['extra files', (args) => args[4].push('.github/workflows/ci.yml')],
  [
    'major update',
    (args) => {
      args[1].devDependencies['typescript-eslint'] = '9.0.0';
    },
  ],
  [
    'minor update',
    (args) => {
      args[1].devDependencies['typescript-eslint'] = '8.72.0';
    },
  ],
  [
    'production transitive changes',
    (args) => {
      args[3].packages['node_modules/typescript'].version = '7.0.2';
    },
  ],
  [
    'untrusted tarball',
    (args) => {
      args[3].packages['node_modules/typescript-eslint'].resolved =
        'https://attacker.invalid/file.tgz';
    },
  ],
  [
    'unpaired Vitest',
    (args) => {
      args[1].devDependencies.vitest = '5.0.4';
    },
  ],
  [
    'removed dependency',
    (args) => {
      delete args[1].devDependencies['typescript-eslint'];
    },
  ],
  [
    'new dependency',
    (args) => {
      args[1].devDependencies.unreviewed = '1.0.1';
    },
  ],
  [
    'lock root mismatch',
    (args) => {
      args[3].packages[''].devDependencies.vitest = '5.0.4';
    },
  ],
  [
    'prerelease',
    (args) => {
      args[1].devDependencies['typescript-eslint'] = '8.71.2-beta';
    },
  ],
])
  test(`rejects ${name}`, () => {
    const args = make();
    mutate(args);
    assert.equal(policy.approvedPatch(...args), false);
  });
