/**
 * @fileoverview Additional coverage for getBill: not_found re-throw, versions,
 * documents, related_bills, and sparse upstream fields in format.
 * @module tests/tools/get-bill.additional.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBill } from '@/mcp-server/tools/definitions/get-bill.tool.js';

vi.mock('@/services/openstates/openstates-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/openstates/openstates-service.js')>()),
  getOpenStatesApiService: vi.fn(),
}));

const baseBill = {
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
  openstates_url: 'https://openstates.org/wa/bills/2025/HB1000/',
};

describe('getBill — not_found contract error', () => {
  let mockService: {
    getBillById: ReturnType<typeof vi.fn>;
    getBillByPath: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      getBillById: vi.fn(),
      getBillByPath: vi.fn(),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('re-throws McpError NotFound as not_found contract error (openstates_id path)', async () => {
    mockService.getBillById.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'Bill not found'),
    );
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ openstates_id: 'ocd-bill/nonexistent' });
    await expect(getBill.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'not_found' },
    });
  });

  it('re-throws McpError NotFound as not_found contract error (path triple)', async () => {
    mockService.getBillByPath.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'Bill not found'),
    );
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ jurisdiction: 'wa', session: '2025', bill_id: 'HB 9999' });
    await expect(getBill.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'not_found' },
    });
  });

  it('propagates non-NotFound errors without wrapping in not_found', async () => {
    mockService.getBillById.mockRejectedValue(new Error('Network timeout'));
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ openstates_id: 'ocd-bill/timeout' });
    await expect(getBill.handler(input, ctx)).rejects.toThrow('Network timeout');
  });
});

describe('getBill — missing_lookup_params with partial path', () => {
  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const mockService = {
      getBillById: vi.fn(),
      getBillByPath: vi.fn(),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('throws missing_lookup_params when only session provided', async () => {
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ session: '2025' });
    await expect(getBill.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'missing_lookup_params' },
    });
  });

  it('throws missing_lookup_params when only bill_id provided', async () => {
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ bill_id: 'HB 1' });
    await expect(getBill.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'missing_lookup_params' },
    });
  });

  it('throws missing_lookup_params when jurisdiction+bill_id but no session', async () => {
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ jurisdiction: 'wa', bill_id: 'HB 1' });
    await expect(getBill.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'missing_lookup_params' },
    });
  });
});

describe('getBill format — versions, documents, related_bills, abstracts', () => {
  it('formats versions when present', () => {
    const result = {
      ...baseBill,
      versions: [
        {
          id: 'ver-1',
          note: 'Introduced',
          date: '2025-01-14',
          links: [{ url: 'https://example.com/HB1000.pdf', media_type: 'application/pdf' }],
        },
      ],
    };
    const blocks = getBill.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Bill Text Versions');
    expect(text).toContain('ver-1');
    expect(text).toContain('Introduced');
    expect(text).toContain('https://example.com/HB1000.pdf');
    expect(text).toContain('application/pdf');
  });

  it('formats documents when present', () => {
    const result = {
      ...baseBill,
      documents: [
        {
          id: 'doc-1',
          note: 'Fiscal Note',
          date: '2025-01-20',
          links: [{ url: 'https://example.com/fiscal.pdf', media_type: 'application/pdf' }],
        },
      ],
    };
    const blocks = getBill.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Documents');
    expect(text).toContain('doc-1');
    expect(text).toContain('Fiscal Note');
    expect(text).toContain('https://example.com/fiscal.pdf');
  });

  it('formats related_bills when present', () => {
    const result = {
      ...baseBill,
      related_bills: [
        {
          identifier: 'SB 500',
          legislative_session: '2025',
          relation_type: 'companion',
        },
      ],
    };
    const blocks = getBill.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Related Bills');
    expect(text).toContain('SB 500');
    expect(text).toContain('companion');
    expect(text).toContain('2025');
  });

  it('formats abstracts when present', () => {
    const result = {
      ...baseBill,
      abstracts: [
        {
          abstract: 'This bill establishes standards for public safety.',
          note: 'House Research',
        },
      ],
    };
    const blocks = getBill.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Summary');
    expect(text).toContain('This bill establishes standards for public safety.');
    expect(text).toContain('House Research');
  });

  it('formats voter with linked person record', () => {
    const result = {
      ...baseBill,
      votes: [
        {
          id: 'vote-1',
          motion_text: 'Do pass',
          start_date: '2025-03-10',
          result: 'pass',
          identifier: 'HB1000-v1',
          counts: [
            { option: 'yes', value: 60 },
            { option: 'no', value: 30 },
          ],
          votes: [
            {
              option: 'yes',
              voter_name: 'Rep. Smith',
              voter: { id: 'ocd-person/smith', name: 'Rep. Smith' },
            },
          ],
        },
      ],
    };
    const blocks = getBill.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('ocd-person/smith');
    expect(text).toContain('Rep. Smith');
    expect(text).toContain('yes: 60');
    expect(text).toContain('no: 30');
  });
});

describe('getBill — Zod input validation', () => {
  it('accepts numeric string for include array items via schema', () => {
    // include must be BillIncludeEnum values — invalid value should be rejected
    expect(() =>
      getBill.input.parse({ openstates_id: 'ocd-bill/1', include: ['invalid_include'] }),
    ).toThrow();
  });

  it('accepts all valid include values', () => {
    const validIncludes = [
      'sponsorships',
      'abstracts',
      'other_titles',
      'other_identifiers',
      'actions',
      'sources',
      'documents',
      'versions',
      'votes',
      'related_bills',
    ];
    for (const inc of validIncludes) {
      expect(() =>
        getBill.input.parse({ openstates_id: 'ocd-bill/1', include: [inc] }),
      ).not.toThrow();
    }
  });
});

/**
 * Regression coverage for the include-enrichment data loss (issue #18). get_bill
 * already surfaces votes/versions/documents/related_bills, but other_titles,
 * other_identifiers, and sources were advertised via `include` yet dropped: the
 * output schema stripped the keys and format() never rendered them. Fixture
 * shapes mirror the Bill interface in src/services/openstates/types.ts.
 */
describe('getBill — include enrichment surfacing (other_titles, other_identifiers, sources)', () => {
  const enrichedBill = {
    ...baseBill,
    other_titles: [{ title: 'An act concerning public safety', note: 'as introduced' }],
    other_identifiers: [{ identifier: 'HB1000-2025', scheme: 'lwrsn' }],
    sources: [{ url: 'https://leg.wa.gov/HB1000', note: 'Legislature bill page' }],
  };

  /**
   * structuredContent path. getBill.output previously stripped these three keys
   * (Zod drops undeclared keys), so this parse dropped them and the assertions
   * failed pre-fix.
   */
  it('retains other_titles, other_identifiers, and sources through the output schema', () => {
    const parsed = getBill.output.parse(enrichedBill);
    expect(parsed.other_titles).toEqual([
      { title: 'An act concerning public safety', note: 'as introduced' },
    ]);
    expect(parsed.other_identifiers).toEqual([{ identifier: 'HB1000-2025', scheme: 'lwrsn' }]);
    expect(parsed.sources).toEqual([
      { url: 'https://leg.wa.gov/HB1000', note: 'Legislature bill page' },
    ]);
  });

  /**
   * content[] path. format() rendered none of these three pre-fix.
   */
  it('renders other_titles, other_identifiers, and sources in format() text', () => {
    const blocks = getBill.format!(enrichedBill);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('An act concerning public safety');
    expect(text).toContain('as introduced');
    expect(text).toContain('HB1000-2025');
    expect(text).toContain('lwrsn');
    expect(text).toContain('https://leg.wa.gov/HB1000');
    expect(text).toContain('Legislature bill page');
  });
});

/**
 * Regression coverage for issue #31. Open States returns bill `other_identifiers` entries with
 * only an `identifier` key — no `scheme` — so a required `scheme` failed the output parse and
 * lost the entire bill record. The fixtures above supply a `scheme`, which is why unit tests
 * passed while every live `include=other_identifiers` call errored.
 */
describe('getBill — other_identifiers without a scheme (issue #31)', () => {
  const billWithSchemelessIdentifier = {
    ...baseBill,
    other_identifiers: [{ identifier: 'ocd-bill-wa-2025_2026-hb2073' }],
  };

  it('parses an entry that omits scheme through the output schema', () => {
    const parsed = getBill.output.parse(billWithSchemelessIdentifier);
    expect(parsed.other_identifiers).toEqual([{ identifier: 'ocd-bill-wa-2025_2026-hb2073' }]);
    expect(parsed.other_identifiers?.[0]?.scheme).toBeUndefined();
  });

  it('renders the identifier without an empty parenthetical', () => {
    const blocks = getBill.format!(getBill.output.parse(billWithSchemelessIdentifier));
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('- ocd-bill-wa-2025_2026-hb2073');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('()');
  });
});

/**
 * Regression coverage for issue #38. `note` is a required, non-nullable string on abstracts,
 * versions, and documents, so `""` is a legal upstream value — and Open States sends it.
 * Interpolating it unguarded left `_()_` after an abstract. Version and document lines carry an
 * optional `date` alongside `note`, so their full combination matrix lives in the issue #41 block
 * below. structuredContent is unaffected: `note: ""` is the accurate upstream value and stays.
 */
describe('getBill — empty abstract note renders no stray punctuation (issue #38)', () => {
  const abstract = 'This bill establishes standards for public safety.';

  it('drops the abstract parenthetical when note is empty', () => {
    const blocks = getBill.format!({ ...baseBill, abstracts: [{ abstract, note: '' }] });
    const text = (blocks[0] as { text: string }).text;
    expect(text.split('\n')).toContain(abstract);
    expect(text).not.toContain('_()_');
  });

  it('keeps the abstract parenthetical when note is present', () => {
    const blocks = getBill.format!({
      ...baseBill,
      abstracts: [{ abstract, note: 'House Research' }],
    });
    const text = (blocks[0] as { text: string }).text;
    expect(text.split('\n')).toContain(`${abstract} _(House Research)_`);
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
describe('getBill — version and document note/date composition (issue #41)', () => {
  const links = [{ url: 'https://leg.wa.gov/HB1000.pdf', media_type: 'application/pdf' }];
  const tail = 'https://leg.wa.gov/HB1000.pdf [application/pdf]';

  const renderVersion = (note: string, date: string) => {
    const blocks = getBill.format!({
      ...baseBill,
      versions: [{ id: 'HB1000-2025', note, date, links }],
    });
    return (blocks[0] as { text: string }).text;
  };

  const renderDocument = (note: string, date: string) => {
    const blocks = getBill.format!({
      ...baseBill,
      documents: [{ id: 'doc-1', note, date, links }],
    });
    return (blocks[0] as { text: string }).text;
  };

  it('renders a version with neither note nor date as the id alone', () => {
    expect(renderVersion('', '').split('\n')).toContain(`- [HB1000-2025]: ${tail}`);
  });

  it('renders a version with a note and no date without a parenthetical', () => {
    expect(renderVersion('Introduced', '').split('\n')).toContain(
      `- [HB1000-2025] Introduced: ${tail}`,
    );
  });

  it('renders a version with a date and no note', () => {
    expect(renderVersion('', '2025-01-13').split('\n')).toContain(
      `- [HB1000-2025] (2025-01-13): ${tail}`,
    );
  });

  it('renders a version with both note and date unchanged', () => {
    expect(renderVersion('Introduced', '2025-01-13').split('\n')).toContain(
      `- [HB1000-2025] Introduced (2025-01-13): ${tail}`,
    );
  });

  it('renders a document with neither note nor date as the id alone', () => {
    expect(renderDocument('', '').split('\n')).toContain(`- [doc-1]: ${tail}`);
  });

  it('renders a document with a note and no date without a parenthetical', () => {
    expect(renderDocument('Fiscal Note', '').split('\n')).toContain(
      `- [doc-1] Fiscal Note: ${tail}`,
    );
  });

  it('renders a document with a date and no note', () => {
    expect(renderDocument('', '2025-01-20').split('\n')).toContain(
      `- [doc-1] (2025-01-20): ${tail}`,
    );
  });

  it('renders a document with both note and date unchanged', () => {
    expect(renderDocument('Fiscal Note', '2025-01-20').split('\n')).toContain(
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
describe('getBill — empty vote start_date and action date (issue #43)', () => {
  const renderLines = (bill: Record<string, unknown>) => {
    const blocks = getBill.format!({ ...baseBill, ...bill });
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
