/**
 * @fileoverview Find legislators representing a geographic coordinate.
 * @module mcp-server/tools/definitions/get-legislators-by-location
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

export const getLegislatorsByLocation = tool('openstates_get_legislators_by_location', {
  title: 'Get Legislators by Location',
  description:
    'Find all state legislators representing a geographic coordinate. Pass latitude and longitude to get state senators and representatives (and potentially governor/executive officials) for that location. Useful for constituent-to-representative matching, address-based policy research, and electoral boundary analysis. This server does not geocode addresses — the caller must provide decimal-degree coordinates. Use include=offices to get contact information alongside the legislator list.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    latitude: z.number().describe('Latitude in decimal degrees (e.g., 47.6062 for Seattle, WA).'),
    longitude: z
      .number()
      .describe('Longitude in decimal degrees (e.g., -122.3321 for Seattle, WA).'),
    include: z
      .array(PersonIncludeEnum)
      .optional()
      .describe('Related data to inline. "offices" includes phone, fax, and address.'),
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
              })
              .nullable()
              .describe('Current role or null.'),
            jurisdiction: z
              .object({
                id: z.string().describe('OCD jurisdiction ID.'),
                name: z.string().describe('Jurisdiction name.'),
              })
              .describe('Home jurisdiction.'),
            email: z.string().describe('Email address. Empty string when not available.'),
            openstates_url: z.string().describe('Open States profile URL.'),
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
                    note: z.string().describe('Link description.'),
                  })
                  .describe('External link record.'),
              )
              .optional()
              .describe('Website and social links when include=links is requested.'),
          })
          .describe('Legislator record.'),
      )
      .describe('Legislators representing the given coordinate.'),
    count: z.number().describe('Number of legislators returned.'),
    coverage_note: z
      .string()
      .optional()
      .describe(
        'Present when no legislators were found — explains why (e.g., location outside US boundaries or unsupported territory).',
      ),
  }),
  errors: [
    {
      reason: 'invalid_coordinate',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Latitude or longitude is outside valid range.',
      recovery:
        'Latitude must be between -90 and 90, longitude between -180 and 180. For continental US: lat 24-50, lng -125 to -66. For Alaska: lat 51-72, lng -180 to -130.',
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
        {
          ...ctx.recoveryFor('invalid_coordinate'),
        },
      );
    }

    const svc = getOpenStatesApiService();
    const result = await svc.getPeopleByGeo(
      input.latitude,
      input.longitude,
      input.include && input.include.length > 0 ? input.include : undefined,
      ctx,
    );

    ctx.log.info('Fetched legislators by geo', {
      latitude: input.latitude,
      longitude: input.longitude,
      count: result.results.length,
    });

    if (result.results.length === 0) {
      return {
        legislators: [],
        count: 0,
        coverage_note: `No legislators found for coordinates (${input.latitude}, ${input.longitude}). Verify the location is within a US state, DC, or Puerto Rico.`,
      };
    }

    return { legislators: result.results, count: result.results.length };
  },

  format: (result) => {
    const lines: string[] = [`**${result.count} legislators found**`];
    if (result.coverage_note) {
      lines.push('');
      lines.push(`> ${result.coverage_note}`);
    }
    for (const person of result.legislators) {
      lines.push('');
      lines.push(`## ${person.name}`);
      lines.push(`**ID:** ${person.id}`);
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
