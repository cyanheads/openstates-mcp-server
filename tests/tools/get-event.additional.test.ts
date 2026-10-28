/**
 * @fileoverview Additional coverage for getEvent: not_found re-throw,
 * location rendering, links, media, documents, and edge cases.
 * @module tests/tools/get-event.additional.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEvent } from '@/mcp-server/tools/definitions/get-event.tool.js';
import { inlineTypes, links, normalizeLink, readBack } from '../helpers/commonmark.js';
import { AUTHORED_INLINE, HOSTILE, leaves, withLeaf } from '../helpers/markdown-sweep.js';

vi.mock('@/services/openstates/openstates-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/openstates/openstates-service.js')>()),
  getOpenStatesApiService: vi.fn(),
}));

const baseEvent = {
  id: 'ocd-event/evt-1',
  name: 'Transportation Committee Hearing',
  description: 'Public hearing on HB 1000',
  classification: 'committee-meeting',
  start_date: '2025-03-15T09:00:00',
  end_date: '2025-03-15T12:00:00',
  status: 'passed',
  jurisdiction: {
    id: 'ocd-jurisdiction/country:us/state:wa/government',
    name: 'Washington',
  },
};

describe('getEvent — not_found contract error', () => {
  let mockService: { getEvent: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getEvent: vi.fn() };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('re-throws McpError NotFound as not_found contract error', async () => {
    mockService.getEvent.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'Event not found'),
    );
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/nonexistent' });
    await expect(getEvent.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'not_found' },
    });
  });

  it('propagates non-NotFound errors without wrapping', async () => {
    mockService.getEvent.mockRejectedValue(new Error('Service offline'));
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/timeout' });
    await expect(getEvent.handler(input, ctx)).rejects.toThrow('Service offline');
  });
});

describe('getEvent — handler passes include to service', () => {
  let mockService: { getEvent: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getEvent: vi.fn().mockResolvedValue(baseEvent) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('passes include=links,media,documents to service', async () => {
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({
      event_id: 'ocd-event/evt-1',
      include: ['links', 'media', 'documents'],
    });
    await getEvent.handler(input, ctx);
    expect(mockService.getEvent).toHaveBeenCalledWith(
      'ocd-event/evt-1',
      ['links', 'media', 'documents'],
      expect.anything(),
    );
  });

  it('passes undefined include to service when include is empty array', async () => {
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: [] });
    await getEvent.handler(input, ctx);
    expect(mockService.getEvent).toHaveBeenCalledWith(
      'ocd-event/evt-1',
      undefined,
      expect.anything(),
    );
  });
});

describe('getEvent — handler result shape', () => {
  let mockService: { getEvent: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getEvent: vi.fn() };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('includes location when service returns it', async () => {
    mockService.getEvent.mockResolvedValue({
      ...baseEvent,
      location: { name: "John L. O'Brien Building", url: 'https://leg.wa.gov/rooms' },
    });
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1' });
    const result = await getEvent.handler(input, ctx);
    expect(result.location).toBeDefined();
    expect(result.location?.name).toBe("John L. O'Brien Building");
    expect(result.location?.url).toBe('https://leg.wa.gov/rooms');
  });

  it('omits location from result when service omits it', async () => {
    mockService.getEvent.mockResolvedValue({ ...baseEvent });
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1' });
    const result = await getEvent.handler(input, ctx);
    expect(result.location).toBeUndefined();
  });

  it('includes links when service returns them', async () => {
    mockService.getEvent.mockResolvedValue({
      ...baseEvent,
      links: [{ note: 'Agenda PDF', url: 'https://leg.wa.gov/agenda.pdf' }],
    });
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['links'] });
    const result = await getEvent.handler(input, ctx);
    expect(result.links).toBeDefined();
    expect(result.links?.[0]?.url).toBe('https://leg.wa.gov/agenda.pdf');
  });

  it('includes media when service returns it', async () => {
    mockService.getEvent.mockResolvedValue({
      ...baseEvent,
      media: [
        {
          note: 'Video recording',
          date: '',
          classification: '',
          links: [{ url: 'https://tvw.org/video/12345' }],
        },
      ],
    });
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['media'] });
    const result = await getEvent.handler(input, ctx);
    expect(result.media).toBeDefined();
    expect(result.media?.[0]?.links[0]?.url).toBe('https://tvw.org/video/12345');
  });

  it('includes documents when service returns them', async () => {
    mockService.getEvent.mockResolvedValue({
      ...baseEvent,
      documents: [
        {
          note: 'Fiscal note',
          date: '',
          classification: '',
          links: [{ url: 'https://leg.wa.gov/fiscal.pdf' }],
        },
      ],
    });
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['documents'] });
    const result = await getEvent.handler(input, ctx);
    expect(result.documents).toBeDefined();
    expect(result.documents?.[0]?.note).toBe('Fiscal note');
  });
});

describe('getEvent — format', () => {
  it('formats location with url', () => {
    const result = {
      ...baseEvent,
      location: { name: 'Committee Room A', url: 'https://leg.wa.gov/room-a' },
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0]! as { text: string }).text;
    expect(readBack(text)[1]).toMatch(/\nLocation: Committee Room A$/);
    expect(links(text)).toEqual([{ href: 'https://leg.wa.gov/room-a', label: 'Committee Room A' }]);
  });

  it('labels a location link with its URL when the location has no name', () => {
    const blocks = getEvent.format!({
      ...baseEvent,
      location: { name: '', url: 'https://leg.wa.gov/room-a' },
    });
    const text = (blocks[0]! as { text: string }).text;
    expect(links(text)).toEqual([
      { href: 'https://leg.wa.gov/room-a', label: 'https://leg.wa.gov/room-a' },
    ]);
  });

  it('formats location without url', () => {
    const result = {
      ...baseEvent,
      location: { name: 'Committee Room B' },
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Committee Room B');
    expect(text).toContain('Location:');
    // No stray undefined in output
    expect(text).not.toContain('undefined');
  });

  it('formats links when present', () => {
    const result = {
      ...baseEvent,
      links: [{ note: 'Agenda', url: 'https://leg.wa.gov/agenda.pdf' }],
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0]! as { text: string }).text;
    expect(readBack(text)).toContain('Links');
    expect(links(text)).toEqual([{ href: 'https://leg.wa.gov/agenda.pdf', label: 'Agenda' }]);
  });

  it('formats media when present', () => {
    const result = {
      ...baseEvent,
      media: [
        {
          note: 'Video',
          date: '',
          classification: '',
          links: [{ url: 'https://tvw.org/video/99' }],
        },
      ],
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0]! as { text: string }).text;
    expect(readBack(text)).toContain('Media');
    expect(links(text)).toEqual([{ href: 'https://tvw.org/video/99', label: 'Video' }]);
  });

  it('formats documents when present', () => {
    const result = {
      ...baseEvent,
      documents: [
        {
          note: 'Fiscal Note',
          date: '',
          classification: '',
          links: [{ url: 'https://leg.wa.gov/fiscal.pdf' }],
        },
      ],
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0]! as { text: string }).text;
    expect(readBack(text)).toContain('Documents');
    expect(links(text)).toEqual([{ href: 'https://leg.wa.gov/fiscal.pdf', label: 'Fiscal Note' }]);
  });

  it('formats start date without end_date when end_date is absent', () => {
    const result = {
      ...baseEvent,
      end_date: undefined,
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Start:');
    expect(text).not.toContain('End:');
  });

  it('formats start and end date when both present', () => {
    const blocks = getEvent.format!(baseEvent);
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Start:');
    expect(text).toContain('End:');
    expect(text).toContain('2025-03-15T09:00:00');
    expect(text).toContain('2025-03-15T12:00:00');
  });

  it('rejects empty event_id', () => {
    expect(() => getEvent.input.parse({ event_id: '' })).toThrow();
  });
});

/**
 * Regression coverage for the include-enrichment data loss (issue #18). get_event advertises
 * `sources` via `include` (links/media/documents already surfaced), but the handler rebuilds its
 * return object field-by-field and never copied `sources`, and the output schema declared no
 * field for it — so both the structuredContent and content[] paths lost it. Driving through the
 * handler proves the rebuild now carries it. Fixture shape mirrors Event.sources ({ url, note }).
 */
describe('getEvent — sources include surfacing (issue #18)', () => {
  let mockService: { getEvent: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getEvent: vi.fn() };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  const enrichedEvent = {
    ...baseEvent,
    sources: [{ url: 'https://leg.ca.gov/event-source', note: 'official calendar' }],
  };

  it('carries sources through the handler rebuild and output schema', async () => {
    mockService.getEvent.mockResolvedValue(enrichedEvent);
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['sources'] });
    const handlerResult = await getEvent.handler(input, ctx);
    const event = getEvent.output.parse(handlerResult);
    expect(event.sources).toEqual([
      { url: 'https://leg.ca.gov/event-source', note: 'official calendar' },
    ]);
  });

  it('renders sources in format() text', () => {
    const blocks = getEvent.format!(enrichedEvent);
    const text = (blocks[0]! as { text: string }).text;
    expect(readBack(text)).toContain('Sources');
    expect(links(text)).toEqual([
      { href: 'https://leg.ca.gov/event-source', label: 'official calendar' },
    ]);
  });
});

/**
 * Regression coverage for participant role sparsity (issue #19). Open States omits `role` on some
 * participants; the output schema required a string, so a valid fetch converted into a
 * serialization error, and format() printed the literal "undefined". Pre-fix, the handler maps
 * `role: undefined` for the role-less participant and output.parse rejects it; format() emits
 * "undefined".
 */
describe('getEvent — participant without upstream role (issue #19)', () => {
  let mockService: { getEvent: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getEvent: vi.fn() };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  const eventRolelessParticipant = {
    ...baseEvent,
    participants: [
      { name: 'Committee on Transportation', entity_type: 'organization', role: 'host' },
      { name: 'Jane Doe', entity_type: 'person' },
    ],
  };

  it('accepts a role-less participant through the handler and output schema', async () => {
    mockService.getEvent.mockResolvedValue(eventRolelessParticipant);
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['participants'] });
    const handlerResult = await getEvent.handler(input, ctx);
    const event = getEvent.output.parse(handlerResult);
    expect(event.participants).toHaveLength(2);
    expect(event.participants?.[0]?.role).toBe('host');
    expect(event.participants?.[1]?.role).toBeUndefined();
  });

  it('renders a role-less participant without printing "undefined"', () => {
    const blocks = getEvent.format!(eventRolelessParticipant);
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Jane Doe');
    expect(text).not.toContain('undefined');
  });
});

/**
 * Links, media, and documents all render one-per-line, each URL labeled by its note. Open States
 * often supplies an empty `note`, which put a dangling separator in front of every URL on the
 * `content[]` path. `structuredContent` keeps `note: ""` — it is the accurate upstream value.
 */
describe('getEvent — link, media, and document rendering with an empty note', () => {
  const render = (event: Record<string, unknown>) =>
    (getEvent.format!({ ...baseEvent, ...event })[0]! as { text: string }).text;

  it('renders each URL alone when the note is empty', () => {
    const urls = [
      'https://leg.example.gov/hearing',
      'https://tvw.example.org/clip',
      'https://leg.example.gov/agenda.pdf',
      'https://leg.example.gov/src',
    ];
    const text = render({
      links: [{ url: urls[0], note: '' }],
      media: [{ note: '', date: '', classification: '', links: [{ url: urls[1] }] }],
      documents: [{ note: '', date: '', classification: '', links: [{ url: urls[2] }] }],
      sources: [{ url: urls[3], note: '' }],
    });
    for (const url of urls) expect(readBack(text)).toContain(url);
    expect(links(text)).toEqual(urls.map((url) => ({ href: url, label: url })));
    expect(inlineTypes(text).has('em_open')).toBe(false);
  });

  it('still labels each list when the note is present', () => {
    const text = render({
      links: [{ url: 'https://leg.example.gov/hearing', note: 'hearing notice' }],
      media: [
        {
          note: 'video',
          date: '',
          classification: '',
          links: [{ url: 'https://tvw.example.org/clip' }],
        },
      ],
      documents: [
        {
          note: 'agenda',
          date: '',
          classification: '',
          links: [{ url: 'https://leg.example.gov/agenda.pdf' }],
        },
      ],
    });
    expect(links(text)).toEqual([
      { href: 'https://leg.example.gov/hearing', label: 'hearing notice' },
      { href: 'https://tvw.example.org/clip', label: 'video' },
      { href: 'https://leg.example.gov/agenda.pdf', label: 'agenda' },
    ]);
  });
});

/**
 * Markdown fidelity (#53): every upstream string `format()` renders reads back exactly from a
 * CommonMark parse, and every URL field renders as one link. The sweep sets one string leaf of a
 * fully populated record at a time to each hostile class and checks the whole rendered document.
 */
describe('getEvent — Markdown fidelity (#53)', () => {
  const full = {
    ...baseEvent,
    location: { name: 'Senate Hearing Room 1', url: 'https://leg.example.gov/room' },
    links: [{ url: 'https://leg.example.gov/link', note: 'hearing notice' }],
    // Media exercises the record note standing in as a link label; documents, a lead note
    // before links that carry their own (#59).
    media: [
      {
        note: 'video',
        date: '2025-03-15',
        classification: 'recording',
        offset: 30,
        links: [
          { url: 'https://tvw.example.org/clip', note: 'MP4' },
          { url: 'https://tvw.example.org/clip-2' },
        ],
      },
    ],
    documents: [
      {
        note: 'agenda',
        date: '2025-03-14',
        classification: 'agenda',
        links: [{ url: 'https://leg.example.gov/agenda.pdf', note: 'PDF' }],
      },
    ],
    sources: [{ url: 'https://leg.example.gov/src', note: 'official calendar' }],
    participants: [
      { name: 'Committee on Transportation', entity_type: 'organization', role: 'host' },
    ],
    agenda: [
      {
        description: 'HB 1000 hearing',
        classification: ['bill'],
        subjects: ['public safety'],
        related_entities: [{ name: 'HB 1000', entity_type: 'bill' }],
      },
    ],
  };
  const fullHrefs = [
    'https://leg.example.gov/room',
    'https://leg.example.gov/link',
    'https://tvw.example.org/clip',
    'https://tvw.example.org/clip-2',
    'https://leg.example.gov/agenda.pdf',
    'https://leg.example.gov/src',
  ];
  const render = (event: unknown) =>
    (getEvent.format!(getEvent.output.parse(event))[0]! as { text: string }).text;

  it.each(Object.entries(HOSTILE))('reads back %s in every rendered string field', (_, payload) => {
    const fields = leaves(full, false);
    expect(fields).toHaveLength(28);
    for (const path of fields) {
      // A line break cannot ride an ATX heading — out of scope for heading-slot values.
      if (path[0] === 'name' && payload.includes('\n')) continue;
      const text = render(withLeaf(full, path, payload));
      const where = path.join('.');
      expect(readBack(text).join('\n'), where).toContain(payload);
      expect(
        links(text).map((l) => l.href),
        where,
      ).toEqual(fullHrefs);
      expect(
        [...inlineTypes(text)].filter((t) => !AUTHORED_INLINE.has(t)),
        where,
      ).toEqual([]);
    }
  });

  it.each([
    'https://leg.example.gov/a b',
    'https://leg.example.gov/p_(x)*y*',
    'https://leg.example.gov/q?a=<1>&b=[2]',
    'https://leg.example.gov/r?x=1&amp;y=2',
  ])('renders each URL field as one link to %s', (url) => {
    const fields = leaves(full, true);
    expect(fields).toHaveLength(6);
    for (const path of fields) {
      const found = links(render(withLeaf(full, path, url)));
      expect(found, path.join('.')).toHaveLength(6);
      expect(
        found.filter((l) => l.href === normalizeLink(url)),
        path.join('.'),
      ).toHaveLength(1);
    }
  });

  it('renders a non-http(s) URL as literal text with no link token', () => {
    for (const path of leaves(full, true)) {
      const text = render(withLeaf(full, path, 'javascript:alert(1)'));
      expect(links(text), path.join('.')).toHaveLength(5);
      expect(readBack(text).join('\n'), path.join('.')).toContain('javascript:alert(1)');
    }
  });

  /** Real-shaped values pass through the encoders unchanged — pinned against the pre-#53 text. */
  it('renders real-shaped identifiers byte-identical', () => {
    expect(
      render({
        ...baseEvent,
        id: 'ocd-event/2f3e4d5c-6b7a-8c9d-0e1f-2a3b4c5d6e7f',
        start_date: '2025-03-15T09:00:00+00:00',
        end_date: '2025-03-15T12:00:00Z',
        location: { name: 'Senate Hearing Room 1' },
        participants: [...full.participants, { name: 'Jane Doe', entity_type: 'person' }],
        agenda: [
          {
            description: 'HB 1000',
            classification: ['bill', 'hearing'],
            subjects: ['public safety'],
            related_entities: [{ name: 'HB 1000', entity_type: 'bill' }],
          },
        ],
      }),
    ).toBe(
      '# Transportation Committee Hearing\n**ID:** ocd-event/2f3e4d5c-6b7a-8c9d-0e1f-2a3b4c5d6e7f\n**Classification:** committee-meeting | **Status:** passed\n**Start:** 2025-03-15T09:00:00+00:00 | **End:** 2025-03-15T12:00:00Z\n**Jurisdiction:** Washington (ocd-jurisdiction/country:us/state:wa/government)\nPublic hearing on HB 1000\n**Location:** Senate Hearing Room 1\n\n## Participants\n- Committee on Transportation (host) — organization\n- Jane Doe — person\n\n## Agenda\n- HB 1000\n  Classification: bill, hearing\n  Subjects: public safety\n  Related: HB 1000 (bill)',
    );
  });
});
