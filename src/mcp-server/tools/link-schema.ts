/**
 * @fileoverview Output schema for Open States Link items with field-specific descriptions.
 * @module mcp-server/tools/link-schema
 */

import { z } from '@cyanheads/mcp-ts-core';

/** Requires the URL and preserves an omitted note separately from an explicitly empty note. */
export function linkSchema(urlDescription: string, noteDescription: string, description: string) {
  return z
    .object({
      url: z.string().describe(urlDescription),
      note: z
        .string()
        .optional()
        .describe(
          `${noteDescription} Absent or an empty string when Open States recorded no note.`,
        ),
    })
    .describe(description);
}

/** Provenance source attached to an Open States result. */
export const sourceLinkSchema = linkSchema('Source URL.', 'Source note.', 'Source record.');
