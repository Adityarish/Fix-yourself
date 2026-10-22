export function changedFieldsAfterBase(
  revisions: Array<{ version: number; changedFields: string[] }>,
  baseVersion: number,
) {
  return new Set(
    revisions
      .filter((revision) => revision.version > baseVersion)
      .flatMap((revision) => revision.changedFields),
  );
}

export function overlappingFields(
  serverFields: Iterable<string>,
  clientPatch: Record<string, unknown>,
) {
  const changed = new Set(serverFields);
  return Object.keys(clientPatch).filter((field) => changed.has(field));
}

export function mergeDisjoint<T extends Record<string, unknown>>(
  server: T,
  patch: Record<string, unknown>,
) {
  return { ...server, ...patch } as T;
}
