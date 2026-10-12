import { mkdtemp, writeFile, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect } from 'vitest';
import { scanProject, validateConfig, formatSarif } from '../src/index.js';
import type { Config } from '../src/index.js';
const fixture = (name: string): string => path.resolve('tests/fixtures', name);
async function scan(source: string, config?: Config) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ipc-sentinel-test-'));
  await writeFile(path.join(root, 'app.ts'), source);
  return scanProject({ root, ...(config ? { config } : {}) });
}
describe('real project relationships', () => {
  it('accepts secure ESM, CJS, aliased imports, spread preferences and multiple preloads', async () => {
    const report = await scanProject({ root: fixture('secure') });
    expect(report.complete).toBe(true);
    expect(report.diagnostics).toEqual([]);
    expect(report.endpoints).toHaveLength(7);
    expect(report.endpoints.every((e) => e.channel !== null)).toBe(true);
  });
  it('detects dangerous exposures, duplicate handles, method mismatch and preferences', async () => {
    const report = await scanProject({ root: fixture('unsafe') });
    expect(new Set(report.diagnostics.map((d) => d.ruleId))).toEqual(
      new Set([
        'IPC001',
        'IPC002',
        'IPC003',
        'IPC004',
        'IPC005',
        'IPC006',
        'IPC007',
        'IPC009',
      ]),
    );
    const mismatch = report.diagnostics.find(
      (d) => d.ruleId === 'IPC003' && d.relatedLocations.length,
    );
    expect(mismatch?.relatedLocations[0]?.file).toBe('main.ts');
    expect(
      report.diagnostics.filter((d) => d.ruleId === 'IPC005'),
    ).toHaveLength(6);
    expect(
      report.diagnostics.find((d) => d.ruleId === 'IPC002')?.confidence,
    ).toBe('low');
  });
});
describe('conservative AST analysis', () => {
  it('does not confuse local lookalikes or shadowed bindings with Electron', async () => {
    const report = await scan(
      `import {ipcRenderer} from 'electron'; function f(ipcRenderer: {invoke: Function}) { ipcRenderer.invoke('x'); } const ipcMain = {handle(){}}; ipcMain.handle('x'); const window = {loadURL(){}}; window.loadURL('http://x');`,
    );
    expect(report.diagnostics).toEqual([]);
    expect(report.endpoints).toEqual([]);
  });
  it('resolves namespace imports, local aliases, computed methods and const templates', async () => {
    const report = await scan(
      "import * as e from 'electron'; const ipc = e.ipcMain; const c = 'x'; ipc['handle'](`${c}:ok`, () => 1); e.ipcRenderer.invoke('x:ok');",
    );
    expect(report.diagnostics).toEqual([]);
    expect(report.endpoints).toHaveLength(2);
  });
  it('keeps mutable and circular channels inconclusive', async () => {
    const report = await scan(
      "import {ipcMain} from 'electron'; let c = 'x'; const a = b; const b = a; ipcMain.handle(c,()=>{}); ipcMain.handle(a,()=>{});",
    );
    expect(
      report.diagnostics.filter((d) => d.ruleId === 'IPC007'),
    ).toHaveLength(2);
  });
  it('does not treat renderer listeners as requests or multiple on registrations as duplicates', async () => {
    const report = await scan(
      "import {ipcMain, ipcRenderer} from 'electron'; ipcMain.on('x',()=>{}); ipcMain.on('x',()=>{}); ipcRenderer.on('notifications',()=>{}); ipcRenderer.send('x');",
    );
    expect(report.diagnostics).toEqual([]);
  });
  it('matches channels supplied to simple registration wrappers', async () => {
    const report = await scan(
      "import {ipcMain, ipcRenderer} from 'electron'; function register(c, fn){ipcMain.handle(c,fn)} register('x',()=>1); ipcRenderer.invoke('x');",
    );
    expect(report.diagnostics).toEqual([]);
    expect(report.endpoints.map((e) => e.channel)).toEqual(['x', 'x']);
  });
  it('does not flag omitted modern preferences as unsafe', async () => {
    const report = await scan(
      "import {BrowserWindow} from 'electron'; new BrowserWindow({});",
      { electronVersion: 30 },
    );
    expect(report.diagnostics).toEqual([]);
  });
  it('marks malformed files and dynamic options as incomplete', async () => {
    const report = await scan(
      "import {BrowserWindow} from 'electron'; new BrowserWindow(options); const = ;",
    );
    expect(report.complete).toBe(false);
    expect(report.diagnostics.every((d) => d.ruleId === 'IPC008')).toBe(true);
  });
  it('reviews privileged helpers even if a validation helper exists', async () => {
    const report = await scan(
      "import {ipcMain} from 'electron'; import {exec} from 'child_process'; function work(x){exec(x)} function validate(event){return true} ipcMain.handle('x', (event,x)=>{validate(event);work(x)});",
    );
    expect(
      report.diagnostics.some(
        (d) => d.ruleId === 'IPC002' && d.kind === 'potential',
      ),
    ).toBe(true);
  });
  it('detects leaked events while allowing a fixed channel and stripped callback', async () => {
    const report = await scan(
      "import {contextBridge,ipcRenderer} from 'electron'; contextBridge.exposeInMainWorld('app',{safe: cb=>ipcRenderer.on('x',(_event,value)=>cb(value)), unsafe: cb=>ipcRenderer.on('y',(event,value)=>cb(event,value))});",
    );
    expect(
      report.diagnostics.filter((d) => d.ruleId === 'IPC001'),
    ).toHaveLength(1);
  });
});
describe('configuration, suppression and discovery', () => {
  it('validates unknown keys, rules, severities and resource limits', () => {
    for (const config of [
      { wat: 1 },
      { rules: { IPC999: 'off' } },
      { rules: { IPC001: 'error' } },
      { maxFiles: 0 },
      { exclude: [null] },
      { suppressions: [{ ruleId: 'IPC001', file: 'x', bad: true }] },
    ])
      expect(() => validateConfig(config)).toThrow();
  });
  it('audits inline and configured suppressions and severity overrides', async () => {
    const report = await scan(
      "import {ipcRenderer} from 'electron';\n// ipc-sentinel-disable-next-line IPC003 -- registered externally\nipcRenderer.invoke('a');\nipcRenderer.invoke('b');",
      {
        suppressions: [
          { ruleId: 'IPC003', file: 'app.ts', reason: 'external' },
        ],
      },
    );
    expect(report.suppressed).toHaveLength(2);
    expect(report.diagnostics).toEqual([]);
    const inline = await scan(
      "import {ipcRenderer} from 'electron';\n// ipc-sentinel-disable-next-line IPC003 -- reviewed\nipcRenderer.invoke('a');\nipcRenderer.invoke('b');",
      { rules: { IPC003: 'high' } },
    );
    expect(inline.suppressed[0]?.source).toBe('inline');
    expect(inline.diagnostics[0]?.severity).toBe('high');
  });
  it('does not recognize directives in string literals', async () => {
    const report = await scan(
      "import {ipcRenderer} from 'electron';\nconst text = '// ipc-sentinel-disable-next-line IPC003';\nipcRenderer.invoke('a');",
    );
    expect(report.suppressed).toEqual([]);
  });
  it('does not recognize template text as suppression comments', async () => {
    const report = await scan(
      "import {ipcRenderer} from 'electron'; const text = `${1}\n// ipc-sentinel-disable-next-line IPC003\n${ipcRenderer.invoke('missing')}`;",
    );
    expect(report.suppressed).toEqual([]);
    expect(report.diagnostics.some((d) => d.ruleId === 'IPC003')).toBe(true);
  });
  it('bounds circular destructured initializers', async () => {
    const report = await scan(
      "import {ipcRenderer} from 'electron'; const {x} = x; ipcRenderer.invoke(x);",
    );
    expect(report.diagnostics.some((d) => d.ruleId === 'IPC007')).toBe(true);
  });
  it('marks opaque bridge factories incomplete and detects bound methods', async () => {
    const report = await scan(
      "import {contextBridge,ipcRenderer} from 'electron'; contextBridge.exposeInMainWorld('a', factory()); contextBridge.exposeInMainWorld('b',{send: ipcRenderer.send.bind(ipcRenderer)});",
    );
    expect(report.complete).toBe(false);
    expect(report.diagnostics.some((d) => d.ruleId === 'IPC001')).toBe(true);
  });
  it('supports Windows include patterns and total/file count bounds', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ipc-sentinel-limits-'));
    await mkdir(path.join(root, 'src'));
    for (const file of ['a.js', 'b.js'])
      await writeFile(path.join(root, 'src', file), 'const x=1;');
    const report = await scanProject({
      root,
      config: { include: ['src\\*.js'], maxFiles: 1 },
    });
    expect(report.files).toHaveLength(1);
    expect(report.complete).toBe(false);
    const total = await scanProject({ root, config: { maxTotalBytes: 1 } });
    expect(total.complete).toBe(false);
  });
  it('reads tsconfig JSON comments and rejects malformed JSON without leaking values', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ipc-sentinel-jsonc-'));
    await writeFile(path.join(root, 'app.ts'), 'const x=1;');
    await writeFile(
      path.join(root, 'tsconfig.json'),
      '{/* local settings */ "compilerOptions": {},}',
    );
    expect((await scanProject({ root })).complete).toBe(true);
    await writeFile(
      path.join(root, 'ipc-sentinel.config.json'),
      '{"secret":"sensitive-value" broken}',
    );
    await expect(scanProject({ root })).rejects.toThrow(
      'source values omitted',
    );
  });
  it('keeps incomplete state even when incompleteness diagnostics are disabled', async () => {
    const report = await scan('const = ;', { rules: { IPC008: 'off' } });
    expect(report.complete).toBe(false);
    expect(report.suppressed.length).toBeGreaterThan(0);
  });
  it('honors includes and exclusions and never executes source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ipc-sentinel-project-'));
    await mkdir(path.join(root, 'dist'));
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'dist', 'generated.js'), 'invalid syntax');
    await writeFile(
      path.join(root, 'src', 'app.js'),
      "throw new Error('source was executed');",
    );
    await writeFile(path.join(root, 'src', 'data.json'), '{"notSource":true}');
    const report = await scanProject({
      root,
      config: { include: ['src/**/*'] },
    });
    expect(report.files).toEqual(['src/app.js']);
    expect(report.complete).toBe(true);
  });
  it('reports oversized files and empty selection', async () => {
    const report = await scan('const x = 1;', { maxFileBytes: 2 });
    expect(report.complete).toBe(false);
    expect(report.files).toEqual([]);
  });
  it('skips symlinks, including files outside root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ipc-sentinel-link-'));
    const outside = await mkdtemp(
      path.join(os.tmpdir(), 'ipc-sentinel-outside-'),
    );
    await writeFile(path.join(root, 'safe.js'), 'const x=1');
    await writeFile(path.join(outside, 'unsafe.js'), 'const = ;');
    try {
      await symlink(
        outside,
        path.join(root, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    const report = await scanProject({ root });
    expect(report.files).toEqual(['safe.js']);
    expect(report.observations[0]).toContain('symbolic link');
  });
  it('produces deterministic JSON and structurally correct SARIF', async () => {
    const first = await scanProject({ root: fixture('unsafe') });
    const second = await scanProject({ root: fixture('unsafe') });
    expect(first).toEqual(second);
    const sarif = formatSarif(first) as {
      version: string;
      runs: { results: { ruleId: string; locations: unknown[] }[] }[];
    };
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0]?.results).toHaveLength(first.diagnostics.length);
    expect(
      sarif.runs[0]?.results.every((r) => r.ruleId && r.locations.length),
    ).toBe(true);
  });
});
