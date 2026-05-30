/**
 * @fileoverview Additional coverage for getBill: not_found re-throw, versions,
 * documents, related_bills, and sparse upstream fields in format.
 * @module tests/tools/get-bill.additional.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBill } from '@/mcp-server/tools/definitions/get-bill.tool.js';

vi.mock('@/services/openstates/openstates-service.js', () => ({
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
