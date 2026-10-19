import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
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
  it('tracks IPC input into shell and application configuration operations without name-based lookalikes', async () => {
    const root = await project({
      'main.ts':
        "import {ipcMain,app,shell} from 'electron';ipcMain.handle('path',(_e,p)=>app.setPath('userData',p));ipcMain.handle('open',(_e,p)=>shell.openPath(p));const local={setPath(){}};ipcMain.handle('local',(_e,p)=>local.setPath(p));",
    });
    const findings = (await scanProject({ root })).diagnostics.filter(
      (d) => d.ruleId === 'IPC002',
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((d) => d.evidence?.ipcInput === 'observed')).toBe(
      true,
    );
  });
  it('retains the bounded-analysis limitation on a privileged recursive handler', async () => {
    const root = await project({
      'main.ts':
        "import {ipcMain} from 'electron';import {execSync} from 'node:child_process';function recurse(){recurse()};ipcMain.handle('run',(_e,p)=>{execSync(p);recurse()});",
    });
    const finding = (await scanProject({ root })).diagnostics.find(
      (d) => d.ruleId === 'IPC002',
    );
    expect(finding?.evidence?.analysisLimited).toBe(true);
  });
  it('does not reuse semantic results after sources change between scans', async () => {
    const root = await project({
      'main.ts':
        "import {ipcMain} from 'electron';ipcMain.handle('read',()=>1);",
      'preload.ts':
        "import {ipcRenderer} from 'electron';ipcRenderer.invoke('read');",
    });
    expect((await scanProject({ root })).diagnostics).toEqual([]);
    await writeFile(
      path.join(root, 'preload.ts'),
      "import {ipcRenderer} from 'electron';ipcRenderer.invoke('write');",
    );
    expect(
      (await scanProject({ root })).diagnostics.map((d) => d.ruleId),
    ).toEqual(['IPC003']);
  });
  it('rejects inherited configuration through a directory link outside the root', async () => {
    const outside = await project({
      'base.json': '{"compilerOptions":{"baseUrl":"."}}',
    });
    const root = await project({
      'tsconfig.json': '{"extends":"./linked/base"}',
      'app.ts': 'const value=1;',
    });
    await symlink(outside, path.join(root, 'linked'), 'junction');
    const report = await scanProject({ root });
    expect(report.complete).toBe(false);
    expect(report.diagnostics.some((d) => d.ruleId === 'IPC008')).toBe(true);
  });
  it('keeps nested ambiguous Electron package graphs unassigned instead of cross-matching', async () => {
    const root = await project({
      'app/package.json': '{"devDependencies":{"electron":"42"}}',
      'app/nested/package.json': '{"devDependencies":{"electron":"42"}}',
      'app/preload.ts':
        "import {ipcRenderer} from 'electron';ipcRenderer.invoke('read');",
      'app/nested/main.ts':
        "import {ipcMain} from 'electron';ipcMain.handle('read',()=>1);",
    });
    const report = await scanProject({ root });
    expect(report.complete).toBe(false);
    expect(report.diagnostics.map((d) => d.ruleId).sort()).toEqual([
      'IPC003',
      'IPC008',
    ]);
  });
  it('follows event aliases but accepts extracted primitive event metadata', async () => {
    const root = await project({
      'preload.ts':
        "import {contextBridge,ipcRenderer} from 'electron';contextBridge.exposeInMainWorld('api',{bad:cb=>ipcRenderer.on('x',(event,value)=>{const leaked=event;cb({...leaked,value})}),good:cb=>ipcRenderer.on('y',(event,value)=>cb({url:event.senderFrame.url,value}))});",
    });
    const findings = (await scanProject({ root })).diagnostics.filter(
      (d) => d.ruleId === 'IPC001',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('event object');
  });
  it('merges relative inheritance arrays and anchors child paths without baseUrl at the child config', async () => {
    const root = await project({
      'config/base.json': '{"compilerOptions":{"paths":{"unused":["old"]}}}',
      'config/empty.json': '{}',
      'app/tsconfig.json':
        '{"extends":["../config/base","../config/empty"],"compilerOptions":{"paths":{"@channel":["./channel"]}}}',
      'app/channel.ts': "export const C='read';",
      'app/preload.ts':
        "import {ipcRenderer} from 'electron';import {C} from '@channel';ipcRenderer.invoke(C);",
      'app/main.ts':
        "import {ipcMain} from 'electron';ipcMain.handle('read',()=>1);",
    });
    expect((await scanProject({ root })).diagnostics).toEqual([]);
  });
  it('reviews raw Node bridge capabilities and renderer-controlled privileged helper arguments', async () => {
    const root = await project({
      'preload.ts':
        "import {contextBridge} from 'electron';import {readFileSync} from 'node:fs';function read(value){return readFileSync(value)};contextBridge.exposeInMainWorld('api',{raw:readFileSync,read:(path)=>read(path),fixed:()=>readFileSync('version')});",
    });
    const findings = (await scanProject({ root })).diagnostics.filter(
      (d) => d.ruleId === 'IPC001',
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((d) => d.kind === 'potential')).toBe(true);
  });
  it('reviews unconditional window opening only on proven BrowserWindow receivers', async () => {
    const root = await project({
      'main.ts':
        "import {BrowserWindow} from 'electron';const win=new BrowserWindow();win.webContents.setWindowOpenHandler(()=>({action:'allow'}));win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.setWindowOpenHandler(({url})=>{if(url==='https://app')return {action:'allow'};return {action:'deny'}});const unrelated={webContents:{setWindowOpenHandler(){}}};unrelated.webContents.setWindowOpenHandler(()=>({action:'allow'}));win.loadFile('index.html');",
    });
    const findings = (await scanProject({ root })).diagnostics;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'IPC009',
      kind: 'potential',
      confidence: 'medium',
    });
  });
  it('reports observed guards and IPC input dependencies without claiming a validated handler', async () => {
    const root = await project({
      'main.ts':
        "import {ipcMain} from 'electron';import {writeFileSync} from 'node:fs';ipcMain.handle('write',(event,payload)=>{if(event.senderFrame.url!=='https://app')throw Error();if(typeof payload!=='string')return;const value=payload;writeFileSync('file',value);});",
    });
    const finding = (await scanProject({ root })).diagnostics.find(
      (d) => d.ruleId === 'IPC002',
    );
    expect(finding).toMatchObject({
      kind: 'potential',
      confidence: 'low',
      evidence: {
        validation: 'observed-guard',
        ipcInput: 'observed',
        analysisLimited: false,
      },
    });
    expect(finding?.evidence?.validationLocations).toHaveLength(2);
  });
  it('distinguishes helper guards, opaque validators, missing evidence and static sink inputs', async () => {
    const root = await project({
      'main.ts':
        "import {ipcMain} from 'electron';import {writeFileSync} from 'fs';import {validate} from 'unknown';function save(value){if(typeof value!=='string')throw Error();writeFileSync('x',value)};ipcMain.handle('a',(_e,value)=>save(value));ipcMain.handle('b',(_e,value)=>{validate(value);writeFileSync('x',value)});ipcMain.handle('c',()=>writeFileSync('x','constant'));",
    });
    const findings = (await scanProject({ root })).diagnostics.filter(
      (d) => d.ruleId === 'IPC002',
    );
    expect(findings.map((d) => d.evidence?.validation)).toEqual([
      'delegated-guard',
      'unverified',
      'not-observed',
    ]);
    expect(findings.map((d) => d.evidence?.ipcInput)).toEqual([
      'observed',
      'observed',
      'not-observed',
    ]);
  });
  it('never suppresses review based on a misleading validator name or guard after the sink', async () => {
    const root = await project({
      'main.ts':
        "import {ipcMain} from 'electron';import {execSync} from 'child_process';function validate(value){return true};ipcMain.handle('run',(_e,value)=>{execSync(value);if(!validate(value))return;});",
    });
    const finding = (await scanProject({ root })).diagnostics.find(
      (d) => d.ruleId === 'IPC002',
    );
    expect(finding?.kind).toBe('potential');
    expect(finding?.evidence?.ipcInput).toBe('observed');
  });
  it('resolves pure closure factories, object wrappers and constant forwarding preludes', async () => {
    const root = await project({
      'ipc.ts':
        "import {ipcRenderer,ipcMain} from 'electron'; export const invoke=(channel)=>(payload)=>ipcRenderer.invoke(channel,payload); export function register(channel,fn){const key=channel;ipcMain.handle(key,fn)};export const requests={read:invoke('read')};",
      'main.ts': "import {register} from './ipc'; register('read',()=>1);",
      'preload.ts':
        "import {invoke,requests} from './ipc';const read=invoke('read');read(1);requests.read(2);",
    });
    const report = await scanProject({ root });
    expect(report.diagnostics).toEqual([]);
    expect(report.endpoints.filter((e) => e.channel === 'read')).toHaveLength(
      3,
    );
  });
  it('keeps guarded factories and side-effecting wrapper preludes unresolved', async () => {
    const root = await project({
      'app.ts':
        "import {ipcRenderer} from 'electron';const factory=(channel)=>{log();return value=>ipcRenderer.invoke(channel,value)};const read=factory('read');read(1);function wrapped(channel){const key=select(channel);return ipcRenderer.invoke(key)};wrapped('read');",
    });
    const report = await scanProject({ root });
    expect(
      report.diagnostics.filter((d) => d.ruleId === 'IPC007'),
    ).toHaveLength(2);
  });
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
