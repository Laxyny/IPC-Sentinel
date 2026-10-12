import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const workspace = fileURLToPath(new URL('..', import.meta.url));
if (!process.argv[2])
  throw new Error('Pass a built baseline dist/index.js path');
const implementations = {
  baseline: path.resolve(process.argv[2]),
  candidate: path.join(workspace, 'dist/index.js'),
};
const projects = JSON.parse(
  await readFile(path.join(workspace, 'validation/projects.json'), 'utf8'),
);
const cache = path.join(os.tmpdir(), 'ipc-sentinel-public-validation');
const results = [];
for (const project of projects) {
  const root = path.join(cache, `${project.name}-${project.commit}`);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (
    revision !== project.commit ||
    execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  )
    throw new Error('Expected a clean pinned checkout');
  const runs = { baseline: [], candidate: [] };
  for (let round = 0; round < 3; round++) {
    for (const name of round % 2
      ? ['candidate', 'baseline']
      : ['baseline', 'candidate']) {
      runs[name].push(
        JSON.parse(
          execFileSync(
            process.execPath,
            [
              path.join(workspace, 'scripts/scan-worker.mjs'),
              implementations[name],
              root,
              path.join(cache, `${project.name}-${name}-private-report.json`),
            ],
            { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 },
          ),
        ),
      );
    }
    console.error(`Measured ${project.name}: paired round ${round + 1}/3`);
  }
  results.push({ name: project.name, commit: project.commit, runs });
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      baseline:
        'e08995f analyzer (built checkout with test-only dependency upgrade)',
      projects: results,
    },
    null,
    2,
  ),
);
