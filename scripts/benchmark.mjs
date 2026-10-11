import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { scanProject } from '../dist/index.js';
const root = await mkdtemp(path.join(os.tmpdir(), 'ipc-sentinel-benchmark-'));
const count = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(count) || count < 1 || count > 10000)
  throw new Error('File count must be 1..10000');
for (let i = 0; i < count; i++)
  await writeFile(
    path.join(root, `module-${i}.ts`),
    `import {ipcMain,ipcRenderer} from 'electron'; ipcMain.handle('channel-${i}',()=>${i}); ipcRenderer.invoke('channel-${i}');`,
  );
const start = performance.now();
const report = await scanProject({ root });
const elapsed = performance.now() - start;
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      files: report.files.length,
      endpoints: report.endpoints.length,
      diagnostics: report.diagnostics.length,
      complete: report.complete,
      elapsedMs: Math.round(elapsed),
      rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    null,
    2,
  ),
);
