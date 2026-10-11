#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scanProject, version, rules, getRule, severities } from './index.js';
import { formatSarif, formatText, sanitize } from './formatters.js';
import type { Config, Severity } from './types.js';
const help = `IPC Sentinel ${version}
Usage: ipc-sentinel scan [directory] [options]
       ipc-sentinel rules | explain <rule> | init [directory]
Options:
  --format text|json|sarif  Output format (default text)
  --config <file>          JSON configuration path
  --include <glob>         Include glob (repeatable)
  --exclude <glob>         Additional exclusion (repeatable)
  --fail-on <severity>     Minimum failing severity (default high)
  --quiet                 Omit text summary
  --verbose               Print discovery observations to stderr
  --help                  Show help
  --version               Show version
Exit codes: 0 below threshold, 1 findings at threshold, 2 error or incomplete scan.
No source is executed or uploaded. See docs/rules.md for analysis limitations.`;
async function main(): Promise<void> {
  const args = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
      format: { type: 'string' },
      config: { type: 'string' },
      include: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      'fail-on': { type: 'string' },
      quiet: { type: 'boolean' },
      verbose: { type: 'boolean' },
    },
  });
  if (args.values.help) {
    console.log(help);
    return;
  }
  if (args.values.version) {
    console.log(version);
    return;
  }
  const [command = 'scan', target, ...rest] = args.positionals;
  if (rest.length) throw new Error('Too many positional arguments');
  if (command === 'rules') {
    if (target) throw new Error('rules accepts no arguments');
    console.log(
      rules
        .map((r) => `${r.id} ${r.severity.toUpperCase()} ${r.title}`)
        .join('\n'),
    );
    return;
  }
  if (command === 'explain') {
    if (!target) throw new Error('explain requires a rule ID');
    const rule = getRule(target);
    console.log(
      `${rule.id}: ${rule.title}\n${rule.explanation}\nRemediation: ${rule.remediation}\n${rule.documentationUrl}`,
    );
    return;
  }
  if (command === 'init') {
    const file = path.resolve(target ?? '.', 'ipc-sentinel.config.json');
    await writeFile(
      file,
      JSON.stringify(
        { include: ['**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'], rules: {} },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
    console.log(`Created ${sanitize(file)}`);
    return;
  }
  if (command !== 'scan') throw new Error(`Unknown command: ${command}`);
  const format = args.values.format ?? 'text';
  if (!['text', 'json', 'sarif'].includes(format))
    throw new Error('format must be text, json, or sarif');
  const threshold = args.values['fail-on'] ?? 'high';
  if (!severities.includes(threshold as Severity))
    throw new Error('Invalid fail-on severity');
  const config: Config = {};
  if (args.values.include) config.include = args.values.include;
  if (args.values.exclude) config.exclude = args.values.exclude;
  const report = await scanProject({
    root: target ?? process.cwd(),
    config,
    ...(args.values.config ? { configFile: args.values.config } : {}),
  });
  if (args.values.verbose)
    for (const observation of report.observations)
      console.error(sanitize(observation));
  console.log(
    format === 'json'
      ? JSON.stringify(report, null, 2)
      : format === 'sarif'
        ? JSON.stringify(formatSarif(report), null, 2)
        : formatText(report, args.values.quiet),
  );
  process.exitCode = !report.complete
    ? 2
    : report.diagnostics.some(
          (d) =>
            severities.indexOf(d.severity) <=
            severities.indexOf(threshold as Severity),
        )
      ? 1
      : 0;
}
main().catch((error: unknown) => {
  console.error(
    `IPC Sentinel: ${sanitize(error instanceof Error ? error.message : 'Unexpected error')}`,
  );
  process.exitCode = 2;
});
