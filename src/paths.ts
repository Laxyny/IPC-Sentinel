export const slash = (value: string): string => value.replaceAll('\\', '/');
export function withinScope(file: string, scope: string): boolean {
  const normalize = (value: string): string =>
    process.platform === 'win32' ? slash(value).toLowerCase() : slash(value);
  return normalize(file).startsWith(normalize(scope) + '/');
}
