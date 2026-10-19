import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { scanProject } from '../src/index.js';

async function project(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ipc-sentinel-v2-'));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return root;
}
describe('v0.2 project boundaries and settings', () => {
  it('loads relative inherited paths from their declaring config and local overrides', async () => {
    const root = await project({
      'config/base.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '..',
          paths: { '@shared/*': ['shared/*'] },
        },
      }),
      'app/tsconfig.json': JSON.stringify({ extends: '../config/base' }),
      'shared/channels.ts': "export const READ='read';",
      'app/main.ts':
        "import {ipcMain} from 'electron'; import {READ} from '@shared/channels'; ipcMain.handle(READ,()=>1);",
      'app/preload.ts':
        "import {ipcRenderer} from 'electron'; ipcRenderer.invoke('read');",
    });
    expect((await scanProject({ root })).diagnostics).toEqual([]);
  });
  it('stops at the nearest config even when it declares no aliases', async () => {
    const root = await project({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['shared/*'] } },
      }),
      'app/tsconfig.json': '{}',
      'shared/channel.ts': "export const C='read';",
      'app/preload.ts':
        "import {ipcRenderer} from 'electron';import {C} from '@/channel';ipcRenderer.invoke(C);",
    });
    expect(
      (await scanProject({ root })).diagnostics.some(
        (d) => d.ruleId === 'IPC007',
      ),
    ).toBe(true);
  });
  it.each(['./missing', './tsconfig', 'typescript-package', '../outside'])(
    'reports unsupported or broken inheritance %s',
    async (parent) => {
      const root = await project({
        'tsconfig.json': JSON.stringify({ extends: parent }),
        'app.ts': 'const value=1;',
      });
      const report = await scanProject({ root });
      expect(report.complete).toBe(false);
      expect(report.diagnostics.some((d) => d.ruleId === 'IPC008')).toBe(true);
    },
  );
  it('isolates independent Electron packages without splitting their windows or preloads', async () => {
    const root = await project({
      'apps/a/package.json': JSON.stringify({
        devDependencies: { electron: '42' },
      }),
      'apps/b/package.json': JSON.stringify({
        dependencies: { electron: '42' },
      }),
      'apps/a/main.ts':
        "import {ipcMain} from 'electron'; ipcMain.handle('shared',()=>1);",
      'apps/a/preload-one.ts':
        "import {ipcRenderer} from 'electron';ipcRenderer.invoke('shared');ipcRenderer.invoke('only-b');",
      'apps/a/preload-two.ts':
        "import {ipcRenderer} from 'electron';ipcRenderer.invoke('shared');",
      'apps/b/main.ts':
        "import {ipcMain} from 'electron';ipcMain.handle('shared',()=>2);ipcMain.handle('only-b',()=>1);",
    });
    const report = await scanProject({ root });
    expect(report.diagnostics.map((d) => d.ruleId)).toEqual(['IPC003']);
    expect(report.endpoints.every((e) => e.scope)).toBe(true);
  });
  it('allows explicit roots to override package heuristics', async () => {
    const root = await project({
      'apps/a/package.json': '{"devDependencies":{"electron":"42"}}',
      'apps/b/package.json': '{"devDependencies":{"electron":"42"}}',
      'apps/a/preload.ts':
        "import {ipcRenderer} from 'electron';ipcRenderer.invoke('read');",
      'apps/b/main.ts':
        "import {ipcMain} from 'electron';ipcMain.handle('read',()=>1);",
    });
    expect(
      (await scanProject({ root, config: { applicationRoots: ['apps'] } }))
        .diagnostics,
    ).toEqual([]);
  });
});
