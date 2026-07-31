/**
 * @fileoverview Additional coverage for searchBills: pagination boundaries,
 * sort values, filter combinations, and edge cases in format.
 * @module tests/tools/search-bills.additional.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchBills } from '@/mcp-server/tools/definitions/search-bills.tool.js';

vi.mock('@/services/openstates/openstates-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/openstates/openstates-service.js')>()),
  getOpenStatesApiService: vi.fn(),
}));

const mockBill = {
  id: 'ocd-bill/12345',
  identifier: 'HB 1000',
  title: 'An act relating to public safety',
  session: '2025',
  jurisdiction: {
    id: 'ocd-jurisdiction/country:us/state:wa/government',
    name: 'Washington',
  },
  from_organization: { name: 'House', classification: 'lower' },
  classification: ['bill'],
  subject: ['public safety'],
  first_action_date: '2025-01-14',
  latest_action_date: '2025-03-10',
  latest_action_description: 'Passed Senate',
  latest_passage_date: '2025-03-10',
};

describe('searchBills — pagination and filters', () => {
  let mockService: { searchBills: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      searchBills: vi.fn().mockResolvedValue({
        results: [mockBill],
        pagination: { page: 2, per_page: 5, max_page: 10, total_items: 50 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('passes page and per_page to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({ jurisdiction: 'wa', page: 2, per_page: 5 });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, per_page: 5 }),
      expect.anything(),
    );
  });

  it('enrichment reflects multi-page response', async () => {
    const { getEnrichment } = await import('@cyanheads/mcp-ts-core/testing');
    const ctx = createMockContext();
    const input = searchBills.input.parse({ jurisdiction: 'wa', page: 2, per_page: 5 });
    await searchBills.handler(input, ctx);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(50);
    expect(enrichment.page).toBe(2);
    expect(enrichment.maxPage).toBe(10);
  });

  it('per_page maximum is 20', () => {
    expect(() => searchBills.input.parse({ jurisdiction: 'wa', per_page: 21 })).toThrow();
  });

  it('per_page minimum is 1', () => {
    expect(() => searchBills.input.parse({ jurisdiction: 'wa', per_page: 0 })).toThrow();
  });

  it('page minimum is 1', () => {
    expect(() => searchBills.input.parse({ jurisdiction: 'wa', page: 0 })).toThrow();
  });
});

describe('searchBills — sort and chamber filters', () => {
  let mockService: { searchBills: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      searchBills: vi.fn().mockResolvedValue({
        results: [],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('passes sort=latest_action_desc to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      sort: 'latest_action_desc',
    });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'latest_action_desc' }),
      expect.anything(),
    );
  });

  it('passes chamber=upper to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({ jurisdiction: 'wa', chamber: 'upper' });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ chamber: 'upper' }),
      expect.anything(),
    );
  });

  it('rejects invalid chamber value', () => {
    expect(() => searchBills.input.parse({ jurisdiction: 'wa', chamber: 'middle' })).toThrow();
  });

  it('accepts all valid sort values', () => {
    const validSorts = [
      'updated_asc',
      'updated_desc',
      'first_action_asc',
      'first_action_desc',
      'latest_action_asc',
      'latest_action_desc',
    ];
    for (const sort of validSorts) {
      expect(() => searchBills.input.parse({ jurisdiction: 'wa', sort })).not.toThrow();
    }
  });

  it('notice includes chamber filter when empty results', async () => {
    const { getEnrichment } = await import('@cyanheads/mcp-ts-core/testing');
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      chamber: 'upper',
    });
    await searchBills.handler(input, ctx);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('jurisdiction="wa"');
    expect(enrichment.notice).toContain('chamber="upper"');
    expect(enrichment.notice).toContain('broadening');
  });
});

describe('searchBills — subject and sponsor filters', () => {
  let mockService: { searchBills: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      searchBills: vi.fn().mockResolvedValue({
        results: [mockBill],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('passes subject array to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      subject: ['public safety', 'education'],
    });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ subject: ['public safety', 'education'] }),
      expect.anything(),
    );
  });

  it('passes empty subject array as undefined to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({ jurisdiction: 'wa', subject: [] });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ subject: undefined }),
      expect.anything(),
    );
  });

  it('passes sponsor filter to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      sponsor: 'ocd-person/abc123',
    });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ sponsor: 'ocd-person/abc123' }),
      expect.anything(),
    );
  });

  it('passes action_since filter to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      action_since: '2025-01-01',
    });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ action_since: '2025-01-01' }),
      expect.anything(),
    );
  });

  it('passes updated_since filter to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      updated_since: '2025-03-01',
    });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ updated_since: '2025-03-01' }),
      expect.anything(),
    );
  });

  it('passes created_since filter to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      created_since: '2025-01-01',
    });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ created_since: '2025-01-01' }),
      expect.anything(),
    );
  });
});

describe('searchBills — format edge cases', () => {
  it('formats bill with abstracts', () => {
    const result = {
      results: [
        {
          ...mockBill,
          abstracts: [
            {
              abstract: 'This bill improves public safety outcomes.',
              note: 'Legislative Digest',
            },
          ],
        },
      ],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchBills.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('This bill improves public safety outcomes.');
    expect(text).toContain('Legislative Digest');
  });

  it('formats bill with actions inline', () => {
    const result = {
      results: [
        {
          ...mockBill,
          actions: [
            {
              id: 'act-1',
              description: 'First reading',
              date: '2025-01-14',
              classification: ['reading-1'],
              order: 1,
              organization: { name: 'House', classification: 'lower' },
            },
          ],
        },
      ],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchBills.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Actions:');
    expect(text).toContain('First reading');
    expect(text).toContain('#1');
    expect(text).toContain('reading-1');
  });

  it('formats bill with empty classification and subject arrays', () => {
    const sparseResult = {
      results: [
        {
          ...mockBill,
          classification: [],
          subject: [],
          first_action_date: null,
          latest_action_date: null,
          latest_action_description: null,
          latest_passage_date: null,
        },
      ],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchBills.format!(sparseResult);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('HB 1000');
    // No crashes from missing optional fields
    expect(text).not.toContain('Classification:');
    expect(text).not.toContain('Subjects:');
  });

  it('formats bill cosponsor correctly', () => {
    const result = {
      results: [
        {
          ...mockBill,
          sponsorships: [
            {
              id: 'sp-2',
              name: 'Bob Jones',
              entity_type: 'person',
              primary: false,
              classification: 'cosponsor',
            },
          ],
        },
      ],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchBills.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Bob Jones');
    expect(text).toContain('Cosponsor');
  });

  it('formats multiple bills on a single page', () => {
    const result = {
      results: [
        mockBill,
        {
          ...mockBill,
          id: 'ocd-bill/99999',
          identifier: 'SB 500',
          title: 'A second bill',
        },
      ],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 2 },
    };
    const blocks = searchBills.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('HB 1000');
    expect(text).toContain('SB 500');
    expect(text).toContain('2 bills');
  });
});

/**
 * Regression coverage for the include-enrichment data loss (issue #18): the tool
 * advertises other_titles, other_identifiers, sources, documents, versions,
 * votes, and related_bills via `include`, but each was dropped before MCP
 * serialization — the output schema stripped the keys (Zod drops undeclared
 * object keys) and format() never rendered them, so both the structuredContent
 * and content[] client paths lost the data. Fixture shapes mirror the Bill
 * interface in src/services/openstates/types.ts.
 */
describe('searchBills — include enrichment surfacing', () => {
  const enrichedBill = {
    ...mockBill,
    other_titles: [{ title: 'An act concerning public safety', note: 'as introduced' }],
    other_identifiers: [{ identifier: 'HB1000-2025', scheme: 'lwrsn' }],
    sources: [{ url: 'https://leg.wa.gov/HB1000', note: 'Legislature bill page' }],
    documents: [
      {
        id: 'doc-hb1000',
        note: 'Fiscal Note',
        date: '2025-01-20',
        links: [{ url: 'https://leg.wa.gov/HB1000-fiscal.pdf', media_type: 'application/pdf' }],
      },
    ],
    versions: [
      {
        id: 'ver-hb1000',
        note: 'Substitute Bill',
        date: '2025-02-02',
        links: [{ url: 'https://leg.wa.gov/HB1000-S.pdf', media_type: 'application/pdf' }],
      },
    ],
    votes: [
      {
        id: 'vote-hb1000',
        motion_text: 'Third reading, final passage',
        start_date: '2025-03-09',
        result: 'pass',
        identifier: 'HB1000-final',
        counts: [
          { option: 'yes', value: 88 },
          { option: 'no', value: 9 },
        ],
        votes: [
          {
            option: 'yes',
            voter_name: 'Rep. Enrichment',
            voter: { id: 'ocd-person/enrich', name: 'Rep. Enrichment' },
          },
        ],
      },
    ],
    related_bills: [
      { identifier: 'SB 5000', legislative_session: '2025', relation_type: 'companion' },
    ],
  };

  /**
   * structuredContent path. Parsing the handler result through the tool's own
   * output schema is the exact step that dropped the data pre-fix — Zod strips
   * keys the schema does not declare, so before the fix `parsed.results[0]` had
   * none of these seven fields and every assertion below failed.
   */
  it('retains every include enrichment through the output schema', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const mockService = {
      searchBills: vi.fn().mockResolvedValue({
        results: [enrichedBill],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);

    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      include: [
        'other_titles',
        'other_identifiers',
        'sources',
        'documents',
        'versions',
        'votes',
        'related_bills',
      ],
    });
    const handlerResult = await searchBills.handler(input, ctx);
    const parsed = searchBills.output.parse(handlerResult);
    const bill = parsed.results[0];

    expect(bill.other_titles).toEqual([
      { title: 'An act concerning public safety', note: 'as introduced' },
    ]);
    expect(bill.other_identifiers).toEqual([{ identifier: 'HB1000-2025', scheme: 'lwrsn' }]);
    expect(bill.sources).toEqual([
      { url: 'https://leg.wa.gov/HB1000', note: 'Legislature bill page' },
    ]);
    expect(bill.documents?.[0].links[0].url).toBe('https://leg.wa.gov/HB1000-fiscal.pdf');
    expect(bill.versions?.[0].note).toBe('Substitute Bill');
    expect(bill.votes?.[0].counts).toEqual([
      { option: 'yes', value: 88 },
      { option: 'no', value: 9 },
    ]);
    expect(bill.votes?.[0].votes[0].voter?.id).toBe('ocd-person/enrich');
    expect(bill.related_bills?.[0].relation_type).toBe('companion');
  });

  /**
   * content[] path. format() rendered none of these pre-fix, so a Claude
   * Desktop-style client (which reads content[] text, not structuredContent)
   * saw less than a structuredContent client. Each assertion targets a distinct
   * enrichment's value in the rendered text.
   */
  it('renders every include enrichment in format() text', () => {
    const blocks = searchBills.format!({
      results: [enrichedBill],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    });
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('An act concerning public safety');
    expect(text).toContain('HB1000-2025');
    expect(text).toContain('lwrsn');
    expect(text).toContain('https://leg.wa.gov/HB1000');
    expect(text).toContain('https://leg.wa.gov/HB1000-fiscal.pdf');
    expect(text).toContain('Substitute Bill');
    expect(text).toContain('Third reading, final passage');
    expect(text).toContain('yes: 88');
    expect(text).toContain('Rep. Enrichment');
    expect(text).toContain('ocd-person/enrich');
    expect(text).toContain('SB 5000');
    expect(text).toContain('companion');
  });

  /**
   * Regression coverage for issue #31. Open States returns bill `other_identifiers` entries with
   * only an `identifier` key — no `scheme` — so a required `scheme` failed the output parse and
   * lost every result in the page. The fixture above supplies a `scheme`, which is why unit tests
   * passed while every live `include=other_identifiers` call errored.
   */
  describe('other_identifiers without a scheme', () => {
    const pageWithSchemelessIdentifier = {
      results: [
        { ...mockBill, other_identifiers: [{ identifier: 'ocd-bill-wa-2025_2026-hb2073' }] },
      ],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };

    it('parses an entry that omits scheme through the output schema', () => {
      const bill = searchBills.output.parse(pageWithSchemelessIdentifier).results[0];
      expect(bill.other_identifiers).toEqual([{ identifier: 'ocd-bill-wa-2025_2026-hb2073' }]);
      expect(bill.other_identifiers?.[0]?.scheme).toBeUndefined();
    });

    it('renders the identifier without an empty parenthetical', () => {
      const blocks = searchBills.format!(searchBills.output.parse(pageWithSchemelessIdentifier));
      const text = (blocks[0] as { text: string }).text;
      expect(text).toContain('- ocd-bill-wa-2025_2026-hb2073');
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('()');
    });
  });
});

/**
 * Regression coverage for issue #32. `appliedFilters` and the empty-result notice each echoed a
 * subset of the filters the query was actually issued with — a search narrowed by `subject` or
 * `sponsor` reported neither, so the recovery surfaces named a cause that was not the cause.
 * Both are now built from one record, so the assertions below cover the same filter set twice on
 * purpose: an echo that drifts from the notice is the defect.
 */
describe('searchBills — zero-result recovery names every filter', () => {
  let mockService: { searchBills: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      searchBills: vi.fn().mockResolvedValue({
        results: [],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  const everyFilter = {
    jurisdiction: 'wa',
    q: 'housing',
    session: '2025-2026',
    chamber: 'lower' as const,
    classification: 'bill',
    subject: ['Housing'],
    sponsor: 'ocd-person/abc123',
    sponsor_classification: 'primary',
    action_since: '2025-01-01',
    updated_since: '2025-02-01',
    created_since: '2025-03-01',
    per_page: 2,
  };

  it('echoes subject, sponsor, and sponsor_classification in appliedFilters', async () => {
    const { getEnrichment } = await import('@cyanheads/mcp-ts-core/testing');
    const ctx = createMockContext();
    await searchBills.handler(searchBills.input.parse(everyFilter), ctx);
    expect(getEnrichment(ctx).appliedFilters).toEqual({
      ...everyFilter,
      sort: 'updated_desc',
      page: 1,
    });
  });

  it('names every narrowing filter in the notice', async () => {
    const { getEnrichment } = await import('@cyanheads/mcp-ts-core/testing');
    const ctx = createMockContext();
    await searchBills.handler(searchBills.input.parse(everyFilter), ctx);
    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('jurisdiction="wa"');
    expect(notice).toContain('q="housing"');
    expect(notice).toContain('session="2025-2026"');
    expect(notice).toContain('chamber="lower"');
    expect(notice).toContain('classification="bill"');
    expect(notice).toContain('subject=["Housing"]');
    expect(notice).toContain('sponsor="ocd-person/abc123"');
    expect(notice).toContain('sponsor_classification="primary"');
    expect(notice).toContain('action_since="2025-01-01"');
    expect(notice).toContain('updated_since="2025-02-01"');
    expect(notice).toContain('created_since="2025-03-01"');
  });

  /**
   * `sort`/`page`/`per_page` are echoed for self-verification but cannot explain a zero result, and
   * `include` selects inline related data rather than filtering — naming any of them as a cause
   * would misdirect the caller.
   */
  it('leaves sort, page, per_page, and include out of the notice', async () => {
    const { getEnrichment } = await import('@cyanheads/mcp-ts-core/testing');
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      per_page: 3,
      include: ['actions'],
    });
    await searchBills.handler(input, ctx);
    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('jurisdiction="wa"');
    expect(notice).not.toContain('sort=');
    expect(notice).not.toContain('page=');
    expect(notice).not.toContain('include=');
    expect(getEnrichment(ctx).appliedFilters).not.toHaveProperty('include');
  });

  /**
   * An empty `subject` array is dropped on the way upstream, so echoing it would report a filter
   * that was never applied. It leaves the record as `undefined`, which the trailer's JSON
   * serialization omits — same as any filter the caller did not supply.
   */
  it('omits a subject filter that arrived as an empty array', async () => {
    const { getEnrichment } = await import('@cyanheads/mcp-ts-core/testing');
    const ctx = createMockContext();
    await searchBills.handler(searchBills.input.parse({ jurisdiction: 'wa', subject: [] }), ctx);
    const applied = getEnrichment(ctx).appliedFilters as Record<string, unknown>;
    expect(applied.subject).toBeUndefined();
    expect(JSON.stringify(applied)).not.toContain('subject');
    expect(getEnrichment(ctx).notice).not.toContain('subject=');
  });

  /**
   * Upstream answers an unrecognized jurisdiction with HTTP 200 and zero rows, exactly as it
   * answers a well-formed query that matched nothing, so the generic "broaden the query" hint
   * pointed at the wrong dimension. The value is still sent upstream unchanged — only the hint
   * changes.
   */
  it('names an unrecognized jurisdiction as the likely cause', async () => {
    const { getEnrichment } = await import('@cyanheads/mcp-ts-core/testing');
    const ctx = createMockContext();
    await searchBills.handler(searchBills.input.parse({ jurisdiction: 'notastate' }), ctx);
    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('jurisdiction="notastate"');
    expect(notice).toContain('openstates_list_jurisdictions');
    expect(notice).not.toContain('Try broadening');
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ jurisdiction: 'notastate' }),
      expect.anything(),
    );
  });

  it('keeps the generic hint for a recognized jurisdiction that simply matched nothing', async () => {
    const { getEnrichment } = await import('@cyanheads/mcp-ts-core/testing');
    const ctx = createMockContext();
    await searchBills.handler(
      searchBills.input.parse({
        jurisdiction: 'ocd-jurisdiction/country:us/district:dc/government',
      }),
      ctx,
    );
    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('Try broadening');
    expect(notice).not.toContain('openstates_list_jurisdictions');
  });

  it('keeps the session hint when a recognized jurisdiction is filtered by session', async () => {
    const { getEnrichment } = await import('@cyanheads/mcp-ts-core/testing');
    const ctx = createMockContext();
    await searchBills.handler(
      searchBills.input.parse({ jurisdiction: 'Washington', session: '2025-2026' }),
      ctx,
    );
    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('openstates_get_jurisdiction');
  });

  /** A q-only search has no jurisdiction to diagnose — the generic hint is all that applies. */
  it('does not diagnose a jurisdiction when none was supplied', async () => {
    const { getEnrichment } = await import('@cyanheads/mcp-ts-core/testing');
    const ctx = createMockContext();
    await searchBills.handler(searchBills.input.parse({ q: 'zzqqxxnomatch' }), ctx);
    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('q="zzqqxxnomatch"');
    expect(notice).toContain('Try broadening');
  });
});

/**
 * Paging past the end of a result set 404s upstream. Without a declared reason the caller got a
 * bare status with no `data.reason` and no recovery hint — the service now carries the upstream
 * constraint in the message, and the tool supplies the reason and the next move.
 */
describe('searchBills — out-of-range page', () => {
  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchBills: vi
        .fn()
        .mockRejectedValue(
          new McpError(
            JsonRpcErrorCode.NotFound,
            'Open States rejected the request: invalid page, must be in [1, 3].',
            { status: 404 },
          ),
        ),
    } as never);
  });

  it('maps an upstream not-found to invalid_page with a recovery hint', async () => {
    const ctx = createMockContext({ errors: searchBills.errors });
    const input = searchBills.input.parse({ jurisdiction: 'wa', page: 99 });

    const err = await searchBills.handler(input, ctx).catch((e: unknown) => e);

    expect((err as McpError).data).toMatchObject({
      reason: 'invalid_page',
      recovery: { hint: expect.stringContaining('max_page') },
    });
    expect((err as McpError).message).toContain('invalid page, must be in [1, 3]');
  });

  it('leaves an unrelated upstream failure unwrapped', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchBills: vi.fn().mockRejectedValue(new Error('Service offline')),
    } as never);
    const ctx = createMockContext({ errors: searchBills.errors });
    const input = searchBills.input.parse({ jurisdiction: 'wa' });

    await expect(searchBills.handler(input, ctx)).rejects.toThrow('Service offline');
  });
});

/**
 * Regression coverage for issue #38. `note` is a required, non-nullable string on abstracts,
 * versions, and documents, so `""` is a legal upstream value — and Open States sends it.
 * Interpolating it unguarded left `_()_` after an abstract. Version and document lines carry an
 * optional `date` alongside `note`, so their full combination matrix lives in the issue #41 block
 * below. structuredContent is unaffected: `note: ""` is the accurate upstream value and stays.
 */
describe('searchBills format — empty abstract note renders no stray punctuation (issue #38)', () => {
  const pagination = { page: 1, per_page: 10, max_page: 1, total_items: 1 };
  const abstract = 'This bill establishes standards for public safety.';

  const render = (bill: Record<string, unknown>) => {
    const blocks = searchBills.format!({ results: [{ ...mockBill, ...bill }], pagination });
    return (blocks[0] as { text: string }).text;
  };

  it('drops the abstract parenthetical when note is empty', () => {
    const text = render({ abstracts: [{ abstract, note: '' }] });
    expect(text.split('\n')).toContain(`*${abstract}*`);
    expect(text).not.toContain('_()_');
  });

  it('keeps the abstract parenthetical when note is present', () => {
    const text = render({ abstracts: [{ abstract, note: 'House Research' }] });
    expect(text.split('\n')).toContain(`*${abstract}* _(House Research)_`);
  });
});

/**
 * Regression coverage for issue #41. `date` is a required, non-nullable string on versions and
 * documents, and Open States routinely sends `""` alongside a populated `note`, which left a
 * bare `()` mid-line. The note and date segments are independently optional, so each of the four
 * combinations is pinned here: id alone, id + note, id + date, id + note + date. The last must
 * stay byte-identical to what shipped before the guard. structuredContent is unaffected:
 * `date: ""` is the accurate upstream value and stays.
 */
describe('searchBills format — version and document note/date composition (issue #41)', () => {
  const pagination = { page: 1, per_page: 10, max_page: 1, total_items: 1 };
  const links = [{ url: 'https://leg.wa.gov/HB1000.pdf', media_type: 'application/pdf' }];
  const tail = 'https://leg.wa.gov/HB1000.pdf [application/pdf]';

  const renderLines = (bill: Record<string, unknown>) => {
    const blocks = searchBills.format!({ results: [{ ...mockBill, ...bill }], pagination });
    return (blocks[0] as { text: string }).text.split('\n');
  };

  const renderVersion = (note: string, date: string) =>
    renderLines({ versions: [{ id: 'HB1000-2025', note, date, links }] });

  const renderDocument = (note: string, date: string) =>
    renderLines({ documents: [{ id: 'doc-1', note, date, links }] });

  it('renders a version with neither note nor date as the id alone', () => {
    expect(renderVersion('', '')).toContain(`- [HB1000-2025]: ${tail}`);
  });

  it('renders a version with a note and no date without a parenthetical', () => {
    expect(renderVersion('Introduced', '')).toContain(`- [HB1000-2025] Introduced: ${tail}`);
  });

  it('renders a version with a date and no note', () => {
    expect(renderVersion('', '2025-01-13')).toContain(`- [HB1000-2025] (2025-01-13): ${tail}`);
  });

  it('renders a version with both note and date unchanged', () => {
    expect(renderVersion('Introduced', '2025-01-13')).toContain(
      `- [HB1000-2025] Introduced (2025-01-13): ${tail}`,
    );
  });

  it('renders a document with neither note nor date as the id alone', () => {
    expect(renderDocument('', '')).toContain(`- [doc-1]: ${tail}`);
  });

  it('renders a document with a note and no date without a parenthetical', () => {
    expect(renderDocument('Fiscal Note', '')).toContain(`- [doc-1] Fiscal Note: ${tail}`);
  });

  it('renders a document with a date and no note', () => {
    expect(renderDocument('', '2025-01-20')).toContain(`- [doc-1] (2025-01-20): ${tail}`);
  });

  it('renders a document with both note and date unchanged', () => {
    expect(renderDocument('Fiscal Note', '2025-01-20')).toContain(
      `- [doc-1] Fiscal Note (2025-01-20): ${tail}`,
    );
  });
});

/**
 * Regression coverage for issue #43. `start_date` on a vote event and `date` on an action are
 * required, non-nullable strings, so `""` is a legal upstream value that reaches format() intact.
 * Interpolated unguarded, the first left a bare `()` in the vote heading and the second a double
 * space plus an orphan colon on the action line. structuredContent is unaffected: `""` is the
 * accurate upstream value and stays.
 */
describe('searchBills — empty vote start_date and action date (issue #43)', () => {
  const pagination = { page: 1, per_page: 10, max_page: 1, total_items: 1 };

  const renderLines = (bill: Record<string, unknown>) => {
    const blocks = searchBills.format!({ results: [{ ...mockBill, ...bill }], pagination });
    return (blocks[0] as { text: string }).text.split('\n');
  };

  const vote = (start_date: string) => ({
    id: 'ocd-vote/1',
    motion_text: 'Third Reading',
    start_date,
    result: 'pass',
    identifier: 'HV-12',
    counts: [{ option: 'yes', value: 60 }],
    votes: [],
  });

  const action = (date: string) => ({
    description: 'Introduced',
    date,
    classification: [],
    order: 1,
    organization: { name: 'House', classification: 'lower' },
  });

  it('drops the vote-date parenthetical when start_date is empty', () => {
    const lines = renderLines({ votes: [vote('')] });
    expect(lines).toContain('### Third Reading');
    expect(lines.join('\n')).not.toContain('()');
  });

  it('keeps the vote-date parenthetical when start_date is present', () => {
    expect(renderLines({ votes: [vote('2025-03-01')] })).toContain(
      '### Third Reading (2025-03-01)',
    );
  });

  it('drops the action date and its separator space when date is empty', () => {
    expect(renderLines({ actions: [action('')] })).toContain('- #1: Introduced — House (lower)');
  });

  it('keeps the action date when present', () => {
    expect(renderLines({ actions: [action('2025-01-14')] })).toContain(
      '- #1 2025-01-14: Introduced — House (lower)',
    );
  });
});
