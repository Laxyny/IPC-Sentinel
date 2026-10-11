import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { getRule, severities } from './rules.js';
import type { Config, Severity } from './types.js';
export const defaultExcludes = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/out/**',
];
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function validateConfig(value: unknown): Config {
  if (!record(value)) throw new Error('Configuration must be a JSON object');
  const allowed = [
    'include',
    'exclude',
    'rules',
    'suppressions',
    'electronVersion',
    'maxFiles',
    'maxFileBytes',
    'maxTotalBytes',
  ];
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(`Unknown configuration property: ${key}`);
  for (const key of ['include', 'exclude']) {
    const patterns = value[key];
    if (
      patterns !== undefined &&
      (!Array.isArray(patterns) ||
        !patterns.every(
          (p) =>
            typeof p === 'string' &&
            p.length > 0 &&
            p.length <= 512 &&
            !p.startsWith('!'),
        ))
    )
      throw new Error(
        `${key} must contain nonempty glob strings (no negation, maximum 512 characters)`,
      );
  }
  if (value.rules !== undefined) {
    if (!record(value.rules)) throw new Error('rules must be an object');
    for (const [id, setting] of Object.entries(value.rules)) {
      getRule(id);
      if (
        setting !== 'off' &&
        (typeof setting !== 'string' ||
          !severities.includes(setting as Severity))
      )
        throw new Error(`Invalid severity for ${id}`);
    }
  }
  if (value.suppressions !== undefined) {
    if (!Array.isArray(value.suppressions))
      throw new Error('suppressions must be an array');
    for (const item of value.suppressions) {
      if (
        !record(item) ||
        typeof item.ruleId !== 'string' ||
        typeof item.file !== 'string' ||
        !item.file ||
        (item.reason !== undefined && typeof item.reason !== 'string') ||
        Object.keys(item).some((k) => !['ruleId', 'file', 'reason'].includes(k))
      )
        throw new Error(
          'Invalid suppression: expected ruleId, file glob, optional reason',
        );
      getRule(item.ruleId);
    }
  }
  for (const key of [
    'electronVersion',
    'maxFiles',
    'maxFileBytes',
    'maxTotalBytes',
  ]) {
    if (
      value[key] !== undefined &&
      (!Number.isSafeInteger(value[key]) || Number(value[key]) <= 0)
    )
      throw new Error(`${key} must be a positive safe integer`);
  }
  return value as Config;
}
export async function readJson(
  file: string,
  allowComments = false,
): Promise<unknown> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw new Error(
      'JSON configuration must be a regular file of at most 1 MiB',
    );
  const text = await readFile(file, 'utf8');
  if (allowComments) {
    const parsed = ts.parseConfigFileTextToJson(file, text);
    if (parsed.error)
      throw new Error(
        'Invalid project JSON configuration; source values omitted',
      );
    return parsed.config as unknown;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Invalid JSON configuration; source values omitted');
  }
}
export async function loadConfig(
  root: string,
  explicit?: string,
  overrides?: Config,
): Promise<Config> {
  let config: Config = {};
  const file = explicit
    ? path.resolve(root, explicit)
    : path.join(root, 'ipc-sentinel.config.json');
  try {
    config = validateConfig(await readJson(file));
  } catch (error) {
    if (explicit || (error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error;
  }
  return validateConfig({
    ...config,
    ...overrides,
    rules: { ...config.rules, ...overrides?.rules },
  });
}
