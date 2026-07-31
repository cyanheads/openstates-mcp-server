/**
 * @fileoverview Search state legislators and officials by name, jurisdiction, chamber, or district,
 * or fetch specific people by OCD person ID.
 * @module mcp-server/tools/definitions/search-people
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
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
    'Search state legislators and officials by name, jurisdiction, chamber, or district, or fetch specific people by OCD person ID. Party is reported on every result but cannot be filtered on — narrow by party after the call. Either jurisdiction or id is required — a search spanning all 56 jurisdictions exceeds the upstream timeout, including a name-only one, so scope every call to a single state or to specific person IDs. Use openstates_list_jurisdictions to pick a jurisdiction, or openstates_get_legislators_by_location when you have coordinates but no state. id takes the person IDs that openstates_get_bill sponsorships and openstates_get_committee memberships hand back, and resolves any number of them in one call. Supports name substring matching (case-insensitive). org_classification targets a role type: "upper" for Senate, "lower" for House/Assembly, "executive" for governors and executive officials, and "legislature" for every legislator — both chambers merged into one paginated set (all upper members, then all lower), which excludes executive-branch officials. Omitting org_classification is not the same as "legislature": it returns every officeholder, executive officials included. include=offices adds phone, fax, and address. include=links adds website and social links.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z
    .object({
      jurisdiction: z
        .string()
        .min(1)
        .optional()
        .describe(
          'State name, abbreviation, or OCD-ID. Required unless id is provided — an all-states search exceeds the upstream timeout, so every call must be scoped to a single jurisdiction or to specific person IDs.',
        ),
      id: z
        .array(z.string().min(1))
        .min(1)
        .optional()
        .describe(
          'OCD person IDs (e.g., "ocd-person/9eddb3cd-868e-42ba-831a-b415fd7ed445"). Required unless jurisdiction is provided — it returns exactly these people, so it scopes the call on its own and needs no jurisdiction alongside it. Resolves the IDs that openstates_search_people results, openstates_get_bill sponsorships[].person.id, and openstates_get_committee memberships[].person_id hand back — any number of them in one call, subject to per_page. An ID Open States does not know matches nothing rather than failing, as does an ID paired with a jurisdiction that person does not belong to.',
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
    })
    /**
     * `jurisdiction` or `id`, the same either/or `openstates_search_bills` carries for
     * `jurisdiction` or `q`. An unscoped query spans all 56 jurisdictions and exceeds the upstream
     * timeout, which is why `jurisdiction` was unconditional; an `id` lookup addresses named
     * records instead of scanning, so it bounds the query on its own. A cross-field refinement is
     * the only schema-level form of that rule — JSON Schema `required` takes one field list, not a
     * choice between two — and keeping it in the schema rather than in the handler keeps the
     * rejection an input-validation error, as it is for every other constraint on this tool.
     */
    .refine((input) => input.jurisdiction !== undefined || input.id !== undefined, {
      message:
        'Either jurisdiction or id is required. Provide a jurisdiction (state name or OCD-ID) or one or more OCD person IDs via id, or both.',
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
            given_name: z
              .string()
              .describe('Given (first) name. Empty string when Open States recorded none.'),
            family_name: z
              .string()
              .describe('Family (last) name. Empty string when Open States recorded none.'),
            email: z.string().describe('Email address. Empty string when not available.'),
            openstates_url: z
              .string()
              .describe('Open States profile URL. Empty string when Open States recorded none.'),
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
                    note: z
                      .string()
                      .describe(
                        'Link description (e.g., "website", "twitter"). Empty string when Open States recorded no description — common on person links.',
                      ),
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
                    note: z
                      .string()
                      .describe(
                        'Note describing the alternate name. Empty string when Open States recorded no note.',
                      ),
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
                    note: z
                      .string()
                      .describe('Source note. Empty string when Open States recorded no note.'),
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
        id: z
          .array(z.string())
          .optional()
          .describe('Person IDs filtered on, as received. Absent when none were supplied.'),
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
      reason: 'upstream_timeout',
      code: JsonRpcErrorCode.Timeout,
      when: 'Open States did not answer within the per-request timeout — the query is too broad.',
      recovery:
        'Narrow the search: keep the jurisdiction, add org_classification or district, and drop any include values you do not need.',
    },
    {
      reason: 'invalid_page',
      code: JsonRpcErrorCode.NotFound,
      when: 'Open States rejected the request as not found — page is past the last page for this query.',
      recovery:
        'Request a page within the max_page bound returned by a previous call; the error message names the valid range.',
    },
  ],

  async handler(input, ctx) {
    const svc = getOpenStatesApiService();
    const result = await svc
      .searchPeople(
        {
          jurisdiction: input.jurisdiction,
          id: input.id,
          name: input.name,
          org_classification: input.org_classification,
          district: input.district,
          include: input.include && input.include.length > 0 ? input.include : undefined,
          page: input.page,
          per_page: input.per_page,
        },
        ctx,
      )
      // The service has already folded the upstream `detail` into the message, so the reason and
      // recovery hint are all that is missing.
      .catch((err: unknown) => {
        if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
          throw ctx.fail('invalid_page', err.message, { ...ctx.recoveryFor('invalid_page') });
        }
        throw err;
      });

    ctx.log.info('Searched people', {
      jurisdiction: input.jurisdiction,
      idCount: input.id?.length,
      count: result.results.length,
      total: result.pagination.total_items,
    });

    ctx.enrich.total(result.pagination.total_items);
    ctx.enrich({
      page: result.pagination.page,
      maxPage: result.pagination.max_page,
      appliedFilters: {
        jurisdiction: input.jurisdiction,
        id: input.id,
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
      if (input.id) filters.push(`id=${JSON.stringify(input.id)}`);
      if (input.name) filters.push(`name="${input.name}"`);
      if (input.org_classification)
        filters.push(`org_classification="${input.org_classification}"`);
      if (input.district) filters.push(`district="${input.district}"`);
      // An ID query fails differently from a filter query: there is nothing to broaden, and
      // upstream answers an unknown ID with zero rows rather than an error, so the two ways an ID
      // yields nothing are the only ones worth naming.
      const hint = input.id
        ? 'Open States answers an ID it does not know with zero rows rather than an error, and an ID paired with a jurisdiction that person does not belong to matches nothing either. Re-check the ID against the tool that emitted it, or drop the jurisdiction filter.'
        : 'Try broadening the name filter, checking the jurisdiction, or removing the district filter.';
      ctx.enrich.notice(`No legislators matched ${filters.join(', ')}. ${hint}`);
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
        lines.push(
          `**Links:** ${person.links.map((l) => (l.note ? `${l.note}: ${l.url}` : l.url)).join(', ')}`,
        );
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
