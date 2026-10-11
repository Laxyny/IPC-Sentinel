import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv } from 'ajv';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import { describe, it, expect } from 'vitest';
import {
  formatSarif,
  formatText,
  scanProject,
  validateConfig,
} from '../src/index.js';
import type { ScanReport } from '../src/index.js';
import { sanitize } from '../src/formatters.js';
describe('report and configuration formats', () => {
  it('validates a complete and suppressed SARIF report against the external schema', async () => {
    const report = await scanProject({
      root: path.resolve('tests/fixtures/unsafe'),
      config: {
        suppressions: [
          { ruleId: 'IPC001', file: 'preload.js', reason: 'reviewed' },
        ],
      },
    });
    const schema = JSON.parse(
      readFileSync('tests/schemas/sarif-2.1.0.json', 'utf8'),
    );
    const validator = new Ajv({ strict: false });
    for (const [name, format] of Object.entries(fullFormats))
      validator.addFormat(name, format);
    const validate = validator.compile(schema);
    const output = formatSarif(report);
    expect(validate(output), JSON.stringify(validate.errors)).toBe(true);
    report.complete = false;
    expect(validate(formatSarif(report)), JSON.stringify(validate.errors)).toBe(
      true,
    );
  });
  it('keeps the editor schema aligned with runtime validation', () => {
    const schema = JSON.parse(readFileSync('ipc-sentinel.schema.json', 'utf8'));
    const validate = new Ajv().compile(schema);
    const cases = [
      {},
      { rules: { IPC001: 'off' }, electronVersion: 30 },
      { include: ['src\\*.ts'] },
      { unknown: true },
      { rules: { IPC999: 'off' } },
      { rules: { IPC001: 'error' } },
      { maxFiles: 0 },
      { suppressions: [{ ruleId: 'IPC001', file: '' }] },
    ];
    for (const value of cases) {
      let accepted = true;
      try {
        validateConfig(value);
      } catch {
        accepted = false;
      }
      expect(validate(value)).toBe(accepted);
    }
  });
  it('sanitizes terminal controls and preserves quiet findings', () => {
    expect(sanitize('file\x1b[31m\u202e')).toBe('file?[31m?');
    const report: ScanReport = {
      schemaVersion: 1,
      toolVersion: '0.1.0',
      root: '.',
      files: [],
      endpoints: [],
      diagnostics: [],
      suppressed: [],
      observations: [],
      complete: true,
    };
    expect(formatText(report, true)).toBe('');
    expect(formatText(report)).toContain('0 findings');
  });
});
