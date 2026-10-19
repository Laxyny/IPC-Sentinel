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
const context = () => ({
  pr: {
    state: 'open',
    draft: false,
    user: { login: 'dependabot[bot]' },
    base: { ref: 'main' },
    head: { sha: 'head', repo: { full_name: 'owner/repo' } },
    labels: [{ name: 'maintenance-approved' }],
  },
  sha: 'head',
  defaultBranch: 'main',
  repository: 'owner/repo',
  reviews: [
    {
      user: { login: 'maintainer' },
      state: 'APPROVED',
      commit_id: 'head',
      author_association: 'OWNER',
    },
  ],
  checks: [
    'real-world',
    ...['ubuntu-latest', 'windows-latest', 'macos-latest'].flatMap((os) =>
      ['22', '24'].map((node) => `validate (${os}, ${node})`),
    ),
  ].map((name, id) => ({
    id,
    name,
    app: { slug: 'github-actions' },
    status: 'completed',
    conclusion: 'success',
  })),
});
test('requires current-head human approval and all seven trusted checks', () =>
  assert.equal(policy.approvedContext(context()), true));
for (const [name, mutate] of [
  [
    'fork',
    (value) => {
      value.pr.head.repo.full_name = 'fork/repo';
    },
  ],
  [
    'non-Dependabot author',
    (value) => {
      value.pr.user.login = 'attacker';
    },
  ],
  [
    'stale head',
    (value) => {
      value.sha = 'old';
    },
  ],
  [
    'missing label',
    (value) => {
      value.pr.labels = [];
    },
  ],
  [
    'stale approval',
    (value) => {
      value.reviews[0].commit_id = 'old';
    },
  ],
  [
    'untrusted approval',
    (value) => {
      value.reviews[0].author_association = 'NONE';
    },
  ],
  [
    'dismissed review',
    (value) => {
      value.reviews[0].state = 'DISMISSED';
    },
  ],
  [
    'changes requested',
    (value) => {
      value.reviews.push({ ...value.reviews[0], state: 'CHANGES_REQUESTED' });
    },
  ],
  [
    'failed check',
    (value) => {
      value.checks[0].conclusion = 'failure';
    },
  ],
  [
    'missing check',
    (value) => {
      value.checks.pop();
    },
  ],
  [
    'spoofed check app',
    (value) => {
      value.checks[0].app.slug = 'other';
    },
  ],
  [
    'new pending check',
    (value) => {
      value.checks.push({
        ...value.checks[0],
        id: 100,
        status: 'in_progress',
        conclusion: null,
      });
    },
  ],
])
  test(`rejects maintenance context with ${name}`, () => {
    const value = context();
    mutate(value);
    assert.equal(policy.approvedContext(value), false);
  });
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
