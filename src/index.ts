import path from 'node:path';
import ts from 'typescript';
import picomatch from 'picomatch';
import { loadConfig } from './config.js';
import { discover, slash } from './discovery.js';
import { createSemantic, visit } from './semantic.js';
import { analyze, diagnostic } from './analysis.js';
import { withinScope } from './paths.js';
import { workspaceRoots } from './project.js';
import type { ScanOptions, ScanReport } from './types.js';
export type * from './types.js';
export { rules, getRule, severities } from './rules.js';
export { formatText, formatSarif } from './formatters.js';
export { validateConfig } from './config.js';
export const version = '0.1.0';
export async function scanProject(
  options: ScanOptions = {},
): Promise<ScanReport> {
  const rootInput = path.resolve(options.root ?? process.cwd());
  const config = await loadConfig(
    rootInput,
    options.configFile,
    options.config,
  );
  const discovery = await discover(rootInput, config);
  if (!config.applicationRoots) {
    const roots = await workspaceRoots(discovery);
    if (roots) config.applicationRoots = roots;
  }
  const semantic = await createSemantic(discovery);
  const analyzed = analyze(semantic, discovery.root, config);
  for (const scope of config.applicationRoots ?? [])
    if (
      ![...discovery.sources.keys()].some((file) =>
        withinScope(slash(path.relative(discovery.root, file)), scope),
      )
    )
      discovery.issues.push({
        file: scope,
        message: 'Configured application root has no selected source files',
      });
  for (const issue of discovery.issues)
    analyzed.diagnostics.push(
      diagnostic(
        'IPC008',
        {
          file: slash(issue.file),
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 1,
        },
        issue.message,
        'inconclusive',
        'high',
      ),
    );
  if (!discovery.sources.size)
    analyzed.diagnostics.push(
      diagnostic(
        'IPC008',
        { file: '.', line: 1, column: 1, endLine: 1, endColumn: 1 },
        'No supported source files were discovered.',
        'inconclusive',
        'high',
      ),
    );
  const report: ScanReport = {
    schemaVersion: 1,
    toolVersion: version,
    root: discovery.root,
    files: [...discovery.sources.keys()].map((f) =>
      slash(path.relative(discovery.root, f)),
    ),
    endpoints: analyzed.endpoints,
    diagnostics: [],
    suppressed: [],
    observations: [...new Set(discovery.observations)],
    complete: !analyzed.diagnostics.some((d) => d.ruleId === 'IPC008'),
  };
  // Parse actual comment tokens so strings containing suppression-like text never suppress findings.
  const inline = new Map<
    string,
    { line: number; id: string; reason: string }[]
  >();
  for (const file of semantic.program.getSourceFiles()) {
    const directives: { line: number; id: string; reason: string }[] = [];
    const seenComments = new Set<number>();
    visit(file, (node) => {
      for (const range of ts.getLeadingCommentRanges(
        file.text,
        node.getFullStart(),
      ) ?? []) {
        if (
          range.kind !== ts.SyntaxKind.SingleLineCommentTrivia ||
          seenComments.has(range.pos)
        )
          continue;
        seenComments.add(range.pos);
        const match = file.text
          .slice(range.pos, range.end)
          .match(
            /^\/\/\s*ipc-sentinel-disable-next-line\s+(IPC\d{3})(?:\s+--\s*(.*))?\s*$/,
          );
        if (match)
          directives.push({
            line: file.getLineAndCharacterOfPosition(range.pos).line + 2,
            id: match[1]!,
            reason: match[2]?.trim() || 'No reason supplied',
          });
      }
    });
    inline.set(slash(path.relative(discovery.root, file.fileName)), directives);
  }
  const seen = new Set<string>();
  analyzed.diagnostics.sort(
    (a, b) =>
      compare(a.location.file, b.location.file) ||
      a.location.line - b.location.line ||
      a.location.column - b.location.column ||
      compare(a.ruleId, b.ruleId) ||
      compare(a.message, b.message),
  );
  for (const item of analyzed.diagnostics) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const setting = config.rules?.[item.ruleId];
    const suppression = config.suppressions?.find(
      (s) =>
        s.ruleId === item.ruleId &&
        picomatch(slash(s.file), { dot: true })(item.location.file),
    );
    const directive = inline
      .get(item.location.file)
      ?.find((d) => d.id === item.ruleId && d.line === item.location.line);
    if (setting === 'off' || suppression || directive)
      report.suppressed.push({
        diagnostic: item,
        source:
          directive && setting !== 'off' && !suppression
            ? 'inline'
            : 'configuration',
        reason:
          setting === 'off'
            ? 'Rule disabled in configuration'
            : (suppression?.reason ??
              directive?.reason ??
              'No reason supplied'),
      });
    else
      report.diagnostics.push(setting ? { ...item, severity: setting } : item);
  }
  return report;
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
