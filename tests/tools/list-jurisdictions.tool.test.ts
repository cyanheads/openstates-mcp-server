/**
 * @fileoverview Tests for the listJurisdictions tool.
 * @module tests/tools/list-jurisdictions.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listJurisdictions } from '@/mcp-server/tools/definitions/list-jurisdictions.tool.js';

vi.mock('@/services/openstates/openstates-service.js', () => ({
  getOpenStatesApiService: vi.fn(),
}));

const mockJurisdictionResult = {
  results: [
    {
      id: 'ocd-jurisdiction/country:us/state:wa/government',
      name: 'Washington',
      classification: 'government',
      url: 'https://leg.wa.gov',
      latest_bill_update: '2025-05-20T10:00:00Z',
      latest_people_update: '2025-05-19T08:00:00Z',
    },
  ],
  pagination: { page: 1, per_page: 52, max_page: 1, total_items: 1 },
};

describe('listJurisdictions', () => {
  let mockService: { listJurisdictions: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { listJurisdictions: vi.fn().mockResolvedValue(mockJurisdictionResult) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns jurisdictions with default state classification', async () => {
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({});
    const result = await listJurisdictions.handler(input, ctx);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('ocd-jurisdiction/country:us/state:wa/government');
    expect(result.results[0].name).toBe('Washington');
    expect(result.pagination.total_items).toBe(1);
  });

  it('passes include param when provided', async () => {
    const ctx = createMockContext();
    const withSessions = {
      ...mockJurisdictionResult,
      results: [
        {
          ...mockJurisdictionResult.results[0],
          legislative_sessions: [
            {
              identifier: '2025',
              name: '2025 Regular Session',
              classification: 'primary',
              start_date: '2025-01-13',
              end_date: '2025-04-27',
            },
          ],
        },
      ],
    };
    mockService.listJurisdictions.mockResolvedValue(withSessions);

    const input = listJurisdictions.input.parse({ include: ['legislative_sessions'] });
    const result = await listJurisdictions.handler(input, ctx);
    expect(result.results[0].legislative_sessions).toBeDefined();
    expect(result.results[0].legislative_sessions?.[0].identifier).toBe('2025');
  });

  it('formats output with jurisdiction id, name, and url', () => {
    const result = {
      results: mockJurisdictionResult.results,
      pagination: mockJurisdictionResult.pagination,
    };
    const blocks = listJurisdictions.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Washington');
    expect(text).toContain('ocd-jurisdiction/country:us/state:wa/government');
    expect(text).toContain('https://leg.wa.gov');
    expect(text).toContain('1 jurisdictions');
  });

  it('renders session identifiers in format when included', () => {
    const result = {
      results: [
        {
          ...mockJurisdictionResult.results[0],
          legislative_sessions: [
            {
              identifier: '2025',
              name: '2025 Regular Session',
              classification: 'primary',
              start_date: '2025-01-13',
              end_date: '2025-04-27',
            },
          ],
        },
      ],
      pagination: mockJurisdictionResult.pagination,
    };
    const blocks = listJurisdictions.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('2025');
    expect(text).toContain('2025 Regular Session');
  });
});
