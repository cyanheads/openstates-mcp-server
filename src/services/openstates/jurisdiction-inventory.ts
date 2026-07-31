/**
 * @fileoverview The 56 jurisdictions Open States covers, and the lookups over them.
 * @module services/openstates/jurisdiction-inventory
 *
 * Static data and pure predicates only — no HTTP, no service state. Kept out of
 * `openstates-service.ts` so a caller that needs the lookup does not pull in the API client.
 */

/**
 * Full jurisdiction display name (lowercased) → Open States abbreviation, covering the entire
 * `classification=state` inventory: 50 states, DC, and 5 US territories.
 *
 * The `/committees` endpoint returns HTTP 500 when a full jurisdiction *name* is combined with a
 * `chamber` filter, while the abbreviation and OCD-ID forms resolve correctly; normalizing a name
 * to its abbreviation before the request sidesteps the upstream fault. `/bills`, `/people`, and
 * `/events` do not exhibit it, so `normalizeCommitteeJurisdiction` is applied only in
 * `searchCommittees`. A static map keeps normalization deterministic and adds no request.
 */
const JURISDICTION_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'al',
  alaska: 'ak',
  arizona: 'az',
  arkansas: 'ar',
  california: 'ca',
  colorado: 'co',
  connecticut: 'ct',
  delaware: 'de',
  florida: 'fl',
  georgia: 'ga',
  hawaii: 'hi',
  idaho: 'id',
  illinois: 'il',
  indiana: 'in',
  iowa: 'ia',
  kansas: 'ks',
  kentucky: 'ky',
  louisiana: 'la',
  maine: 'me',
  maryland: 'md',
  massachusetts: 'ma',
  michigan: 'mi',
  minnesota: 'mn',
  mississippi: 'ms',
  missouri: 'mo',
  montana: 'mt',
  nebraska: 'ne',
  nevada: 'nv',
  'new hampshire': 'nh',
  'new jersey': 'nj',
  'new mexico': 'nm',
  'new york': 'ny',
  'north carolina': 'nc',
  'north dakota': 'nd',
  ohio: 'oh',
  oklahoma: 'ok',
  oregon: 'or',
  pennsylvania: 'pa',
  'rhode island': 'ri',
  'south carolina': 'sc',
  'south dakota': 'sd',
  tennessee: 'tn',
  texas: 'tx',
  utah: 'ut',
  vermont: 'vt',
  virginia: 'va',
  washington: 'wa',
  'west virginia': 'wv',
  wisconsin: 'wi',
  wyoming: 'wy',
  'district of columbia': 'dc',
  'american samoa': 'as',
  guam: 'gu',
  'northern mariana islands': 'mp',
  'puerto rico': 'pr',
  // Open States' canonical display name is "United States Virgin Islands"; the shorter form is
  // carried too so either spelling a caller might copy resolves to the abbreviation.
  'united states virgin islands': 'vi',
  'virgin islands': 'vi',
};

/** The abbreviation half of the map — the same 56 jurisdictions, keyed the other way. */
const JURISDICTION_ABBRS = new Set(Object.values(JURISDICTION_NAME_TO_ABBR));

/**
 * OCD jurisdiction ID for a covered jurisdiction. The middle segment differs by kind —
 * `state:wa`, `district:dc`, `territory:pr` — and the two-letter code is always the same
 * abbreviation the name map yields.
 */
const OCD_JURISDICTION_ID =
  /^ocd-jurisdiction\/country:us\/(?:state|district|territory):([a-z]{2})\/government$/;

/**
 * Resolve a `jurisdiction` input to a `/committees`-safe form. A recognized full state or
 * territory name maps to its abbreviation; abbreviations and OCD-IDs (never name-map keys) and
 * any unrecognized value pass through unchanged.
 */
export function normalizeCommitteeJurisdiction(value: string): string {
  return JURISDICTION_NAME_TO_ABBR[value.trim().toLowerCase()] ?? value;
}

/**
 * Whether a `jurisdiction` input names one of the 56 jurisdictions Open States covers, in any of
 * the three forms the tools accept: full display name, two-letter abbreviation, or OCD-ID.
 *
 * `/bills` answers an unrecognized jurisdiction with HTTP 200 and an empty result set — identical
 * to a well-formed query that genuinely matched nothing — so this local check is the only way to
 * tell a caller which of the two happened. It is deliberately a check and not a gate: a value it
 * rejects is still sent upstream unchanged, and the answer only ever shapes a recovery hint on an
 * already-empty result.
 */
export function isKnownJurisdiction(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized in JURISDICTION_NAME_TO_ABBR || JURISDICTION_ABBRS.has(normalized)) return true;
  const abbr = OCD_JURISDICTION_ID.exec(normalized)?.[1];
  return abbr !== undefined && JURISDICTION_ABBRS.has(abbr);
}
