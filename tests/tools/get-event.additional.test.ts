/**
 * @fileoverview Additional coverage for getEvent: not_found re-throw,
 * location rendering, links, media, documents, and edge cases.
 * @module tests/tools/get-event.additional.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEvent } from '@/mcp-server/tools/definitions/get-event.tool.js';

vi.mock('@/services/openstates/openstates-service.js', () => ({
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
    const ctx = createMockContext();
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
    const ctx = createMockContext();
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
    const ctx = createMockContext();
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1' });
    const result = await getEvent.handler(input, ctx);
    expect(result.location).toBeDefined();
    expect(result.location?.name).toBe("John L. O'Brien Building");
    expect(result.location?.url).toBe('https://leg.wa.gov/rooms');
  });

  it('omits location from result when service omits it', async () => {
    mockService.getEvent.mockResolvedValue({ ...baseEvent });
    const ctx = createMockContext();
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1' });
    const result = await getEvent.handler(input, ctx);
    expect(result.location).toBeUndefined();
  });

  it('includes links when service returns them', async () => {
    mockService.getEvent.mockResolvedValue({
      ...baseEvent,
      links: [{ note: 'Agenda PDF', url: 'https://leg.wa.gov/agenda.pdf' }],
    });
    const ctx = createMockContext();
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['links'] });
    const result = await getEvent.handler(input, ctx);
    expect(result.links).toBeDefined();
    expect(result.links?.[0].url).toBe('https://leg.wa.gov/agenda.pdf');
  });

  it('includes media when service returns it', async () => {
    mockService.getEvent.mockResolvedValue({
      ...baseEvent,
      media: [{ note: 'Video recording', url: 'https://tvw.org/video/12345' }],
    });
    const ctx = createMockContext();
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['media'] });
    const result = await getEvent.handler(input, ctx);
    expect(result.media).toBeDefined();
    expect(result.media?.[0].url).toBe('https://tvw.org/video/12345');
  });

  it('includes documents when service returns them', async () => {
    mockService.getEvent.mockResolvedValue({
      ...baseEvent,
      documents: [{ note: 'Fiscal note', url: 'https://leg.wa.gov/fiscal.pdf' }],
    });
    const ctx = createMockContext();
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['documents'] });
    const result = await getEvent.handler(input, ctx);
    expect(result.documents).toBeDefined();
    expect(result.documents?.[0].note).toBe('Fiscal note');
  });
});

describe('getEvent — format', () => {
  it('formats location with url', () => {
    const result = {
      ...baseEvent,
      location: { name: 'Committee Room A', url: 'https://leg.wa.gov/room-a' },
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Committee Room A');
    expect(text).toContain('https://leg.wa.gov/room-a');
    expect(text).toContain('Location:');
  });

  it('formats location without url', () => {
    const result = {
      ...baseEvent,
      location: { name: 'Committee Room B' },
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0] as { text: string }).text;
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
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Links');
    expect(text).toContain('Agenda');
    expect(text).toContain('https://leg.wa.gov/agenda.pdf');
  });

  it('formats media when present', () => {
    const result = {
      ...baseEvent,
      media: [{ note: 'Video', url: 'https://tvw.org/video/99' }],
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Media');
    expect(text).toContain('Video');
    expect(text).toContain('https://tvw.org/video/99');
  });

  it('formats documents when present', () => {
    const result = {
      ...baseEvent,
      documents: [{ note: 'Fiscal Note', url: 'https://leg.wa.gov/fiscal.pdf' }],
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Documents');
    expect(text).toContain('Fiscal Note');
    expect(text).toContain('https://leg.wa.gov/fiscal.pdf');
  });

  it('formats start date without end_date when end_date is absent', () => {
    const result = {
      ...baseEvent,
      end_date: undefined,
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Start:');
    expect(text).not.toContain('End:');
  });

  it('formats start and end date when both present', () => {
    const blocks = getEvent.format!(baseEvent);
    const text = (blocks[0] as { text: string }).text;
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
    const ctx = createMockContext();
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['sources'] });
    const handlerResult = await getEvent.handler(input, ctx);
    const event = getEvent.output.parse(handlerResult);
    expect(event.sources).toEqual([
      { url: 'https://leg.ca.gov/event-source', note: 'official calendar' },
    ]);
  });

  it('renders sources in format() text', () => {
    const blocks = getEvent.format!(enrichedEvent);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Sources');
    expect(text).toContain('https://leg.ca.gov/event-source');
    expect(text).toContain('official calendar');
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
    const ctx = createMockContext();
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['participants'] });
    const handlerResult = await getEvent.handler(input, ctx);
    const event = getEvent.output.parse(handlerResult);
    expect(event.participants).toHaveLength(2);
    expect(event.participants?.[0].role).toBe('host');
    expect(event.participants?.[1].role).toBeUndefined();
  });

  it('renders a role-less participant without printing "undefined"', () => {
    const blocks = getEvent.format!(eventRolelessParticipant);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Jane Doe');
    expect(text).not.toContain('undefined');
  });
});

/**
 * Links, media, and documents all render one-per-line as `- ${note}: ${url}`. Open States often
 * supplies an empty `note`, which put a dangling separator in front of every URL on the
 * `content[]` path. `structuredContent` keeps `note: ""` — it is the accurate upstream value.
 */
describe('getEvent — link, media, and document rendering with an empty note', () => {
  const render = (event: Record<string, unknown>) =>
    (getEvent.format!({ ...baseEvent, ...event })[0] as { text: string }).text;

  it('renders each URL alone when the note is empty', () => {
    const text = render({
      links: [{ url: 'https://leg.example.gov/hearing', note: '' }],
      media: [{ url: 'https://tvw.example.org/clip', note: '' }],
      documents: [{ url: 'https://leg.example.gov/agenda.pdf', note: '' }],
    });
    expect(text).toContain('- https://leg.example.gov/hearing');
    expect(text).toContain('- https://tvw.example.org/clip');
    expect(text).toContain('- https://leg.example.gov/agenda.pdf');
    expect(text).not.toContain(': https://leg.example.gov/hearing');
    expect(text).not.toContain(': https://tvw.example.org/clip');
    expect(text).not.toContain(': https://leg.example.gov/agenda.pdf');
  });

  it('still labels each list when the note is present', () => {
    const text = render({
      links: [{ url: 'https://leg.example.gov/hearing', note: 'hearing notice' }],
      media: [{ url: 'https://tvw.example.org/clip', note: 'video' }],
      documents: [{ url: 'https://leg.example.gov/agenda.pdf', note: 'agenda' }],
    });
    expect(text).toContain('- hearing notice: https://leg.example.gov/hearing');
    expect(text).toContain('- video: https://tvw.example.org/clip');
    expect(text).toContain('- agenda: https://leg.example.gov/agenda.pdf');
  });
});
