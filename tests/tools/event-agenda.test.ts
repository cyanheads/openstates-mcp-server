/**
 * @fileoverview Event agenda wire contracts for linked and name-only references.
 * @module tests/tools/event-agenda.test
 */

import { parseConfig } from '@cyanheads/mcp-ts-core/config';
import {
  createFetchMock,
  createInMemoryStorage,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEvent } from '@/mcp-server/tools/definitions/get-event.tool.js';
import { searchEvents } from '@/mcp-server/tools/definitions/search-events.tool.js';
import {
  initOpenStatesApiService,
  shutdownOpenStatesApiService,
} from '@/services/openstates/openstates-service.js';
import { inlineTypes, readBack } from '../helpers/commonmark.js';

const apiBaseUrl = 'https://openstates.example.test';
const eventId = 'ocd-event/338cc560-0352-494f-9055-1f45759543ea';
const event = {
  id: eventId,
  name: 'Committee hearing',
  description: 'Public hearing',
  classification: 'committee-meeting',
  start_date: '2025-03-15T09:00:00',
  status: 'passed',
  jurisdiction: { id: 'ocd-jurisdiction/country:us/state:ca/government', name: 'California' },
  participants: [{ name: 'Chair', entity_type: 'person', role: 'host' }],
  documents: [
    {
      note: 'Agenda',
      date: '',
      classification: '',
      links: [{ url: 'https://example.test/agenda.pdf' }],
    },
  ],
};
const agendaItem = { description: 'Public testimony', classification: ['hearing'], subjects: [] };
const nameOnly = { name: 'Joint hearing', entity_type: 'organization' };
const billId = 'ocd-bill/00000000-0000-4000-8000-000000000001';
const orgId = 'ocd-organization/00000000-0000-4000-8000-000000000002';
const personId = 'ocd-person/00000000-0000-4000-8000-000000000003';
const voteId = 'ocd-vote/00000000-0000-4000-8000-000000000004';
const hostileIdentifier = 'HB *200*';
const hostileSession = '[2025](https://example.test)';

describe.each(['search', 'detail'] as const)('event agenda via %s', (mode) => {
  beforeEach(() => {
    initOpenStatesApiService(parseConfig({}), createInMemoryStorage(), {
      apiKey: 'test-key',
      apiBaseUrl,
      dailyRequestBudget: 50,
      requestTimeoutMs: 5000,
      totalRequestBudgetMs: 10_000,
    });
  });

  afterEach(shutdownOpenStatesApiService);

  async function call(agenda?: unknown[]) {
    const record = { ...event, agenda };
    const http = createFetchMock([
      {
        match: (request) => {
          const url = new URL(request.url);
          const path = mode === 'search' ? '/events' : `/events/${encodeURIComponent(eventId)}`;
          return url.origin === apiBaseUrl && url.pathname === path;
        },
        respond: Response.json(
          mode === 'search'
            ? {
                results: [record],
                pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
              }
            : record,
        ),
      },
    ]);
    http.install();
    try {
      const include: Array<'agenda' | 'participants' | 'documents'> = [
        'agenda',
        'participants',
        'documents',
      ];
      const result =
        mode === 'search'
          ? await runToolContract(searchEvents, { jurisdiction: 'ca', include })
          : await runToolContract(getEvent, { event_id: eventId, include });
      expect(result.isError).not.toBe(true);
      expect(new URL(http.calls[0]!.request.url).searchParams.getAll('include')).toEqual(include);
      const body = result.structuredContent;
      if (typeof body !== 'object' || body === null) throw new Error('Expected a structured event');
      const content = result.content.find((block) => block.type === 'text')?.text;
      if (content === undefined) throw new Error('Expected rendered event text');
      const record: unknown =
        'results' in body && Array.isArray(body.results) ? body.results[0] : body;
      return { record, text: content };
    } finally {
      http.restore();
    }
  }

  it('keeps name-only references, participants and documents', async () => {
    const agenda = [{ ...agendaItem, related_entities: [{ ...nameOnly, note: 'host' }] }];
    const result = await call(agenda);
    expect(result.record).toMatchObject({
      agenda: [{ ...agendaItem, related_entities: [nameOnly] }],
      participants: event.participants,
      documents: event.documents,
    });
    expect(readBack(result.text).join('\n')).toContain('Related: Joint hearing (organization)');
  });

  it('omits the agenda when upstream has no agenda', async () => {
    const result = await call();
    expect(result.record).not.toHaveProperty('agenda');
    expect(readBack(result.text)).not.toContain('Agenda:');
  });

  it('projects every linked record and keeps its text literal', async () => {
    const related = [
      {
        name: 'Bill on education',
        entity_type: 'bill',
        bill: {
          id: billId,
          identifier: hostileIdentifier,
          session: hostileSession,
          title: 'Unprojected title',
        },
      },
      {
        name: 'Finance',
        entity_type: 'organization',
        organization: {
          id: orgId,
          classification: 'committee',
          name: 'Unprojected organization name',
        },
      },
      {
        name: 'Witness',
        entity_type: 'person',
        person: { id: personId, name: 'Unprojected witness name' },
      },
      {
        name: 'Roll call',
        entity_type: 'vote',
        vote: { id: voteId, motion_text: 'Unprojected motion' },
      },
    ];
    const result = await call([
      { ...agendaItem, related_entities: [nameOnly] },
      { ...agendaItem, description: 'Discussion and vote', related_entities: related },
    ]);
    expect(result.record).toHaveProperty('agenda', [
      { ...agendaItem, related_entities: [nameOnly] },
      {
        ...agendaItem,
        description: 'Discussion and vote',
        related_entities: [
          {
            name: 'Bill on education',
            entity_type: 'bill',
            bill: { id: billId, identifier: hostileIdentifier, session: hostileSession },
          },
          {
            name: 'Finance',
            entity_type: 'organization',
            organization: { id: orgId, classification: 'committee' },
          },
          { name: 'Witness', entity_type: 'person', person: { id: personId } },
          { name: 'Roll call', entity_type: 'vote', vote: { id: voteId } },
        ],
      },
    ]);
    const rendered = readBack(result.text).find((block) => block.includes('Discussion and vote'));
    for (const value of [
      billId,
      orgId,
      personId,
      voteId,
      hostileIdentifier,
      hostileSession,
      'committee',
    ]) {
      expect(rendered).toContain(value);
    }
    expect(inlineTypes(result.text)).not.toContain('em_open');
    expect(result.text).not.toContain('Unprojected');
  });

  it('preserves sparse references and omits null links and null companion fields', async () => {
    const result = await call([
      {
        ...agendaItem,
        related_entities: [
          { ...nameOnly, bill: null, organization: null, person: null, vote: null },
          {
            name: 'HB 1',
            entity_type: 'bill',
            bill: { id: billId, identifier: null, session: null },
          },
          {
            name: 'Chamber',
            entity_type: 'organization',
            organization: { id: orgId, classification: null },
          },
          { name: 'Witness', entity_type: 'person', person: { id: null } },
          { name: 'Roll call', entity_type: 'vote', vote: {} },
        ],
      },
    ]);
    expect(result.record).toHaveProperty('agenda', [
      {
        ...agendaItem,
        related_entities: [
          nameOnly,
          { name: 'HB 1', entity_type: 'bill', bill: { id: billId } },
          { name: 'Chamber', entity_type: 'organization', organization: { id: orgId } },
          { name: 'Witness', entity_type: 'person' },
          { name: 'Roll call', entity_type: 'vote' },
        ],
      },
    ]);
    const rendered = readBack(result.text).find((block) =>
      block.includes('Related: Joint hearing'),
    );
    for (const value of [billId, orgId, 'Witness (person)', 'Roll call (vote)']) {
      expect(rendered).toContain(value);
    }
    expect(rendered).not.toMatch(/null|undefined|Session:/);
  });
});
