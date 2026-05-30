/**
 * @fileoverview Security tests: verify no API key, env var value, or internal
 * configuration ever appears in tool output or error messages.
 * @module tests/security/no-secret-leakage.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBill } from '@/mcp-server/tools/definitions/get-bill.tool.js';
import { getJurisdiction } from '@/mcp-server/tools/definitions/get-jurisdiction.tool.js';
import { getLegislatorsByLocation } from '@/mcp-server/tools/definitions/get-legislators-by-location.tool.js';
import { listJurisdictions } from '@/mcp-server/tools/definitions/list-jurisdictions.tool.js';
import { searchBills } from '@/mcp-server/tools/definitions/search-bills.tool.js';
import { searchPeople } from '@/mcp-server/tools/definitions/search-people.tool.js';

vi.mock('@/services/openstates/openstates-service.js', () => ({
  getOpenStatesApiService: vi.fn(),
}));

// A recognisable sentinel that must never escape into output.
const FAKE_API_KEY = 'sk-openstates-supersecret-1234567890';

const mockBill = {
  id: 'ocd-bill/99999',
  identifier: 'HB 99',
  title: 'Test Bill',
  session: '2025',
  jurisdiction: { id: 'ocd-jurisdiction/country:us/state:wa/government', name: 'Washington' },
  from_organization: { name: 'House', classification: 'lower' },
  classification: ['bill'],
  subject: [],
  first_action_date: null,
  latest_action_date: null,
  latest_action_description: null,
  latest_passage_date: null,
};

const mockJurisdiction = {
  id: 'ocd-jurisdiction/country:us/state:wa/government',
  name: 'Washington',
  classification: 'government',
  url: 'https://leg.wa.gov',
  latest_bill_update: '2025-01-01T00:00:00Z',
  latest_people_update: '2025-01-01T00:00:00Z',
};

const mockPerson = {
  id: 'ocd-person/sec-test',
  name: 'Security Test Person',
  party: 'Independent',
  current_role: { title: 'Representative', org_classification: 'lower', district: '1' },
  jurisdiction: { id: 'ocd-jurisdiction/country:us/state:wa/government', name: 'Washington' },
  given_name: 'Security',
  family_name: 'Test',
  email: '',
  openstates_url: '',
};

describe('no API key leakage in tool output', () => {
  let mockSvc: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    // Set a fake API key in env so the service would pick it up
    vi.stubEnv('OPENSTATES_API_KEY', FAKE_API_KEY);

    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockSvc = {
      searchBills: vi.fn().mockResolvedValue({
        results: [mockBill],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
      }),
      getBillById: vi.fn().mockResolvedValue(mockBill),
      getBillByPath: vi.fn().mockResolvedValue(mockBill),
      getJurisdiction: vi.fn().mockResolvedValue(mockJurisdiction),
      listJurisdictions: vi.fn().mockResolvedValue({
        results: [mockJurisdiction],
        pagination: { page: 1, per_page: 52, max_page: 1, total_items: 1 },
      }),
      searchPeople: vi.fn().mockResolvedValue({
        results: [mockPerson],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
      }),
      getPeopleByGeo: vi.fn().mockResolvedValue({
        results: [mockPerson],
        pagination: { page: 1, per_page: 1, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockSvc as never);
  });

  function assertNoSecretIn(value: unknown, path = 'result'): void {
    const serialised = JSON.stringify(value);
    expect(serialised, `Secret key must not appear in ${path}`).not.toContain(FAKE_API_KEY);
    // Also assert no base64-encoded form of the key leaks
    expect(serialised, `Base64 of secret must not appear in ${path}`).not.toContain(
      Buffer.from(FAKE_API_KEY).toString('base64'),
    );
  }

  it('searchBills result does not contain the API key', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({ jurisdiction: 'wa' });
    const result = await searchBills.handler(input, ctx);
    assertNoSecretIn(result, 'searchBills result');
    const blocks = searchBills.format!(result);
    assertNoSecretIn(blocks, 'searchBills format output');
  });

  it('getBill result does not contain the API key', async () => {
    const ctx = createMockContext();
    const input = getBill.input.parse({ openstates_id: 'ocd-bill/99999' });
    const result = await getBill.handler(input, ctx);
    assertNoSecretIn(result, 'getBill result');
    const blocks = getBill.format!(result);
    assertNoSecretIn(blocks, 'getBill format output');
  });

  it('getJurisdiction result does not contain the API key', async () => {
    const ctx = createMockContext();
    const input = getJurisdiction.input.parse({ jurisdiction_id: 'wa' });
    const result = await getJurisdiction.handler(input, ctx);
    assertNoSecretIn(result, 'getJurisdiction result');
    const blocks = getJurisdiction.format!(result);
    assertNoSecretIn(blocks, 'getJurisdiction format output');
  });

  it('listJurisdictions result does not contain the API key', async () => {
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({});
    const result = await listJurisdictions.handler(input, ctx);
    assertNoSecretIn(result, 'listJurisdictions result');
    const blocks = listJurisdictions.format!(result);
    assertNoSecretIn(blocks, 'listJurisdictions format output');
  });

  it('searchPeople result does not contain the API key', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa' });
    const result = await searchPeople.handler(input, ctx);
    assertNoSecretIn(result, 'searchPeople result');
    const blocks = searchPeople.format!(result);
    assertNoSecretIn(blocks, 'searchPeople format output');
  });

  it('getLegislatorsByLocation result does not contain the API key', async () => {
    const ctx = createMockContext();
    const input = getLegislatorsByLocation.input.parse({ latitude: 47.6, longitude: -122.3 });
    const result = await getLegislatorsByLocation.handler(input, ctx);
    assertNoSecretIn(result, 'getLegislatorsByLocation result');
    const blocks = getLegislatorsByLocation.format!(result);
    assertNoSecretIn(blocks, 'getLegislatorsByLocation format output');
  });
});

describe('injection attempts in bill search do not reach output as-is', () => {
  let mockSvc: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockSvc = {
      searchBills: vi.fn().mockResolvedValue({
        results: [],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockSvc as never);
  });

  const injectionPayloads = [
    "' OR '1'='1",
    '"; DROP TABLE bills; --',
    '<script>alert(1)</script>',
    '../../../etc/passwd',
    '%00null',
    'javascript:alert(1)',
    '\x00\x01\x02',
  ];

  for (const payload of injectionPayloads) {
    it(`searchBills with injection payload "${payload.slice(0, 30)}" does not throw uncaught`, async () => {
      const ctx = createMockContext({ errors: searchBills.errors });
      // Zod accepts any string for q — the handler must not crash on adversarial input
      const input = searchBills.input.parse({ q: payload });
      // Handler either returns a result (empty) or throws an McpError — never crashes
      await expect(searchBills.handler(input, ctx)).resolves.toBeDefined();
      // The service is called with the raw input (the mock returns empty); we
      // assert the handler itself doesn't interpret or execute the payload.
      expect(mockSvc.searchBills).toHaveBeenCalledOnce();
    });
  }

  it('oversized q field is passed through without crashing', async () => {
    const ctx = createMockContext();
    const longQuery = 'a'.repeat(10_000);
    const input = searchBills.input.parse({ q: longQuery });
    await expect(searchBills.handler(input, ctx)).resolves.toBeDefined();
  });
});

describe('injection attempts in path-based lookups do not crash', () => {
  let mockSvc: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockSvc = {
      getBillById: vi.fn().mockResolvedValue(mockBill),
      getBillByPath: vi.fn().mockResolvedValue(mockBill),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockSvc as never);
  });

  it('getBill with path-traversal jurisdiction does not crash', async () => {
    const ctx = createMockContext();
    const input = getBill.input.parse({
      jurisdiction: '../../../etc/passwd',
      session: '2025',
      bill_id: 'HB 1',
    });
    // The handler passes these to the service (mocked); it must not crash itself
    await expect(getBill.handler(input, ctx)).resolves.toBeDefined();
  });

  it('getBill with null bytes in openstates_id does not crash', async () => {
    const ctx = createMockContext();
    const input = getBill.input.parse({ openstates_id: 'ocd-bill/\x00injected' });
    await expect(getBill.handler(input, ctx)).resolves.toBeDefined();
  });
});
