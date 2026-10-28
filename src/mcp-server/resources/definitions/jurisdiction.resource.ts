/**
 * @fileoverview Jurisdiction metadata resource — stable reference context for session identifiers and coverage dates.
 * @module mcp-server/resources/definitions/jurisdiction
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError, validationError } from '@cyanheads/mcp-ts-core/errors';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

/** Percent-decodes the matched URI value once; a malformed escape is the caller's URI, not a server fault. */
function decodeJurisdictionId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    if (!(err instanceof URIError)) throw err;
    throw validationError(
      'jurisdiction_id has a malformed percent-escape. Write the ID as returned by openstates_list_jurisdictions, or percent-encode it completely.',
      {},
      { cause: err },
    );
  }
}

/**
 * `{+jurisdiction_id}` is RFC 6570 reserved expansion: the SDK matches it as `.+` rather than
 * `[^/,]+`, so the slash-delimited OCD ID `openstates_list_jurisdictions` returns routes, and its
 * `expand()` writes that ID back out with `/` and `:` intact. The SDK hands the matched value over
 * still percent-encoded (`New%20York`, `ocd-jurisdiction%2F…`), so the handler decodes it exactly
 * once before the lookup. The decode lives in the handler, not a `params` transform, because
 * params must stay JSON-Schema-serializable for `resources/templates/list`.
 */
export const jurisdictionResource = resource('openstates://jurisdiction/{+jurisdiction_id}', {
  name: 'openstates_jurisdiction',
  title: 'Jurisdiction Metadata',
  description:
    'Jurisdiction metadata including current sessions, coverage dates, and bill/people update timestamps. Use as stable reference context before querying bills or people — inject this to prime session identifiers without a tool call.',
  mimeType: 'application/json',
  cacheHint: { ttlMs: 43_200_000, cacheScope: 'public' },
  params: z.object({
    jurisdiction_id: z
      .string()
      .describe(
        'OCD jurisdiction ID as returned by openstates_list_jurisdictions, written with its slashes intact (e.g., "ocd-jurisdiction/country:us/state:wa/government"), state name (e.g., "Washington" or "New York"), or two-letter abbreviation (e.g., "wa"). Percent-encoded forms are decoded once.',
      ),
  }),
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'Jurisdiction ID does not exist in Open States.',
      recovery:
        'Use openstates_list_jurisdictions to discover valid jurisdiction IDs. States use the pattern: ocd-jurisdiction/country:us/state:{2-letter-abbr}/government.',
    },
    {
      reason: 'upstream_timeout',
      code: JsonRpcErrorCode.Timeout,
      when: 'Open States did not answer within the per-request timeout.',
      recovery:
        'Retry the read once; if it repeats, call openstates_get_jurisdiction without include=legislative_sessions for the smaller record.',
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

  async handler(params, ctx) {
    const jurisdictionId = decodeJurisdictionId(params.jurisdiction_id);
    const svc = getOpenStatesApiService();
    const jurisdiction = await svc
      .getJurisdiction(jurisdictionId, ['legislative_sessions'], ctx)
      .catch((err: unknown) => {
        if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
          throw ctx.fail('not_found', `Jurisdiction not found: ${jurisdictionId}`);
        }
        throw err;
      });
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
