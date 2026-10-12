import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { scanProject, validateConfig } from '../src/index.js';

async function project(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ipc-sentinel-hardening-'));
  for (const [file, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), source);
  }
  return root;
}

describe('production channel and wrapper regressions', () => {
  it('distinguishes fixed bound operations from raw capabilities', async () => {
    const root = await project({
      'app.ts':
        "import {contextBridge,ipcRenderer} from 'electron'; contextBridge.exposeInMainWorld('api',{fixed:ipcRenderer.invoke.bind(ipcRenderer,'read'),raw:ipcRenderer.invoke.bind(ipcRenderer),empty:ipcRenderer.send.bind()});",
    });
    const report = await scanProject({ root });
    expect(
      report.diagnostics.filter((d) => d.ruleId === 'IPC001'),
    ).toHaveLength(2);
  });
  it('detects addListener event forwarding through rest and object arguments', async () => {
    const root = await project({
      'app.ts':
        "import {contextBridge,ipcRenderer} from 'electron'; contextBridge.exposeInMainWorld('api',{unsafe:cb=>ipcRenderer.addListener('x',(...args)=>cb(...args)),nested:cb=>ipcRenderer.once('x',(event,value)=>cb({event,value})),safe:cb=>ipcRenderer.on('x',(_event,...args)=>cb(...args))});",
    });
    const report = await scanProject({ root });
    expect(
      report.diagnostics.filter((d) => d.ruleId === 'IPC001'),
    ).toHaveLength(2);
  });
  it('resolves imported and re-exported string enum channels', async () => {
    const root = await project({
      'channels.ts':
        "export enum Channels { Read = 'read', Alias = Read, Computed = 'prefix:' + Read }",
      'barrel.ts': "export { Channels as Keys } from './channels.js'",
      'main.ts':
        "import {ipcMain} from 'electron'; import {Keys} from './barrel.js'; ipcMain.handle(Keys.Read, () => 1); ipcMain.handle(Keys.Computed, () => 1);",
      'preload.ts':
        "import {ipcRenderer} from 'electron'; import {Keys} from './barrel.js'; ipcRenderer.invoke(Keys.Alias); ipcRenderer.invoke(Keys['Computed']);",
    });
    const report = await scanProject({ root });
    expect(report.endpoints.map((e) => e.channel)).toEqual([
      'read',
      'prefix:read',
      'read',
      'prefix:read',
    ]);
    expect(report.diagnostics).toEqual([]);
  });
  it('instantiates imported/re-exported and nested wrappers at caller sites', async () => {
    const root = await project({
      'lib.ts':
        "import {ipcMain,ipcRenderer} from 'electron'; export const register = (channel, handler) => ipcMain.handle(channel, handler); export async function invoke(channel, ...args) { return await ipcRenderer.invoke(channel, ...args); }",
      'barrel.ts': "export {register as handle, invoke} from './lib.js'",
      'main.ts':
        "import {handle} from './barrel.js'; import {readFileSync} from 'node:fs'; const forward = (c,h) => handle(c,h); forward('read', (_e,p) => readFileSync(p));",
      'preload.ts':
        "import {invoke} from './barrel.js'; const request = invoke; request('read'); request('missing');",
    });
    const report = await scanProject({ root });
    expect(report.endpoints).toHaveLength(3);
    expect(report.endpoints.map((e) => e.channel)).toEqual([
      'read',
      'read',
      'missing',
    ]);
    expect(report.diagnostics.filter((d) => d.ruleId === 'IPC007')).toEqual([]);
    expect(
      report.diagnostics.filter((d) => d.ruleId === 'IPC003'),
    ).toHaveLength(1);
    expect(
      report.diagnostics.find((d) => d.ruleId === 'IPC002')?.location.file,
    ).toBe('main.ts');
    expect(report.diagnostics.find((d) => d.ruleId === 'IPC002')?.kind).toBe(
      'potential',
    );
  });
  it('preserves dynamic callers and rejects guarded wrappers and local lookalikes', async () => {
    const root = await project({
      'app.ts':
        "import {ipcMain,ipcRenderer} from 'electron'; const invoke = c => ipcRenderer.invoke(c); invoke('known'); invoke(variable); const guarded = c => { if(c==='allowed') return ipcRenderer.invoke(c); }; guarded('allowed'); const fake={invoke(c){return c;}}; fake.invoke('fake'); const register=(c,h)=>ipcMain.handle(c,h); register('known',()=>1);",
    });
    const report = await scanProject({ root });
    expect(report.endpoints.filter((e) => e.channel === 'known')).toHaveLength(
      2,
    );
    expect(
      report.endpoints.some(
        (e) => e.channel === 'fake' || e.channel === 'allowed',
      ),
    ).toBe(false);
    expect(
      report.diagnostics.filter((d) => d.ruleId === 'IPC007'),
    ).toHaveLength(2);
  });
  it('keeps wrappers with rest or default channel parameters inconclusive', async () => {
    const root = await project({
      'app.ts':
        "import {ipcRenderer} from 'electron'; const a=(...args)=>ipcRenderer.invoke(...args); const b=(channel='x')=>ipcRenderer.invoke(channel); a('x'); b('x');",
    });
    const report = await scanProject({ root });
    expect(report.endpoints.every((e) => e.channel === null)).toBe(true);
    expect(
      report.diagnostics.filter((d) => d.ruleId === 'IPC007'),
    ).toHaveLength(3);
  });
  it('does not treat validation names or nested uncalled callbacks as proof', async () => {
    const root = await project({
      'app.ts':
        "import {ipcMain} from 'electron'; import {readFileSync} from 'node:fs'; const validate=()=>true; ipcMain.handle('read',(e,p)=>{validate(e,p); return readFileSync(p);});",
    });
    const report = await scanProject({ root });
    expect(report.diagnostics.find((d) => d.ruleId === 'IPC002')).toMatchObject(
      { kind: 'potential', confidence: 'low' },
    );
  });
  it('excludes vendored Yarn bundles from discovery', async () => {
    const root = await project({
      '.yarn/releases/yarn.cjs': 'const = ;',
      'src/app.ts': 'export const x = 1;',
    });
    const report = await scanProject({ root });
    expect(report.files).toEqual(['src/app.ts']);
    expect(report.complete).toBe(true);
  });
  it('ignores unused nested privileged helpers but follows invoked helpers', async () => {
    const root = await project({
      'app.ts':
        "import {ipcMain} from 'electron'; import {readFileSync} from 'node:fs'; ipcMain.handle('safe',()=>{ const unused=()=>readFileSync('x'); return 1; }); ipcMain.handle('review',()=>{ const used=()=>readFileSync('x'); return used(); });",
    });
    const report = await scanProject({ root });
    expect(
      report.diagnostics.filter((d) => d.ruleId === 'IPC002'),
    ).toHaveLength(1);
  });
});

describe('explicit application isolation', () => {
  it('prevents a sibling application satisfying missing handlers or causing duplicates', async () => {
    const root = await project({
      'apps/a/main.ts':
        "import {ipcMain} from 'electron'; ipcMain.handle('shared',()=>1);",
      'apps/a/preload.ts':
        "import {ipcRenderer} from 'electron'; ipcRenderer.invoke('only-b');",
      'apps/b/main.ts':
        "import {ipcMain} from 'electron'; ipcMain.handle('shared',()=>2); ipcMain.handle('only-b',()=>2);",
    });
    const global = await scanProject({ root });
    expect(
      global.diagnostics.filter((d) => d.ruleId === 'IPC003'),
    ).toHaveLength(0);
    expect(
      global.diagnostics.filter((d) => d.ruleId === 'IPC004'),
    ).toHaveLength(1);
    const isolated = await scanProject({
      root,
      config: { applicationRoots: ['apps/a', 'apps/b'] },
    });
    expect(
      isolated.diagnostics.filter((d) => d.ruleId === 'IPC003'),
    ).toHaveLength(1);
    expect(
      isolated.diagnostics.filter((d) => d.ruleId === 'IPC004'),
    ).toHaveLength(0);
    expect(isolated.endpoints.map((e) => e.scope)).toEqual([
      'apps/a',
      'apps/a',
      'apps/b',
      'apps/b',
    ]);
  });
  it('keeps multiple preloads in the same application and unassigned files inconclusive', async () => {
    const root = await project({
      'app/main.ts':
        "import {ipcMain} from 'electron'; ipcMain.handle('read',()=>1);",
      'app/preload-one.ts':
        "import {ipcRenderer} from 'electron'; ipcRenderer.invoke('read');",
      'app/preload-two.ts':
        "import {ipcRenderer} from 'electron'; ipcRenderer.invoke('read');",
      'shared.ts':
        "import {ipcRenderer} from 'electron'; ipcRenderer.invoke('read');",
    });
    const report = await scanProject({
      root,
      config: { applicationRoots: ['app'] },
    });
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      ruleId: 'IPC003',
      kind: 'inconclusive',
      confidence: 'low',
    });
  });
  it('reports empty scopes and rejects overlapping, absolute and traversal paths', async () => {
    for (const roots of [
      [],
      ['app', 'app/sub'],
      ['app', 'APP'],
      ['../app'],
      ['C:\\app'],
      ['/app'],
      ['a/*'],
      ['a/./b'],
    ])
      expect(() => validateConfig({ applicationRoots: roots })).toThrow();
    const root = await project({ 'source.ts': 'const x=1;' });
    const report = await scanProject({
      root,
      config: { applicationRoots: ['missing'] },
    });
    expect(report.complete).toBe(false);
    expect(report.diagnostics[0]?.ruleId).toBe('IPC008');
  });
});
