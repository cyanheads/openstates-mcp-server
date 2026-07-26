/**
 * @fileoverview Search state legislators and officials by name, jurisdiction, chamber, or district.
 * @module mcp-server/tools/definitions/search-people
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
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
    'Search state legislators and officials by name, jurisdiction, chamber, district, or party. jurisdiction is required — a search spanning all 56 jurisdictions exceeds the upstream timeout, including a name-only one, so scope every call to a single state. Use openstates_list_jurisdictions to pick one, or openstates_get_legislators_by_location when you have coordinates but no state. Supports name substring matching (case-insensitive). org_classification targets a role type: "upper" for Senate, "lower" for House/Assembly, "executive" for governors and executive officials, and "legislature" for every legislator — both chambers merged into one paginated set (all upper members, then all lower), which excludes executive-branch officials. Omitting org_classification is not the same as "legislature": it returns every officeholder, executive officials included. include=offices adds phone, fax, and address. include=links adds website and social links.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    jurisdiction: z
      .string()
      .optional()
      .describe(
        'State name, abbreviation, or OCD-ID. Required — an all-states search exceeds the upstream timeout, so omitting it is rejected before any request is issued.',
      ),
    name: z
      .string()
      .optional()
      .describe(
        'Name or partial name to match (case-insensitive substring). Narrows within the jurisdiction; it does not substitute for one.',
      ),
    org_classification: z
      .enum(['legislature', 'executive', 'lower', 'upper', 'government'])
      .optional()
      .describe(
        'Filter by role type. "upper" = Senate, "lower" = House/Assembly, "executive" = governors and executive officials, "legislature" = every legislator (both chambers merged into one paginated set, all upper members then all lower, excluding executive officials). Omitting this filter returns every officeholder including executive ones — it is not equivalent to "legislature".',
      ),
    district: z
      .string()
      .optional()
      .describe('District label (e.g., "1", "37", "At-Large"). Formats vary by state.'),
    include: z
      .array(PersonIncludeEnum)
      .optional()
      .describe(
        'Related data to inline. "offices" includes phone, fax, and address. "links" includes website and social links. "other_names" includes alternate/former names, "other_identifiers" cross-system IDs, and "sources" the provenance URLs behind the record.',
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
                division_id: z
                  .string()
                  .nullable()
                  .optional()
                  .describe(
                    'OCD division the district maps to (e.g., "ocd-division/country:us/state:wa/sldu:37"). Null when undistricted, absent when upstream omits it.',
                  ),
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
            image: z
              .string()
              .optional()
              .describe('Official headshot URL. Absent when no photo is published.'),
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
            other_names: z
              .array(
                z
                  .object({
                    name: z.string().describe('Alternate or former name.'),
                    note: z.string().describe('Note describing the alternate name.'),
                  })
                  .describe('Alternate name record.'),
              )
              .optional()
              .describe('Alternate/former names when include=other_names is requested.'),
            other_identifiers: z
              .array(
                z
                  .object({
                    identifier: z.string().describe('Alternate identifier.'),
                    scheme: z.string().describe('Identifier scheme (the issuing system).'),
                  })
                  .describe('Alternate identifier record.'),
              )
              .optional()
              .describe('Cross-system identifiers when include=other_identifiers is requested.'),
            sources: z
              .array(
                z
                  .object({
                    url: z.string().describe('Source URL.'),
                    note: z.string().describe('Source note.'),
                  })
                  .describe('Source record.'),
              )
              .optional()
              .describe('Provenance sources when include=sources is requested.'),
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
  }),

  enrichment: {
    totalCount: z.number().describe('Total legislators matching the query across all pages.'),
    page: z.number().describe('Current page returned.'),
    maxPage: z.number().describe('Total pages available.'),
    notice: z
      .string()
      .optional()
      .describe('Recovery hint when results are empty. Absent when results are returned.'),
    appliedFilters: z
      .object({
        jurisdiction: z.string().optional().describe('Jurisdiction filter as received.'),
        name: z.string().optional().describe('Name filter as received.'),
        org_classification: z.string().optional().describe('Role-type filter as received.'),
        district: z.string().optional().describe('District filter as received.'),
        page: z.number().describe('Page number requested.'),
        per_page: z.number().describe('Results per page requested.'),
      })
      .describe(
        'Filters applied to this query as the server received them, for agent self-verification of zero or unexpected results.',
      ),
  },
  enrichmentTrailer: {
    appliedFilters: {
      render: (v) => `Filters: ${JSON.stringify(v)}`,
    },
  },
  errors: [
    {
      reason: 'jurisdiction_required',
      code: JsonRpcErrorCode.ValidationError,
      when: 'jurisdiction was omitted — an all-states people search exceeds the upstream timeout.',
      recovery:
        'Provide a jurisdiction (state name, abbreviation, or OCD-ID); openstates_list_jurisdictions lists every valid value, and openstates_get_legislators_by_location resolves coordinates to legislators when no state is known.',
    },
    {
      reason: 'upstream_timeout',
      code: JsonRpcErrorCode.Timeout,
      when: 'Open States did not answer within the per-request timeout — the query is too broad.',
      recovery:
        'Narrow the search: keep the jurisdiction, add org_classification or district, and drop any include values you do not need.',
    },
  ],

  async handler(input, ctx) {
    if (!input.jurisdiction) {
      throw ctx.fail(
        'jurisdiction_required',
        'jurisdiction is required for openstates_search_people.',
        { ...ctx.recoveryFor('jurisdiction_required') },
      );
    }

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

    ctx.enrich.total(result.pagination.total_items);
    ctx.enrich({
      page: result.pagination.page,
      maxPage: result.pagination.max_page,
      appliedFilters: {
        jurisdiction: input.jurisdiction,
        name: input.name,
        org_classification: input.org_classification,
        district: input.district,
        page: input.page,
        per_page: input.per_page,
      },
    });

    if (result.results.length === 0) {
      const filters: string[] = [];
      if (input.jurisdiction) filters.push(`jurisdiction="${input.jurisdiction}"`);
      if (input.name) filters.push(`name="${input.name}"`);
      if (input.org_classification)
        filters.push(`org_classification="${input.org_classification}"`);
      if (input.district) filters.push(`district="${input.district}"`);
      ctx.enrich.notice(
        `No legislators matched ${filters.join(', ')}. Try broadening the name filter, checking the jurisdiction, or removing the district filter.`,
      );
    }

    return { results: result.results, pagination: result.pagination };
  },

  format: (result) => {
    const lines: string[] = [
      `**${result.pagination.total_items} legislators** (page ${result.pagination.page}/${result.pagination.max_page}, per page ${result.pagination.per_page}, showing ${result.results.length})`,
    ];
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
        if (person.current_role.division_id)
          lines.push(`**Division:** ${person.current_role.division_id}`);
      }
      if (person.email) lines.push(`**Email:** ${person.email}`);
      if (person.openstates_url) lines.push(`**URL:** ${person.openstates_url}`);
      if (person.image) lines.push(`**Photo:** ${person.image}`);
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
      if (person.other_names?.length) {
        lines.push('**Other names:**');
        for (const n of person.other_names) {
          lines.push(`- ${n.name}${n.note ? ` _(${n.note})_` : ''}`);
        }
      }
      if (person.other_identifiers?.length) {
        lines.push('**Other identifiers:**');
        for (const oi of person.other_identifiers) {
          lines.push(`- ${oi.identifier} (${oi.scheme})`);
        }
      }
      if (person.sources?.length) {
        lines.push('**Sources:**');
        for (const s of person.sources) {
          lines.push(`- ${s.url}${s.note ? ` _(${s.note})_` : ''}`);
        }
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
