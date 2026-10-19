import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const { scanProject } = await import(pathToFileURL(process.argv[2]).href);
const start = performance.now();
const report = await scanProject({ root: process.argv[3], config: {} });
const elapsedMs = Math.round(performance.now() - start);
// Full findings stay in the local cache, outside the public repository.
await writeFile(process.argv[4], JSON.stringify(report));
const findings = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [
    `IPC00${i + 1}`,
    report.diagnostics.filter((d) => d.ruleId === `IPC00${i + 1}`).length,
  ]),
);
const peak = process.resourceUsage().maxRSS;
console.log(
  JSON.stringify({
    files: report.files.length,
    endpoints: report.endpoints.length,
    findings,
    findingsBySeverity: Object.fromEntries(
      ['critical', 'high', 'medium', 'low', 'informational'].map((severity) => [
        severity,
        report.diagnostics.filter((d) => d.severity === severity).length,
      ]),
    ),
    inconclusive: report.diagnostics.filter((d) => d.kind === 'inconclusive')
      .length,
    complete: report.complete,
    elapsedMs,
    peakRssMiB: peak > 0 ? Math.round(peak / 1024) : null,
    rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  }),
);
