import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(
  pkg.name,
  'ipc-sentinel',
  'Review name changes before publication',
);
assert.equal(
  pkg.version,
  process.env.APPROVED_VERSION,
  'Version must match exact approval',
);
assert.match(process.env.APPROVED_COMMIT ?? '', /^[a-f0-9]{40}$/);
assert.equal(
  process.env.APPROVED_COMMIT,
  process.env.WORKFLOW_COMMIT,
  'Approval must identify the workflow revision',
);
assert.equal(
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  process.env.APPROVED_COMMIT,
);
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  '',
  'Release checkout must be clean',
);
console.log(`Approved metadata verified: ${pkg.name}@${pkg.version}`);
