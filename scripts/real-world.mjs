import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const projects = JSON.parse(
  await readFile(path.join(workspace, 'validation/projects.json'), 'utf8'),
);
const cache = path.join(os.tmpdir(), 'ipc-sentinel-public-validation');
const fetchSources = process.argv.includes('--fetch');
const check = process.argv.includes('--check');
const selection = process.argv.indexOf('--project');
const selectedName = selection >= 0 ? process.argv[selection + 1] : undefined;
if (
  selection >= 0 &&
  !projects.some((project) => project.name === selectedName)
)
  throw new Error('Unknown pinned project');
const implementation =
  process.env.IPC_SENTINEL_IMPLEMENTATION ??
  path.join(workspace, 'dist/index.js');
const results = [];
await mkdir(cache, { recursive: true });
for (const project of projects) {
  if (selectedName && project.name !== selectedName) continue;
  if (
    !/^[a-z0-9-]+$/.test(project.name) ||
    !/^[a-f0-9]{40}$/.test(project.commit) ||
    !/^https:\/\/github\.com\/[\w-]+\/[\w.-]+\.git$/.test(project.repository)
  )
    throw new Error('Invalid pinned project manifest');
  const root = path.join(cache, `${project.name}-${project.commit}`);
  const git = (args) =>
    execFileSync('git', ['-c', 'core.hooksPath=', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  try {
    await access(path.join(root, '.git'));
  } catch {
    if (!fetchSources)
      throw new Error(
        `Missing ${project.name}; run with --fetch to download pinned public sources`,
      );
    await mkdir(root, { recursive: true });
    git(['init']);
    git([
      '-c',
      'protocol.file.allow=never',
      'fetch',
      '--depth=1',
      project.repository,
      project.commit,
    ]);
    git(['checkout', '--detach', 'FETCH_HEAD']);
  }
  if (
    git(['rev-parse', 'HEAD']).trim() !== project.commit ||
    git(['status', '--porcelain']).trim()
  )
    throw new Error(`Pinned source revision is not clean: ${project.name}`);
  const output = path.join(cache, `${project.name}-private-report.json`);
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(workspace, 'scripts/scan-worker.mjs'),
        implementation,
        root,
        output,
      ],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 },
    ),
  );
  const pkg = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8'),
  );
  results.push({
    ...project,
    electron:
      pkg.devDependencies?.electron ?? pkg.dependencies?.electron ?? null,
    ...result,
  });
  if (check) {
    const expected = JSON.parse(
      await readFile(path.join(workspace, 'validation/expected.json'), 'utf8'),
    )[project.name];
    for (const key of [
      'files',
      'endpoints',
      'findings',
      'inconclusive',
      'complete',
    ])
      if (JSON.stringify(result[key]) !== JSON.stringify(expected[key]))
        throw new Error(`Real-world regression for ${project.name}: ${key}`);
  }
  console.error(
    `Analyzed ${project.name}: ${result.files} files, ${result.endpoints} endpoints`,
  );
}
const output = {
  node: process.version,
  platform: process.platform,
  implementation,
  projects: results,
};
await writeFile(
  path.join(cache, 'latest-summary.json'),
  JSON.stringify(output, null, 2) + '\n',
);
console.log(JSON.stringify(output, null, 2));
