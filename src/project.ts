import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { readJson } from './config.js';
import { slash } from './paths.js';
import type { Discovery } from './discovery.js';

export interface AliasConfig {
  base?: string | undefined;
  paths: Record<string, string[]>;
  pathsBase: string;
  hasPaths: boolean;
}
const inside = (root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return (
    !relative.startsWith('..' + path.sep) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
};

// Data only. Never ask TypeScript to load package configs or arbitrary files.
export async function projectSettings(
  discovery: Discovery,
): Promise<Map<string, AliasConfig>> {
  const aliases = new Map<string, AliasConfig>();
  const checked = new Set<string>();
  const cache = new Map<string, AliasConfig>();
  const load = async (
    file: string,
    stack = new Set<string>(),
  ): Promise<AliasConfig> => {
    if (stack.size >= 10 || stack.has(file) || cache.size >= 100)
      throw new Error('tsconfig inheritance cycle or resource limit');
    if (
      !inside(discovery.root, file) ||
      !inside(discovery.root, await realpath(file))
    )
      throw new Error('tsconfig inheritance escapes the scan root');
    const saved = cache.get(file);
    if (saved) return saved;
    const next = new Set(stack).add(file);
    const raw = (await readJson(file, true)) as {
      extends?: unknown;
      compilerOptions?: { baseUrl?: unknown; paths?: unknown };
    };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid tsconfig object');
    let result: AliasConfig = {
      paths: {},
      pathsBase: path.dirname(file),
      hasPaths: false,
    };
    if (raw.extends !== undefined) {
      const parents = Array.isArray(raw.extends) ? raw.extends : [raw.extends];
      if (!parents.length || parents.length > 10)
        throw new Error('Invalid tsconfig inheritance');
      for (const parent of parents) {
        if (
          typeof parent !== 'string' ||
          !parent.startsWith('.') ||
          parent.includes('\0')
        )
          throw new Error(
            'Only root-contained relative tsconfig inheritance is supported',
          );
        let target = path.resolve(path.dirname(file), parent);
        if (!path.extname(target)) target += '.json';
        try {
          const inherited = await load(target, next);
          result = {
            ...result,
            ...(inherited.base ? { base: inherited.base } : {}),
            ...(inherited.hasPaths
              ? {
                  paths: inherited.paths,
                  pathsBase: inherited.pathsBase,
                  hasPaths: true,
                }
              : {}),
          };
        } catch {
          throw new Error('Inherited tsconfig could not be resolved safely');
        }
      }
    }
    const opts = raw.compilerOptions;
    if (opts && (typeof opts !== 'object' || Array.isArray(opts)))
      throw new Error('Invalid compiler options');
    const base =
      opts?.baseUrl === undefined
        ? result.base
        : typeof opts.baseUrl === 'string'
          ? path.resolve(path.dirname(file), opts.baseUrl)
          : undefined;
    if (opts?.baseUrl !== undefined && !base)
      throw new Error('Invalid baseUrl');
    let paths = result.paths;
    let pathsBase = result.pathsBase;
    let hasPaths = result.hasPaths;
    if (opts?.paths !== undefined) {
      if (
        !opts.paths ||
        typeof opts.paths !== 'object' ||
        Array.isArray(opts.paths)
      )
        throw new Error('Invalid paths');
      paths = {};
      pathsBase = path.dirname(file);
      hasPaths = true;
      for (const [key, value] of Object.entries(opts.paths)) {
        if (
          !Array.isArray(value) ||
          !value.every((v) => typeof v === 'string') ||
          key.split('*').length > 2
        )
          throw new Error('Invalid alias paths');
        paths[key] = value;
      }
    }
    // baseUrl is inherited independently; paths without it use their declaring file.
    result = { base, paths, pathsBase, hasPaths };
    cache.set(file, result);
    return result;
  };
  for (const file of discovery.sources.keys()) {
    let dir = path.dirname(file);
    while (!checked.has(dir)) {
      checked.add(dir);
      try {
        aliases.set(dir, await load(path.join(dir, 'tsconfig.json')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          discovery.issues.push({
            file: slash(
              path.relative(discovery.root, path.join(dir, 'tsconfig.json')),
            ),
            message:
              'tsconfig settings could not be resolved safely; aliases may be incomplete',
          });
      }
      if (dir === discovery.root || path.dirname(dir) === dir) break;
      dir = path.dirname(dir);
    }
  }
  return aliases;
}

export async function workspaceRoots(
  discovery: Discovery,
): Promise<string[] | undefined> {
  const checked = new Set<string>();
  const roots: string[] = [];
  for (const source of discovery.sources.keys()) {
    let dir = path.dirname(source);
    while (dir !== discovery.root && !checked.has(dir)) {
      checked.add(dir);
      try {
        const file = path.join(dir, 'package.json');
        if (!inside(discovery.root, await realpath(file))) break;
        const pkg = (await readJson(file)) as {
          dependencies?: Record<string, unknown>;
          devDependencies?: Record<string, unknown>;
        };
        if (
          typeof (
            pkg?.dependencies?.electron ?? pkg?.devDependencies?.electron
          ) === 'string'
        )
          roots.push(slash(path.relative(discovery.root, dir)));
      } catch {
        /* Package metadata is optional and never executable. */
      }
      dir = path.dirname(dir);
    }
  }
  roots.sort();
  if (roots.length < 2) return undefined;
  if (
    roots.length > 100 ||
    roots.some((a, i) => roots.some((b, j) => i !== j && b.startsWith(a + '/')))
  ) {
    discovery.issues.push({
      file: '.',
      message:
        'Electron package boundaries are ambiguous; configure applicationRoots explicitly',
    });
    return undefined;
  }
  discovery.observations.push(
    'Independent Electron package directories form separate application graphs; unassigned source remains inconclusive. Override with applicationRoots.',
  );
  return roots;
}
