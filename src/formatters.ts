import { rules } from './rules.js';
import type { Location, ScanReport } from './types.js';
export function sanitize(value: string): string {
  return value.replace(
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    '?',
  );
}
export function formatText(report: ScanReport, quiet = false): string {
  const lines = report.diagnostics.map(
    (d) =>
      `${sanitize(d.location.file)}:${d.location.line}:${d.location.column} [${d.severity.toUpperCase()}] ${d.ruleId} ${sanitize(d.message)}\n  ${sanitize(d.remediation)}`,
  );
  if (!quiet)
    lines.push(
      `${report.files.length} files, ${report.endpoints.length} IPC endpoints, ${report.diagnostics.length} findings, ${report.suppressed.length} suppressed. Analysis ${report.complete ? 'complete within documented scope' : 'incomplete'}.`,
    );
  return lines.join('\n');
}
export function formatSarif(report: ScanReport): object {
  const at = (loc: Location): object => ({
    physicalLocation: {
      artifactLocation: {
        uri: loc.file.split('/').map(encodeURIComponent).join('/'),
        uriBaseId: '%SRCROOT%',
      },
      region: {
        startLine: loc.line,
        startColumn: loc.column,
        endLine: loc.endLine,
        endColumn: loc.endColumn,
      },
    },
  });
  const result = (
    d: ScanReport['diagnostics'][number],
  ): Record<string, unknown> => ({
    ruleId: d.ruleId,
    ruleIndex: rules.findIndex((r) => r.id === d.ruleId),
    level: ['critical', 'high'].includes(d.severity)
      ? 'error'
      : d.severity === 'informational'
        ? 'note'
        : 'warning',
    message: { text: d.message },
    locations: [at(d.location)],
    relatedLocations: d.relatedLocations.map((loc, index) => ({
      id: index + 1,
      ...at(loc),
    })),
    properties: {
      severity: d.severity,
      confidence: d.confidence,
      kind: d.kind,
      remediation: d.remediation,
    },
  });
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'IPC Sentinel',
            version: report.toolVersion,
            informationUri: 'https://github.com/Laxyny/IPC-Sentinel',
            rules: rules.map((r) => ({
              id: r.id,
              shortDescription: { text: r.title },
              fullDescription: { text: r.explanation },
              helpUri: r.documentationUrl,
              help: { text: r.remediation },
            })),
          },
        },
        invocations: [{ executionSuccessful: report.complete }],
        results: [
          ...report.diagnostics.map(result),
          ...report.suppressed.map((s) => ({
            ...result(s.diagnostic),
            suppressions: [
              {
                kind: s.source === 'inline' ? 'inSource' : 'external',
                justification: s.reason,
                status: 'accepted',
              },
            ],
          })),
        ],
      },
    ],
  };
}
