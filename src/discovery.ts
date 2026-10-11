import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import { defaultExcludes } from './config.js';
import type { Config } from './types.js';
export const slash = (value: string): string => value.replaceAll('\\', '/');
export interface Discovery {
  root: string;
  sources: Map<string, string>;
  issues: { file: string; message: string }[];
  observations: string[];
}
export async function discover(
  rootInput: string,
  config: Config,
): Promise<Discovery> {
  const root = await realpath(rootInput);
  if (!(await lstat(root)).isDirectory())
    throw new Error('Scan root must be a directory');
  const sources = new Map<string, string>();
  const issues: Discovery['issues'] = [];
  const observations: string[] = [];
  const includes = picomatch(
    config.include ?? ['**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'],
    { dot: true },
  );
  const excludes = picomatch(
    [
      ...defaultExcludes,
      ...(config.exclude ?? [])
        .map(slash)
        .flatMap((p) => [p, p.endsWith('/**') ? p : `${p}/**`]),
    ],
    { dot: true },
  );
  let bytes = 0;
  let visited = 0;
  let stopped = false;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      issues.push({
        file: slash(path.relative(root, dir)) || '.',
        message: 'Directory could not be read',
      });
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (stopped) return;
      if (++visited > 100000) {
        issues.push({
          file: '.',
          message: 'Directory entry limit (100000) reached',
        });
        stopped = true;
        return;
      }
      const file = path.join(dir, entry.name);
      const rel = slash(path.relative(root, file));
      if (excludes(rel) || (entry.isDirectory() && excludes(`${rel}/`)))
        continue;
      if (entry.isSymbolicLink()) {
        observations.push(`Skipped symbolic link: ${rel}`);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(file);
        continue;
      }
      if (!entry.isFile() || !includes(rel) || /\.d\.(?:ts|mts|cts)$/.test(rel))
        continue;
      if (sources.size >= (config.maxFiles ?? 10000)) {
        issues.push({ file: rel, message: 'Source file count limit reached' });
        stopped = true;
        return;
      }
      try {
        const stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          issues.push({
            file: rel,
            message: 'Source changed during discovery',
          });
          continue;
        }
        if (stat.size > (config.maxFileBytes ?? 2 * 1024 * 1024)) {
          issues.push({
            file: rel,
            message: 'Source file size limit exceeded',
          });
          continue;
        }
        if (bytes + stat.size > (config.maxTotalBytes ?? 32 * 1024 * 1024)) {
          issues.push({
            file: rel,
            message: 'Total source byte limit reached',
          });
          stopped = true;
          return;
        }
        const text = await readFile(file, 'utf8');
        bytes += Buffer.byteLength(text);
        sources.set(file, text);
      } catch {
        issues.push({ file: rel, message: 'Source file could not be read' });
      }
    }
  }
  await walk(root);
  return { root, sources, issues, observations };
}
