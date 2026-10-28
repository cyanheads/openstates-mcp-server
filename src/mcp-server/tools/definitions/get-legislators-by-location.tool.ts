/**
 * @fileoverview Find the state legislators and federal delegation representing a geographic coordinate.
 * @module mcp-server/tools/definitions/get-legislators-by-location
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { escapeMarkdownInline, markdownImage, markdownLink } from '@cyanheads/mcp-ts-core/utils';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

const PersonIncludeEnum = z.enum([
  'other_names',
  'other_identifiers',
  'links',
  'sources',
  'offices',
]);

/**
 * `jurisdiction.classification` values that separate the two tiers `/people.geo` returns together.
 * `current_role.org_classification` is `upper`/`lower` for a US Senator exactly as it is for a
 * state senator, so the chamber field cannot tell them apart and this one is the discriminator.
 */
const FEDERAL_CLASSIFICATION = 'country';
const STATE_CLASSIFICATION = 'state';

/**
 * How many results serve the given government level. The handler and `format()` derive the tier
 * counts independently — from the service result and from the parsed output respectively — so they
 * share this predicate rather than each rolling their own, which is how the two surfaces last
 * disagreed about the same numbers.
 */
function countTier(
  people: ReadonlyArray<{ jurisdiction: { classification?: string | undefined } }>,
  level: string,
): number {
  return people.filter((p) => p.jurisdiction.classification === level).length;
}

/**
 * Human-readable tier for a jurisdiction classification, as Markdown. The two values this endpoint
 * returns get a plain-language label; anything else is rendered verbatim (escaped, so it reads back
 * as upstream sent it) rather than guessed at or dropped, so an unfamiliar level still reaches a
 * `content[]`-only client. Undefined when upstream omits it.
 */
function tierLabel(classification: string | undefined): string | undefined {
  if (classification === undefined) return;
  if (classification === FEDERAL_CLASSIFICATION) return 'federal (US Congress)';
  if (classification === STATE_CLASSIFICATION) return 'state legislature';
  return escapeMarkdownInline(classification);
}

export const getLegislatorsByLocation = tool('openstates_get_legislators_by_location', {
  title: 'Get Legislators by Location',
  description:
    'Find every legislator representing a geographic coordinate — both tiers. Pass latitude and longitude to get the state senators and representatives for that location (and potentially governor/executive officials), plus the coordinate\'s two US Senators and its US Representative. jurisdiction.classification separates the tiers: "state" is a state legislature, "country" is the US Congress. current_role.org_classification does not — it is "upper"/"lower" for a US Senator exactly as for a state senator. Useful for constituent-to-representative matching, address-based policy research, and electoral boundary analysis. This server does not geocode addresses — the caller must provide decimal-degree coordinates. Use include=offices to get contact information alongside the legislator list.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    latitude: z.number().describe('Latitude in decimal degrees (e.g., 47.6062 for Seattle, WA).'),
    longitude: z
      .number()
      .describe('Longitude in decimal degrees (e.g., -122.3321 for Seattle, WA).'),
    include: z
      .array(PersonIncludeEnum)
      .optional()
      .describe(
        'Related data to inline. "offices" includes phone, fax, and address. "links" includes website and social links. "other_names" includes alternate/former names, "other_identifiers" cross-system IDs, and "sources" the provenance URLs behind the record.',
      ),
  }),
  output: z.object({
    legislators: z
      .array(
        z
          .object({
            id: z.string().describe('OCD person ID.'),
            name: z.string().describe('Full name.'),
            party: z.string().describe('Primary party label. Empty string when unknown.'),
            current_role: z
              .object({
                title: z.string().describe('Role title.'),
                org_classification: z.string().describe('Chamber classification.'),
                district: z.string().nullable().describe('District label or null.'),
                division_id: z
                  .string()
                  .nullable()
                  .optional()
                  .describe(
                    'OCD division the district maps to (e.g., "ocd-division/country:us/state:wa/sldu:37"). Null when undistricted, absent when upstream omits it.',
                  ),
              })
              .nullable()
              .describe('Current role or null.'),
            jurisdiction: z
              .object({
                id: z.string().describe('OCD jurisdiction ID.'),
                name: z.string().describe('Jurisdiction name.'),
                classification: z
                  .string()
                  .optional()
                  .describe(
                    'Government level this legislator serves: "state" for a state legislature, "country" for the US Congress. The field that separates the two tiers in this result set.',
                  ),
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
                    name: z.string().describe('Office name.'),
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
                        'Link description. Empty string when Open States recorded no description — common on person links.',
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
      .describe('Legislators representing the given coordinate.'),
  }),

  enrichment: {
    count: z.number().describe('Number of legislators returned for this coordinate.'),
    stateCount: z
      .number()
      .describe('Results serving a state legislature (jurisdiction.classification = "state").'),
    federalCount: z
      .number()
      .describe(
        'Results serving the US Congress (jurisdiction.classification = "country") — the coordinate\'s two US Senators and its US Representative.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Present when no legislators were found — explains why (e.g., location outside US boundaries or unsupported territory).',
      ),
  },
  errors: [
    {
      reason: 'invalid_coordinate',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Latitude or longitude is outside valid range.',
      recovery:
        'Latitude must be between -90 and 90, longitude between -180 and 180. For continental US: lat 24-50, lng -125 to -66. For Alaska: lat 51-72, lng -180 to -130.',
    },
    {
      reason: 'upstream_timeout',
      code: JsonRpcErrorCode.Timeout,
      when: 'Open States did not answer within the per-request timeout.',
      recovery:
        'Retry the lookup once; if it repeats, request fewer include values so the district lookup returns a smaller payload.',
      // Raised by the service's `classifyUpstreamFailure`, which owns both timeout clocks — the
      // handler never sees the expiry it would need to throw on.
      thrownBy: 'service',
    },
    {
      reason: 'rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      when: "The shared Open States API key reached a request cap — Open States' per-minute or daily limit, or this server's own daily budget.",
      recovery: 'Wait the number of seconds in retryAfter, then retry the same call unchanged.',
      retryable: true,
      // Raised by the service, which reads the cap from the 429 body or its own daily-budget guard.
      thrownBy: 'service',
    },
  ],

  async handler(input, ctx) {
    if (
      input.latitude < -90 ||
      input.latitude > 90 ||
      input.longitude < -180 ||
      input.longitude > 180
    ) {
      throw ctx.fail(
        'invalid_coordinate',
        `Invalid coordinates: latitude=${input.latitude}, longitude=${input.longitude}`,
      );
    }

    const svc = getOpenStatesApiService();
    const result = await svc.getPeopleByGeo(
      input.latitude,
      input.longitude,
      input.include && input.include.length > 0 ? input.include : undefined,
      ctx,
    );

    const federalCount = countTier(result.results, FEDERAL_CLASSIFICATION);
    const stateCount = countTier(result.results, STATE_CLASSIFICATION);

    ctx.log.info('Fetched legislators by geo', {
      latitude: input.latitude,
      longitude: input.longitude,
      count: result.results.length,
      federalCount,
    });

    ctx.enrich({ count: result.results.length, stateCount, federalCount });

    if (result.results.length === 0) {
      ctx.enrich.notice(
        `No legislators found for coordinates (${input.latitude}, ${input.longitude}). Verify the location is within a US state, DC, or one of the 5 US territories.`,
      );
    }

    return { legislators: result.results };
  },

  format: (result) => {
    const stateCount = countTier(result.legislators, STATE_CLASSIFICATION);
    const federalCount = countTier(result.legislators, FEDERAL_CLASSIFICATION);
    /**
     * The breakdown only earns a line when both tiers are present — a coordinate answered entirely
     * by one tier needs no disambiguation. Each count is its own tally rather than a subtraction
     * from the total, so a record at neither tier is left out of both here exactly as it is left
     * out of both in the enrichment, and its own line still carries the level upstream reported.
     */
    const breakdown =
      stateCount > 0 && federalCount > 0
        ? ` — ${stateCount} state, ${federalCount} federal (US Congress)`
        : '';
    /**
     * Every upstream string goes through an encoder so a CommonMark parse reads it back as written:
     * `escapeMarkdownInline` for text, `markdownLink` for a URL (labelled by its note, else by
     * itself), and `markdownImage` for the headshot. A blank line opens each list section, since a
     * label directly under a list is otherwise folded into the list's last item.
     */
    const lines: string[] = [`**${result.legislators.length} legislators found**${breakdown}`];
    for (const person of result.legislators) {
      const tier = tierLabel(person.jurisdiction.classification);
      lines.push('');
      lines.push(`## ${escapeMarkdownInline(person.name)}`);
      lines.push(`**ID:** ${escapeMarkdownInline(person.id)}`);
      lines.push(
        `**Given name:** ${escapeMarkdownInline(person.given_name)} | **Family name:** ${escapeMarkdownInline(person.family_name)}`,
      );
      lines.push(
        `**Party:** ${person.party ? escapeMarkdownInline(person.party) : 'Not available'}`,
      );
      lines.push(
        `**Jurisdiction:** ${escapeMarkdownInline(person.jurisdiction.name)} (${escapeMarkdownInline(person.jurisdiction.id)})${tier ? ` — ${tier}` : ''}`,
      );
      if (person.current_role) {
        const role = person.current_role;
        const district = role.district ? ` — District ${escapeMarkdownInline(role.district)}` : '';
        lines.push(
          `**Role:** ${escapeMarkdownInline(role.title)} (${escapeMarkdownInline(role.org_classification)})${district}`,
        );
        if (role.division_id) lines.push(`**Division:** ${escapeMarkdownInline(role.division_id)}`);
      }
      if (person.email) lines.push(`**Email:** ${escapeMarkdownInline(person.email)}`);
      if (person.openstates_url)
        lines.push(`**URL:** ${markdownLink(person.openstates_url, person.openstates_url)}`);
      if (person.image) lines.push(`**Photo:** ${markdownImage(person.name, person.image)}`);
      if (person.offices?.length) {
        for (const office of person.offices) {
          const parts: string[] = [
            `${escapeMarkdownInline(office.name)} [${escapeMarkdownInline(office.classification)}]`,
          ];
          if (office.voice) parts.push(`Phone: ${escapeMarkdownInline(office.voice)}`);
          if (office.fax) parts.push(`Fax: ${escapeMarkdownInline(office.fax)}`);
          if (office.address) parts.push(`Address: ${escapeMarkdownInline(office.address)}`);
          lines.push(`**Office:** ${parts.join(' | ')}`);
        }
      }
      if (person.links?.length) {
        lines.push(
          `**Links:** ${person.links.map((l) => markdownLink(l.note || l.url, l.url)).join(', ')}`,
        );
      }
      if (person.other_names?.length) {
        lines.push('', '**Other names:**');
        for (const n of person.other_names) {
          const note = n.note ? ` _(${escapeMarkdownInline(n.note)})_` : '';
          lines.push(`- ${escapeMarkdownInline(n.name)}${note}`);
        }
      }
      if (person.other_identifiers?.length) {
        lines.push('', '**Other identifiers:**');
        for (const oi of person.other_identifiers) {
          lines.push(
            `- ${escapeMarkdownInline(oi.identifier)} (${escapeMarkdownInline(oi.scheme)})`,
          );
        }
      }
      if (person.sources?.length) {
        lines.push('', '**Sources:**');
        for (const s of person.sources) {
          lines.push(`- ${markdownLink(s.note || s.url, s.url)}`);
        }
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
