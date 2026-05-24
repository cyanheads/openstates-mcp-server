/**
 * @fileoverview Search state legislators and officials by name, jurisdiction, chamber, or district.
 * @module mcp-server/tools/definitions/search-people
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

const PersonIncludeEnum = z.enum([
  'other_names',
  'other_identifiers',
  'links',
  'sources',
  'offices',
]);

export const searchPeople = tool('openstates_search_people', {
  title: 'Search People',
  description:
    'Search state legislators and officials by name, jurisdiction, chamber, district, or party. Supports name substring matching (case-insensitive). org_classification targets a specific chamber: "upper" for Senate, "lower" for House/Assembly, "legislature" for all legislators, "executive" for governors and executive officials. include=offices adds phone, fax, and address. include=links adds website and social links. Omitting jurisdiction searches across all states and may return a large result set.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    jurisdiction: z
      .string()
      .optional()
      .describe(
        'State name, abbreviation, or OCD-ID. Omitting searches across all states.',
      ),
    name: z
      .string()
      .optional()
      .describe('Name or partial name to match (case-insensitive substring).'),
    org_classification: z
      .enum(['legislature', 'executive', 'lower', 'upper', 'government'])
      .optional()
      .describe(
        'Filter by role type. "upper" = Senate, "lower" = House/Assembly, "legislature" = all legislators, "executive" = governors and executive officials.',
      ),
    district: z
      .string()
      .optional()
      .describe('District label (e.g., "1", "37", "At-Large"). Formats vary by state.'),
    include: z
      .array(PersonIncludeEnum)
      .optional()
      .describe(
        'Related data to inline. "offices" includes phone, fax, and address. "links" includes website and social links.',
      ),
    page: z.coerce.number().int().min(1).default(1).describe('Page number (1-indexed).'),
    per_page: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe('Results per page. Maximum 20.'),
  }),
  output: z.object({
    results: z
      .array(
        z
          .object({
            id: z.string().describe('OCD person ID.'),
            name: z.string().describe('Full name.'),
            party: z.string().describe('Primary party label. Empty string when unknown.'),
            current_role: z
              .object({
                title: z.string().describe('Role title (e.g., "Senator", "Representative").'),
                org_classification: z
                  .string()
                  .describe('Chamber classification (e.g., "upper", "lower").'),
                district: z
                  .string()
                  .nullable()
                  .describe('District label or null when undistricted.'),
              })
              .nullable()
              .describe('Current role or null when no active role is recorded.'),
            jurisdiction: z
              .object({
                id: z.string().describe('OCD jurisdiction ID.'),
                name: z.string().describe('Jurisdiction name.'),
              })
              .describe('Home jurisdiction.'),
            given_name: z.string().describe('Given (first) name.'),
            family_name: z.string().describe('Family (last) name.'),
            email: z.string().describe('Email address. Empty string when not available.'),
            openstates_url: z.string().describe('Open States profile URL.'),
            offices: z
              .array(
                z
                  .object({
                    name: z.string().describe('Office name or label.'),
                    classification: z.string().describe('Office type.'),
                    voice: z.string().optional().describe('Phone number when available.'),
                    fax: z.string().optional().describe('Fax number when available.'),
                    address: z.string().optional().describe('Mailing address when available.'),
                  })
                  .describe('Contact office record.'),
              )
              .optional()
              .describe('Contact offices when include=offices is requested.'),
            links: z
              .array(
                z
                  .object({
                    url: z.string().describe('Link URL.'),
                    note: z.string().describe('Link description (e.g., "website", "twitter").'),
                  })
                  .describe('External link record.'),
              )
              .optional()
              .describe('Website and social links when include=links is requested.'),
          })
          .describe('Legislator record.'),
      )
      .describe('Legislators matching the search criteria.'),
    pagination: z
      .object({
        page: z.number().describe('Current page.'),
        per_page: z.number().describe('Results per page.'),
        max_page: z.number().describe('Total pages.'),
        total_items: z.number().describe('Total matching legislators.'),
      })
      .describe('Pagination metadata.'),
    message: z
      .string()
      .optional()
      .describe('Recovery hint when results are empty. Absent when results are returned.'),
  }),

  async handler(input, ctx) {
    const svc = getOpenStatesApiService();
    const result = await svc.searchPeople(
      {
        jurisdiction: input.jurisdiction,
        name: input.name,
        org_classification: input.org_classification,
        district: input.district,
        include: input.include && input.include.length > 0 ? input.include : undefined,
        page: input.page,
        per_page: input.per_page,
      },
      ctx,
    );

    ctx.log.info('Searched people', {
      jurisdiction: input.jurisdiction,
      count: result.results.length,
      total: result.pagination.total_items,
    });

    if (result.results.length === 0) {
      const filters: string[] = [];
      if (input.jurisdiction) filters.push(`jurisdiction="${input.jurisdiction}"`);
      if (input.name) filters.push(`name="${input.name}"`);
      if (input.org_classification)
        filters.push(`org_classification="${input.org_classification}"`);
      if (input.district) filters.push(`district="${input.district}"`);
      return {
        results: [],
        pagination: result.pagination,
        message: `No legislators matched ${filters.join(', ')}. Try broadening the name filter, checking the jurisdiction, or removing the district filter.`,
      };
    }

    return { results: result.results, pagination: result.pagination };
  },

  format: (result) => {
    const lines: string[] = [
      `**${result.pagination.total_items} legislators** (page ${result.pagination.page}/${result.pagination.max_page}, per page ${result.pagination.per_page}, showing ${result.results.length})`,
    ];
    if (result.message) {
      lines.push('');
      lines.push(`> ${result.message}`);
    }
    for (const person of result.results) {
      lines.push('');
      lines.push(`## ${person.name}`);
      lines.push(`**ID:** ${person.id}`);
      lines.push(`**Given name:** ${person.given_name} | **Family name:** ${person.family_name}`);
      lines.push(`**Party:** ${person.party || 'Not available'}`);
      lines.push(`**Jurisdiction:** ${person.jurisdiction.name} (${person.jurisdiction.id})`);
      if (person.current_role) {
        const district = person.current_role.district
          ? ` — District ${person.current_role.district}`
          : '';
        lines.push(
          `**Role:** ${person.current_role.title} (${person.current_role.org_classification})${district}`,
        );
      }
      if (person.email) lines.push(`**Email:** ${person.email}`);
      if (person.openstates_url) lines.push(`**URL:** ${person.openstates_url}`);
      if (person.offices?.length) {
        for (const office of person.offices) {
          const parts: string[] = [`${office.name} [${office.classification}]`];
          if (office.voice) parts.push(`Phone: ${office.voice}`);
          if (office.fax) parts.push(`Fax: ${office.fax}`);
          if (office.address) parts.push(`Address: ${office.address}`);
          lines.push(`**Office:** ${parts.join(' | ')}`);
        }
      }
      if (person.links?.length) {
        lines.push(`**Links:** ${person.links.map((l) => `${l.note}: ${l.url}`).join(', ')}`);
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
