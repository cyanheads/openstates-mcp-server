/**
 * @fileoverview Jurisdiction metadata resource — stable reference context for session identifiers and coverage dates.
 * @module mcp-server/resources/definitions/jurisdiction
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

export const jurisdictionResource = resource('openstates://jurisdiction/{jurisdiction_id}', {
  title: 'Jurisdiction Metadata',
  description:
    'Jurisdiction metadata including current sessions, coverage dates, and bill/people update timestamps. Use as stable reference context before querying bills or people — inject this to prime session identifiers without a tool call.',
  mimeType: 'application/json',
  params: z.object({
    jurisdiction_id: z
      .string()
      .describe(
        'OCD jurisdiction ID, state name (e.g., "Washington"), or two-letter abbreviation (e.g., "wa").',
      ),
  }),

  async handler(params, ctx) {
    const svc = getOpenStatesApiService();
    const jurisdiction = await svc.getJurisdiction(
      params.jurisdiction_id,
      ['legislative_sessions'],
      ctx,
    );
    if (!jurisdiction) {
      throw notFound(`Jurisdiction not found: ${params.jurisdiction_id}`, {
        jurisdiction_id: params.jurisdiction_id,
      });
    }
    ctx.log.debug('Fetched jurisdiction resource', {
      id: jurisdiction.id,
      name: jurisdiction.name,
    });
    return jurisdiction;
  },

  list: async () => ({
    resources: [
      {
        uri: 'openstates://jurisdiction/wa',
        name: 'Washington',
        description: 'Washington State jurisdiction metadata',
        mimeType: 'application/json',
      },
      {
        uri: 'openstates://jurisdiction/ca',
        name: 'California',
        description: 'California jurisdiction metadata',
        mimeType: 'application/json',
      },
      {
        uri: 'openstates://jurisdiction/ny',
        name: 'New York',
        description: 'New York jurisdiction metadata',
        mimeType: 'application/json',
      },
      {
        uri: 'openstates://jurisdiction/tx',
        name: 'Texas',
        description: 'Texas jurisdiction metadata',
        mimeType: 'application/json',
      },
    ],
  }),
});
