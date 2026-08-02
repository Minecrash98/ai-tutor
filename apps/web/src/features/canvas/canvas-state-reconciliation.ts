export function retainMapKeys<T>(
  values: ReadonlyMap<string, T>,
  allowedKeys: ReadonlySet<string>,
): ReadonlyMap<string, T> {
  if ([...values.keys()].every((key) => allowedKeys.has(key))) {
    return values;
  }

  return new Map([...values].filter(([key]) => allowedKeys.has(key)));
}

export function reconcileMapKeysWithTombstones<T>(
  values: ReadonlyMap<string, T>,
  allowedKeys: ReadonlySet<string>,
  tombstones: Map<string, T>,
): ReadonlyMap<string, T> {
  const next = new Map(values);
  let changed = false;
  for (const [key, value] of values) {
    if (allowedKeys.has(key)) continue;
    tombstones.set(key, value);
    next.delete(key);
    changed = true;
  }
  for (const key of allowedKeys) {
    if (next.has(key)) continue;
    const restored = tombstones.get(key);
    if (!restored) continue;
    next.set(key, restored);
    tombstones.delete(key);
    changed = true;
  }
  return changed ? next : values;
}

export function retainValidComparisons<
  T extends { readonly sourceBlockId: string },
>(
  comparisons: ReadonlyMap<string, T>,
  comparisonBlockIds: ReadonlySet<string>,
  runnableBlockIds: ReadonlySet<string>,
): ReadonlyMap<string, T> {
  if (
    [...comparisons].every(
      ([blockId, comparison]) =>
        comparisonBlockIds.has(blockId) &&
        runnableBlockIds.has(comparison.sourceBlockId),
    )
  ) {
    return comparisons;
  }

  return new Map(
    [...comparisons].filter(
      ([blockId, comparison]) =>
        comparisonBlockIds.has(blockId) &&
        runnableBlockIds.has(comparison.sourceBlockId),
    ),
  );
}

export function reconcileComparisonsWithTombstones<
  T extends { readonly sourceBlockId: string },
>(
  comparisons: ReadonlyMap<string, T>,
  comparisonBlockIds: ReadonlySet<string>,
  runnableBlockIds: ReadonlySet<string>,
  tombstones: Map<string, T>,
): ReadonlyMap<string, T> {
  const validKeys = new Set(
    [...comparisonBlockIds].filter((blockId) => {
      const candidate = comparisons.get(blockId) ?? tombstones.get(blockId);
      return candidate && runnableBlockIds.has(candidate.sourceBlockId);
    }),
  );
  return reconcileMapKeysWithTombstones(
    comparisons,
    validKeys,
    tombstones,
  );
}
