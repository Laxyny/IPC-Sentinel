const allowed = new Set(['typescript-eslint', 'vitest', '@vitest/coverage-v8']);
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const equal = (a, b) => canonical(a) === canonical(b);
function approvedPatch(base, head, oldLock, newLock, files) {
  if (
    files.length !== 2 ||
    !files.includes('package.json') ||
    !files.includes('package-lock.json')
  )
    return false;
  const { devDependencies: oldDev, ...oldMetadata } = base;
  const { devDependencies: newDev, ...newMetadata } = head;
  if (!oldDev || !newDev || !equal(oldMetadata, newMetadata)) return false;
  const changed = [
    ...new Set([...Object.keys(oldDev), ...Object.keys(newDev)]),
  ].filter((name) => oldDev[name] !== newDev[name]);
  if (
    !changed.length ||
    changed.some((name) => {
      if (!allowed.has(name)) return true;
      const before = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
        oldDev[name] ?? '',
      );
      const after = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
        newDev[name] ?? '',
      );
      return (
        !before ||
        !after ||
        before[1] !== after[1] ||
        before[2] !== after[2] ||
        Number(after[3]) <= Number(before[3])
      );
    })
  )
    return false;
  if (newDev.vitest !== newDev['@vitest/coverage-v8']) return false;
  const { packages: oldPackages, ...oldLockMetadata } = oldLock;
  const { packages: newPackages, ...newLockMetadata } = newLock;
  if (
    oldLock.lockfileVersion !== 3 ||
    !oldPackages ||
    !newPackages ||
    !equal(oldLockMetadata, newLockMetadata)
  )
    return false;
  if (!equal(newPackages['']?.devDependencies, newDev)) return false;
  for (const name of new Set([
    ...Object.keys(oldPackages),
    ...Object.keys(newPackages),
  ])) {
    const before = oldPackages[name],
      after = newPackages[name];
    if (equal(before, after)) continue;
    if (name === '') {
      const a = { ...before },
        b = { ...after };
      delete a.devDependencies;
      delete b.devDependencies;
      if (!equal(a, b)) return false;
    } else if (
      (before && before.dev !== true) ||
      (after && after.dev !== true) ||
      (after?.resolved &&
        !after.resolved.startsWith('https://registry.npmjs.org/'))
    )
      return false;
  }
  return true;
}
module.exports = { approvedPatch };
