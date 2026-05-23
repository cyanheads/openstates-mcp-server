/**
 * @fileoverview Tests for the jurisdictionResource resource.
 * @module tests/resources/jurisdiction.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jurisdictionResource } from '@/mcp-server/resources/definitions/jurisdiction.resource.js';

vi.mock('@/services/openstates/openstates-service.js', () => ({
  getOpenStatesApiService: vi.fn(),
}));

const mockJurisdiction = {
  id: 'ocd-jurisdiction/country:us/state:wa/government',
  name: 'Washington',
  classification: 'government',
  url: 'https://leg.wa.gov',
  latest_bill_update: '2025-05-20T10:00:00Z',
  latest_people_update: '2025-05-19T08:00:00Z',
  legislative_sessions: [
    {
      identifier: '2025',
      name: '2025 Regular Session',
      classification: 'primary',
      start_date: '2025-01-13',
      end_date: '2025-04-27',
    },
  ],
};

describe('jurisdictionResource', () => {
  let mockService: { getJurisdiction: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getJurisdiction: vi.fn().mockResolvedValue(mockJurisdiction) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns jurisdiction data for a valid abbreviation', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = jurisdictionResource.params.parse({ jurisdiction_id: 'wa' });
    const result = await jurisdictionResource.handler(params, ctx);
    expect(result).toBeDefined();
    expect((result as typeof mockJurisdiction).id).toBe(
      'ocd-jurisdiction/country:us/state:wa/government',
    );
    expect((result as typeof mockJurisdiction).name).toBe('Washington');
  });

  it('always requests legislative_sessions include', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = jurisdictionResource.params.parse({ jurisdiction_id: 'wa' });
    await jurisdictionResource.handler(params, ctx);
    expect(mockService.getJurisdiction).toHaveBeenCalledWith(
      'wa',
      ['legislative_sessions'],
      expect.anything(),
    );
  });

  it('throws when service returns a falsy jurisdiction', async () => {
    // The service should normally return a valid object; a null/undefined indicates
    // a "not found" — simulate it here to verify the guard path
    mockService.getJurisdiction.mockResolvedValue(null);
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = jurisdictionResource.params.parse({ jurisdiction_id: 'xx' });
    await expect(jurisdictionResource.handler(params, ctx)).rejects.toThrow();
  });

  it('propagates network errors from service', async () => {
    mockService.getJurisdiction.mockRejectedValue(new Error('Service unavailable'));
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = jurisdictionResource.params.parse({ jurisdiction_id: 'wa' });
    await expect(jurisdictionResource.handler(params, ctx)).rejects.toThrow('Service unavailable');
  });

  it('lists sample resources from list()', async () => {
    const listing = await jurisdictionResource.list!();
    expect(listing.resources).toBeInstanceOf(Array);
    expect(listing.resources.length).toBeGreaterThan(0);
    for (const r of listing.resources) {
      expect(r).toHaveProperty('uri');
      expect(r).toHaveProperty('name');
      expect(r.uri).toMatch(/^openstates:\/\/jurisdiction\//);
    }
  });
});
