import type { Context } from '@app-builder/core';
import { EXPORT_FORMAT_VERSION, EXPORT_TABLES, exportPart } from './domain/export.js';
import { withInvocation } from './runtime.js';

/**
 * The kit's personal export (Settings, Download my data): every part of
 * People's own export, under the caller's access, as it was in Ri's Sources.
 * CSV parts stay CSV text and JSON parts stay JSON text, with stable ids and
 * the format version. Message bodies are never exported.
 */
export async function exportPeople(kit: Context) {
  return withInvocation(kit, {}, (invocation, c) => {
    const scope = c.scopes.resolve(invocation, 'read');
    const parts: { table: string; fileName: string; mimeType: string; content: string }[] = [];
    for (const table of EXPORT_TABLES) {
      let cursor: string | undefined;
      do {
        const part = exportPart(c, scope, { table, cursor });
        parts.push({ table, fileName: part.fileName, mimeType: part.mimeType, content: part.content });
        cursor = part.nextCursor ?? undefined;
      } while (cursor);
    }
    return { records: { app: 'people', formatVersion: EXPORT_FORMAT_VERSION, parts } };
  });
}
