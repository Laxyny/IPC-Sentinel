import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
const cli = path.resolve('dist/cli.js');
const run = (...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
beforeAll(() => {
  execFileSync(process.execPath, [
    'node_modules/typescript/bin/tsc',
    '-p',
    'tsconfig.build.json',
  ]);
});
describe('built CLI', () => {
  it('documents commands and returns its real version', () => {
    expect(run('--help').stdout).toContain('--fail-on');
    expect(run('--version').stdout.trim()).toBe('0.1.0');
    expect(run('rules').stdout).toContain('IPC009');
    expect(run('explain', 'IPC001').status).toBe(0);
  });
  it('keeps JSON parseable, detects findings and honors thresholds', () => {
    const result = run('scan', 'tests/fixtures/unsafe', '--format', 'json');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).diagnostics.length).toBeGreaterThan(0);
    expect(result.stderr).toBe('');
    expect(
      run('scan', 'tests/fixtures/unsafe', '--fail-on', 'critical').status,
    ).toBe(0);
  });
  it('accepts safe fixtures and produces SARIF', () => {
    const result = run('scan', 'tests/fixtures/secure', '--format', 'sarif');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).version).toBe('2.1.0');
  });
  it('reports unknown commands, invalid config and option values as errors', () => {
    for (const args of [
      ['wat'],
      ['explain', 'IPC999'],
      ['scan', '--format', 'bad'],
      ['scan', '--fail-on', 'wat'],
      ['scan', '--config', 'not-found.json'],
      ['--fix'],
    ])
      expect(run(...args).status).toBe(2);
  });
  it('creates config only on init and refuses overwrite', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ipc-sentinel-init-'));
    expect(run('init', root).status).toBe(0);
    const before = await readFile(
      path.join(root, 'ipc-sentinel.config.json'),
      'utf8',
    );
    expect(run('init', root).status).toBe(2);
    expect(
      await readFile(path.join(root, 'ipc-sentinel.config.json'), 'utf8'),
    ).toBe(before);
  });
  it('returns incomplete status for an empty project even in quiet mode', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ipc-sentinel-empty-'));
    expect(run('scan', root, '--quiet').status).toBe(2);
  });
});
