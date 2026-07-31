/**
 * @fileoverview Cross-tool coverage for the output fields Open States sends as `""`: each must
 * document that in its own `.describe()`, and each must stay a required non-nullable string.
 * @module tests/tools/output-schema-empty-strings.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { describe, expect, it } from 'vitest';
import { getBill } from '@/mcp-server/tools/definitions/get-bill.tool.js';
import { getCommittee } from '@/mcp-server/tools/definitions/get-committee.tool.js';
import { getEvent } from '@/mcp-server/tools/definitions/get-event.tool.js';
import { getJurisdiction } from '@/mcp-server/tools/definitions/get-jurisdiction.tool.js';
import { getLegislatorsByLocation } from '@/mcp-server/tools/definitions/get-legislators-by-location.tool.js';
import { listJurisdictions } from '@/mcp-server/tools/definitions/list-jurisdictions.tool.js';
import { searchBills } from '@/mcp-server/tools/definitions/search-bills.tool.js';
import { searchCommittees } from '@/mcp-server/tools/definitions/search-committees.tool.js';
import { searchEvents } from '@/mcp-server/tools/definitions/search-events.tool.js';
import { searchPeople } from '@/mcp-server/tools/definitions/search-people.tool.js';

/** The subset of JSON Schema these assertions read. */
interface SchemaNode {
  description?: string;
  items?: SchemaNode;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  type?: string | string[];
}

interface FieldFacts {
  description: string | undefined;
  nullable: boolean;
  optional: boolean;
  type: string | string[] | undefined;
}

/**
 * Flattens a JSON Schema into `dotted.path` → the facts a `structuredContent` consumer reads off
 * that field. Array element types contribute a `[]` segment, so a bill's version dates address as
 * `versions[].date`. Assertions run against the emitted JSON Schema rather than the Zod object
 * because that is the artifact a client actually receives.
 */
function fieldFacts(node: SchemaNode, prefix = '', acc = new Map<string, FieldFacts>()) {
  if (node.properties) {
    const required = new Set(node.required ?? []);
    for (const [key, child] of Object.entries(node.properties)) {
      const path = prefix ? `${prefix}.${key}` : key;
      acc.set(path, {
        description: child.description,
        nullable: Array.isArray(child.type) ? child.type.includes('null') : false,
        optional: !required.has(key),
        type: child.type,
      });
      fieldFacts(child, path, acc);
    }
  }
  if (node.items) fieldFacts(node.items, `${prefix}[]`, acc);
  return acc;
}

/** Emits a tool's advertised output schema in the shape the assertions walk. */
const outputSchema = (schema: unknown) => z.toJSONSchema(schema as never) as SchemaNode;

/**
 * Every field the upstream (or this server's own normalization, which substitutes `''` for an
 * absent key) can hand back as an empty string, per tool. Bill version and document dates,
 * legislative session classifications, and person link notes are the frequently-hit ones; the rest
 * share the shape and the same required non-nullable declaration, so a consumer cannot tell `""`
 * from a malformed record on any of them without the description saying so.
 */
const BILL_FIELDS = [
  'actions[].date',
  'votes[].start_date',
  'abstracts[].note',
  'versions[].note',
  'versions[].date',
  'documents[].note',
  'documents[].date',
  'other_titles[].note',
  'sources[].note',
];
const SESSION_FIELDS = ['classification', 'start_date', 'end_date'].map(
  (field) => `legislative_sessions[].${field}`,
);
const PERSON_FIELDS = [
  'given_name',
  'family_name',
  'email',
  'party',
  'openstates_url',
  'links[].note',
  'other_names[].note',
  'sources[].note',
];
const COMMITTEE_FIELDS = [
  'memberships[].person_id',
  'memberships[].person_name',
  'memberships[].role',
  'links[].note',
  'sources[].note',
];
const EVENT_FIELDS = ['links[].note', 'media[].note', 'documents[].note', 'sources[].note'];

const prefixed = (prefix: string, fields: string[]) => fields.map((field) => `${prefix}${field}`);

const CASES: Array<{ fields: string[]; name: string; schema: unknown }> = [
  { name: getBill.name, schema: getBill.output, fields: BILL_FIELDS },
  {
    name: searchBills.name,
    schema: searchBills.output,
    fields: prefixed('results[].', BILL_FIELDS),
  },
  { name: getJurisdiction.name, schema: getJurisdiction.output, fields: SESSION_FIELDS },
  {
    name: listJurisdictions.name,
    schema: listJurisdictions.output,
    fields: prefixed('results[].', SESSION_FIELDS),
  },
  {
    name: searchPeople.name,
    schema: searchPeople.output,
    fields: prefixed('results[].', PERSON_FIELDS),
  },
  {
    name: getLegislatorsByLocation.name,
    schema: getLegislatorsByLocation.output,
    fields: prefixed('legislators[].', PERSON_FIELDS),
  },
  { name: getCommittee.name, schema: getCommittee.output, fields: COMMITTEE_FIELDS },
  {
    name: searchCommittees.name,
    schema: searchCommittees.output,
    fields: prefixed('results[].', COMMITTEE_FIELDS),
  },
  { name: getEvent.name, schema: getEvent.output, fields: EVENT_FIELDS },
  {
    name: searchEvents.name,
    schema: searchEvents.output,
    fields: prefixed('results[].', EVENT_FIELDS),
  },
];

describe.each(CASES)('$name — fields that can arrive empty', ({ schema, fields }) => {
  const facts = fieldFacts(outputSchema(schema));

  it.each(fields)('%s documents its empty-string case', (path) => {
    expect(facts.get(path)?.description).toMatch(/empty string/i);
  });

  /**
   * The fix is documentation only. Widening any of these to `.nullable()`/`.optional()` and
   * normalizing `""` away would discard the distinction between a value upstream left blank and a
   * key it never sent, and would break every client parsing the current contract.
   */
  it.each(fields)('%s stays a required non-nullable string', (path) => {
    expect(facts.get(path)).toMatchObject({ type: 'string', nullable: false, optional: false });
  });
});

describe('legislative session endpoints', () => {
  const paths = [
    { schema: getJurisdiction.output, prefix: '' },
    { schema: listJurisdictions.output, prefix: 'results[].' },
  ];

  /**
   * The wording is the load-bearing part here. Every session Open States leaves without an end
   * date concluded years ago, so a model that reads the empty value as "still in session" draws
   * exactly the wrong conclusion — the same one the `format()` rendering was written to avoid.
   */
  it.each(paths)('warns that a missing endpoint is unknown, not ongoing', ({ schema, prefix }) => {
    const facts = fieldFacts(outputSchema(schema));
    for (const field of ['start_date', 'end_date']) {
      expect(facts.get(`${prefix}legislative_sessions[].${field}`)?.description).toMatch(
        /not ongoing/i,
      );
    }
  });
});
