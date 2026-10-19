import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, cp, access, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const npmCli = process.env.npm_execpath;
assert(npmCli, 'Run this script through npm run test:package');
const npm = (args, cwd = process.cwd()) =>
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const packed = JSON.parse(npm(['pack', '--json', '--ignore-scripts']))[0];
assert.equal(packed.name, 'ipc-sentinel');
assert.equal(packed.version, '0.2.0');
for (const file of packed.files)
  assert(
    /^(dist\/|docs\/|README\.md$|LICENSE$|CHANGELOG\.md$|SECURITY\.md$|package\.json$|ipc-sentinel\.schema\.json$)/.test(
      file.path,
    ),
    `Unexpected packed file: ${file.path}`,
  );
assert(packed.files.some((f) => f.path === 'dist/index.d.ts'));
assert(packed.files.some((f) => f.path === 'dist/cli.js'));
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(metadata.version, packed.version);
const temp = await mkdtemp(path.join(os.tmpdir(), 'ipc-sentinel-package-'));
await writeFile(
  path.join(temp, 'package.json'),
  JSON.stringify({ name: 'packed-consumer', private: true, type: 'module' }),
);
npm(
  [
    'install',
    path.resolve(packed.filename),
    '--ignore-scripts',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
  ],
  temp,
);
await cp('tests/fixtures/secure', path.join(temp, 'secure'), {
  recursive: true,
});
await cp('tests/fixtures/unsafe', path.join(temp, 'unsafe'), {
  recursive: true,
});
const bin = path.join(temp, 'node_modules', 'ipc-sentinel', 'dist', 'cli.js');
for (const [fixture, status] of [
  ['secure', 0],
  ['unsafe', 1],
])
  for (const format of ['json', 'sarif']) {
    const run = spawnSync(
      process.execPath,
      [bin, 'scan', path.join(temp, fixture), '--format', format],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, status, run.stderr);
    const report = JSON.parse(run.stdout);
    assert(
      format === 'json'
        ? report.schemaVersion === 1
        : report.version === '2.1.0',
    );
  }
execFileSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    "import {scanProject} from 'ipc-sentinel'; const r=await scanProject({root:'secure'}); if(r.diagnostics.length) process.exit(1);",
  ],
  { cwd: temp },
);
await writeFile(
  path.join(temp, 'consumer.ts'),
  `import {scanProject,version,type Diagnostic,type Config} from 'ipc-sentinel';
const config:Config={applicationRoots:['desktop']};
const report=await scanProject({root:'.',config});
const finding:Diagnostic|undefined=report.diagnostics[0];
const state:string|undefined=finding?.evidence?.validation;
void state;void version;
`,
);
execFileSync(
  process.execPath,
  [
    path.resolve('node_modules/typescript/bin/tsc'),
    '--noEmit',
    '--strict',
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    'consumer.ts',
  ],
  { cwd: temp },
);
execFileSync(
  process.execPath,
  [
    '-e',
    "const {scanProject}=require('ipc-sentinel'); if(typeof scanProject!=='function') process.exit(1);",
  ],
  { cwd: temp },
);
const shim = path.join(
  temp,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'ipc-sentinel.cmd' : 'ipc-sentinel',
);
await access(shim);
assert.equal(
  npm(['exec', '--offline', '--', 'ipc-sentinel', '--version'], temp).trim(),
  '0.2.0',
);
const dry = JSON.parse(
  npm([
    'publish',
    '--dry-run',
    // Validate publication contents even after this version is released.
    // Force skips npm's registry version lookup; dry-run prevents publishing.
    '--force',
    '--offline',
    '--json',
    '--ignore-scripts',
    '--access',
    'public',
  ]),
);
assert(dry['ipc-sentinel@0.2.0'] || dry.id === 'ipc-sentinel@0.2.0');
const dryPackage = dry['ipc-sentinel@0.2.0'] ?? dry;
assert.equal(dryPackage.integrity, packed.integrity);
assert.equal(dryPackage.files.length, packed.files.length);
console.log(
  `Packed exports, installed CLI shim, secure/unsafe fixtures, JSON, SARIF and publication dry-run passed (${packed.files.length} files, ${packed.size} packed bytes). Consumer: ${temp}`,
);
