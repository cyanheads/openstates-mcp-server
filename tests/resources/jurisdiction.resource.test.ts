/**
 * @fileoverview Tests for the jurisdictionResource resource.
 * @module tests/resources/jurisdiction.resource.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jurisdictionResource } from '@/mcp-server/resources/definitions/jurisdiction.resource.js';

vi.mock('@/services/openstates/openstates-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/openstates/openstates-service.js')>()),
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

  it('rethrows a service NotFound as a typed not-found error with the invalid id and recovery', async () => {
    // The real not-found path is a rejected McpError (upstream 404 → NotFound), never a
    // resolved null — the service's fetchJson only ever throws on a non-OK response. The
    // resource must translate that into its own typed error, mirroring openstates_get_jurisdiction.
    mockService.getJurisdiction.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'OpenStates returned HTTP 404 Not Found.', {
        url: 'https://v3.openstates.org/jurisdictions/not-a-real-jurisdiction',
      }),
    );
    const ctx = createMockContext({ errors: jurisdictionResource.errors });
    const params = jurisdictionResource.params.parse({
      jurisdiction_id: 'not-a-real-jurisdiction',
    });
    await expect(jurisdictionResource.handler(params, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      message: 'Jurisdiction not found: not-a-real-jurisdiction',
      data: {
        reason: 'not_found',
        recovery: { hint: expect.stringContaining('openstates_list_jurisdictions') },
      },
    });
  });

  it('propagates a non-NotFound service error without wrapping it as not_found', async () => {
    // Regression guard: only a NotFound is translated; every other upstream failure bubbles
    // up unchanged so the caller sees the real cause (a wrapped ServiceUnavailable would flip
    // the code to NotFound and fail this assertion).
    mockService.getJurisdiction.mockRejectedValue(
      new McpError(JsonRpcErrorCode.ServiceUnavailable, 'Open States API unavailable.'),
    );
    const ctx = createMockContext({ errors: jurisdictionResource.errors });
    const params = jurisdictionResource.params.parse({ jurisdiction_id: 'wa' });
    await expect(jurisdictionResource.handler(params, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
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
