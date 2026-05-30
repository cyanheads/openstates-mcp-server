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
