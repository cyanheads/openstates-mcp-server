/**
 * @fileoverview Additional coverage for getLegislatorsByLocation: boundary
 * coordinate values, form-client empty strings, and include forwarding.
 * @module tests/tools/get-legislators-by-location.additional.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLegislatorsByLocation } from '@/mcp-server/tools/definitions/get-legislators-by-location.tool.js';
import { images, inlineTokens, links, normalizeLink, readBack } from '../helpers/commonmark.js';
import { HOSTILE_VALUES, MULTILINE_VALUES, shape } from '../helpers/markdown-sweep.js';

vi.mock('@/services/openstates/openstates-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/openstates/openstates-service.js')>()),
  getOpenStatesApiService: vi.fn(),
}));

const mockPerson = {
  id: 'ocd-person/abc123',
  name: 'Jane Smith',
  party: 'Democratic',
  current_role: { title: 'Senator', org_classification: 'upper', district: '37' },
  jurisdiction: {
    id: 'ocd-jurisdiction/country:us/state:wa/government',
    name: 'Washington',
  },
  given_name: 'Jane',
  family_name: 'Smith',
  email: '',
  openstates_url: '',
};

describe('getLegislatorsByLocation — coordinate boundary values', () => {
  let mockService: { getPeopleByGeo: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      getPeopleByGeo: vi.fn().mockResolvedValue({
        results: [mockPerson],
        pagination: { page: 1, per_page: 1, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('accepts lat=90 (north pole boundary)', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: 90, longitude: 0 });
    // lat=90 is exactly at the boundary — handler rejects > 90
    // The Zod schema uses .min(-90).max(90), so 90 is valid
    await expect(getLegislatorsByLocation.handler(input, ctx)).resolves.toBeDefined();
  });

  it('accepts lat=-90 (south pole boundary)', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: -90, longitude: 0 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).resolves.toBeDefined();
  });

  it('accepts lng=180 (date line boundary)', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: 0, longitude: 180 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).resolves.toBeDefined();
  });

  it('accepts lng=-180 (date line boundary)', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: 0, longitude: -180 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).resolves.toBeDefined();
  });

  it('throws invalid_coordinate for lat=90.001', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: 90.001, longitude: 0 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_coordinate' },
    });
  });

  it('throws invalid_coordinate for lng=-180.001', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: 0, longitude: -180.001 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_coordinate' },
    });
  });
});

describe('getLegislatorsByLocation — include forwarding', () => {
  let mockService: { getPeopleByGeo: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      getPeopleByGeo: vi.fn().mockResolvedValue({
        results: [
          {
            ...mockPerson,
            offices: [{ name: 'Capitol Office', classification: 'capitol', voice: '555-0100' }],
          },
        ],
        pagination: { page: 1, per_page: 1, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('passes include=offices to service', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({
      latitude: 47.6,
      longitude: -122.3,
      include: ['offices'],
    });
    await getLegislatorsByLocation.handler(input, ctx);
    expect(mockService.getPeopleByGeo).toHaveBeenCalledWith(
      47.6,
      -122.3,
      ['offices'],
      expect.anything(),
    );
  });

  it('returns offices in result when include=offices', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({
      latitude: 47.6,
      longitude: -122.3,
      include: ['offices'],
    });
    const result = await getLegislatorsByLocation.handler(input, ctx);
    expect(result.legislators[0]!.offices).toBeDefined();
    expect(result.legislators[0]!.offices?.[0]?.voice).toBe('555-0100');
  });
});

describe('getLegislatorsByLocation — format with offices', () => {
  it('formats offices when present', () => {
    const result = {
      legislators: [
        {
          ...mockPerson,
          offices: [
            {
              name: 'Capitol Office',
              classification: 'capitol',
              voice: '360-786-7660',
              address: 'PO Box 40437',
            },
          ],
        },
      ],
    };
    const blocks = getLegislatorsByLocation.format!(result);
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Capitol Office');
    expect(text).toContain('360-786-7660');
    expect(text).toContain('PO Box 40437');
  });

  it('formats email and openstates_url when present', () => {
    const result = {
      legislators: [
        {
          ...mockPerson,
          email: 'jane@leg.wa.gov',
          openstates_url: 'https://openstates.org/person/jane-smith/',
        },
      ],
    };
    const blocks = getLegislatorsByLocation.format!(result);
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('jane@leg.wa.gov');
    expect(text).toContain('https://openstates.org/person/jane-smith/');
  });
});

describe('getLegislatorsByLocation — Zod input validation', () => {
  it('rejects invalid include value', () => {
    expect(() =>
      getLegislatorsByLocation.input.parse({
        latitude: 47.6,
        longitude: -122.3,
        include: ['not_a_valid_include'],
      }),
    ).toThrow();
  });

  it('requires latitude', () => {
    expect(() => getLegislatorsByLocation.input.parse({ longitude: -122.3 })).toThrow();
  });

  it('requires longitude', () => {
    expect(() => getLegislatorsByLocation.input.parse({ latitude: 47.6 })).toThrow();
  });
});

/**
 * Regression coverage for the include-enrichment data loss (issue #18).
 * get_legislators_by_location advertises other_names, other_identifiers, and sources via
 * `include`, but each was dropped before MCP serialization at TWO layers: the service's
 * normalizePerson() — shared with search_people through getPeopleByGeo — copied only
 * offices/links (covered in tests/services/openstates-service.test.ts), and the tool output
 * schema declared no fields for them, so Zod stripped the keys on the structuredContent path
 * and format() never rendered them on the content[] path. Fixture shapes mirror the Person
 * interface in src/services/openstates/types.ts.
 */
describe('getLegislatorsByLocation — include enrichment surfacing', () => {
  const enrichedPerson = {
    ...mockPerson,
    other_names: [{ name: 'Jane A. Smith', note: 'ballot name' }],
    other_identifiers: [{ identifier: 'WA000123', scheme: 'legacy_openstates' }],
    sources: [{ url: 'https://leg.wa.gov/senators/smith', note: 'official roster' }],
  };

  /** structuredContent path — output.parse strips undeclared keys, which is how these dropped. */
  it('retains other_names/other_identifiers/sources through the output schema', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const mockService = {
      getPeopleByGeo: vi.fn().mockResolvedValue({
        results: [enrichedPerson],
        pagination: { page: 1, per_page: 1, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);

    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({
      latitude: 47.6,
      longitude: -122.3,
      include: ['other_names', 'other_identifiers', 'sources'],
    });
    const handlerResult = await getLegislatorsByLocation.handler(input, ctx);
    const person = getLegislatorsByLocation.output.parse(handlerResult).legislators[0]!;

    expect(person.other_names).toEqual([{ name: 'Jane A. Smith', note: 'ballot name' }]);
    expect(person.other_identifiers).toEqual([
      { identifier: 'WA000123', scheme: 'legacy_openstates' },
    ]);
    expect(person.sources).toEqual([
      { url: 'https://leg.wa.gov/senators/smith', note: 'official roster' },
    ]);
  });

  /** content[] path. format() rendered none of these three pre-fix. */
  it('renders other_names/other_identifiers/sources in format() text', () => {
    const blocks = getLegislatorsByLocation.format!({ legislators: [enrichedPerson] });
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Jane A. Smith');
    expect(text).toContain('ballot name');
    expect(text).toContain('WA000123');
    expect(text).toContain('legacy_openstates');
    expect(text).toContain('https://leg.wa.gov/senators/smith');
    expect(text).toContain('official roster');
  });
});

/**
 * Open States frequently returns `note: ""` for a person link. Rendering it as `${note}: ${url}`
 * unconditionally put a dangling separator in front of the URL on the `content[]` path. Each link
 * renders as a Markdown link labelled by its note, or by the URL itself when the note is empty, so
 * the read-back line carries no stray `: `. `structuredContent` is unaffected — `""` is the
 * accurate upstream value and stays.
 */
describe('getLegislatorsByLocation — link rendering with an empty note', () => {
  const personWithLinks = {
    ...mockPerson,
    links: [
      { url: 'https://housedemocrats.example.gov/thomas/', note: '' },
      { url: 'https://leg.example.gov/members/thomas', note: '' },
    ],
  };
  const linksLine = (text: string) =>
    readBack(text)
      .flatMap((block) => block.split('\n'))
      .find((line) => line.startsWith('Links:'));

  it('renders the URL alone when the note is empty', () => {
    const blocks = getLegislatorsByLocation.format!({ legislators: [personWithLinks] });
    const text = (blocks[0]! as { text: string }).text;
    expect(linksLine(text)).toBe(
      'Links: https://housedemocrats.example.gov/thomas/, https://leg.example.gov/members/thomas',
    );
    expect(links(text)).toEqual([
      {
        href: 'https://housedemocrats.example.gov/thomas/',
        label: 'https://housedemocrats.example.gov/thomas/',
      },
      {
        href: 'https://leg.example.gov/members/thomas',
        label: 'https://leg.example.gov/members/thomas',
      },
    ]);
  });

  it('still labels a link that has a note', () => {
    const blocks = getLegislatorsByLocation.format!({
      legislators: [
        {
          ...mockPerson,
          links: [
            { url: 'https://leg.example.gov/members/thomas', note: 'official page' },
            { url: 'https://housedemocrats.example.gov/thomas/', note: '' },
          ],
        },
      ],
    });
    const text = (blocks[0]! as { text: string }).text;
    expect(linksLine(text)).toBe(
      'Links: official page, https://housedemocrats.example.gov/thomas/',
    );
    expect(links(text)).toEqual([
      { href: 'https://leg.example.gov/members/thomas', label: 'official page' },
      {
        href: 'https://housedemocrats.example.gov/thomas/',
        label: 'https://housedemocrats.example.gov/thomas/',
      },
    ]);
  });
});

/**
 * Issue #53: every upstream string in `format()` reads back exactly from a CommonMark parse. Each
 * field of the second legislator — a member of the federal tier — is set to each hostile class in
 * turn; it must appear verbatim in the read-back text and leave the block structure and the
 * non-text inline tokens exactly as the benign value did.
 */
describe('getLegislatorsByLocation — format() Markdown fidelity (issue #53)', () => {
  const person = {
    id: 'ocd-person/9eddb3cd-868e-42ba-831a-b415fd7ed445',
    name: 'Jane Smith',
    party: 'Democratic',
    current_role: {
      title: 'Senator',
      org_classification: 'upper',
      district: 'At-Large',
      division_id: 'ocd-division/country:us/state:wa/sldu:37',
    },
    jurisdiction: {
      id: 'ocd-jurisdiction/country:us/state:wa/government',
      name: 'Washington',
      classification: 'state',
    },
    given_name: 'Jane',
    family_name: 'Smith',
    email: 'jane_smith@leg.wa.gov',
    openstates_url: 'https://openstates.org/person/jane-smith-4Xyz/',
    image: 'https://data.openstates.org/images/small/ocd-person/9eddb3cd.jpg',
    offices: [
      {
        name: 'Capitol Office',
        classification: 'capitol',
        voice: '360-786-7660',
        fax: '360-786-1999',
        address: 'PO Box 40437; Olympia, WA 98504',
      },
    ],
    links: [
      { url: 'https://senate.wa.gov/smith/', note: 'website' },
      { url: 'https://x.example.gov/jsmith', note: '' },
    ],
    other_names: [
      { name: 'Jane A. Smith', note: 'ballot name' },
      { name: 'J. Smith', note: '' },
    ],
    other_identifiers: [{ identifier: 'WAL000123', scheme: 'legacy_openstates' }],
    sources: [
      { url: 'https://leg.wa.gov/senators/smith', note: 'official roster' },
      { url: 'https://leg.wa.gov/roster', note: '' },
    ],
  };
  type Person = typeof person;
  const federal: Person = {
    ...structuredClone(person),
    id: 'ocd-person/fed456',
    name: 'Maria Cantwell',
    jurisdiction: {
      id: 'ocd-jurisdiction/country:us/government',
      name: 'United States',
      classification: 'country',
    },
  };
  const fixture = { legislators: [person, federal] };

  const render = (value: typeof fixture) =>
    (
      getLegislatorsByLocation.format!(getLegislatorsByLocation.output.parse(value))[0]! as {
        text: string;
      }
    ).text;
  const withSecond = (edit: (p: Person) => void) => {
    const f = structuredClone(fixture);
    edit(f.legislators[1]!);
    return render(f);
  };

  const fields: { path: string; set: (p: Person, v: string) => void; oneLine?: boolean }[] = [
    { path: 'name', set: (p, v) => (p.name = v), oneLine: true },
    { path: 'id', set: (p, v) => (p.id = v) },
    { path: 'party', set: (p, v) => (p.party = v) },
    { path: 'given_name', set: (p, v) => (p.given_name = v) },
    { path: 'family_name', set: (p, v) => (p.family_name = v) },
    { path: 'email', set: (p, v) => (p.email = v) },
    { path: 'jurisdiction.id', set: (p, v) => (p.jurisdiction.id = v) },
    { path: 'jurisdiction.name', set: (p, v) => (p.jurisdiction.name = v) },
    // Any value other than "state" or "country" reaches the tierLabel fallback verbatim.
    { path: 'jurisdiction.classification', set: (p, v) => (p.jurisdiction.classification = v) },
    { path: 'current_role.title', set: (p, v) => (p.current_role.title = v) },
    {
      path: 'current_role.org_classification',
      set: (p, v) => (p.current_role.org_classification = v),
    },
    { path: 'current_role.district', set: (p, v) => (p.current_role.district = v) },
    { path: 'current_role.division_id', set: (p, v) => (p.current_role.division_id = v) },
    { path: 'offices[].name', set: (p, v) => (p.offices[0]!.name = v) },
    { path: 'offices[].classification', set: (p, v) => (p.offices[0]!.classification = v) },
    { path: 'offices[].voice', set: (p, v) => (p.offices[0]!.voice = v) },
    { path: 'offices[].fax', set: (p, v) => (p.offices[0]!.fax = v) },
    { path: 'offices[].address', set: (p, v) => (p.offices[0]!.address = v) },
    { path: 'links[].note', set: (p, v) => (p.links[0]!.note = v) },
    { path: 'other_names[].name', set: (p, v) => (p.other_names[1]!.name = v) },
    { path: 'other_names[].note', set: (p, v) => (p.other_names[0]!.note = v) },
    {
      path: 'other_identifiers[].identifier',
      set: (p, v) => (p.other_identifiers[0]!.identifier = v),
    },
    { path: 'other_identifiers[].scheme', set: (p, v) => (p.other_identifiers[0]!.scheme = v) },
    { path: 'sources[].note', set: (p, v) => (p.sources[0]!.note = v) },
  ];

  it.each(fields)('$path reads back exactly for every hostile class', ({ set, oneLine }) => {
    const expected = shape(withSecond((p) => set(p, 'plain value')));
    for (const value of oneLine ? HOSTILE_VALUES : [...HOSTILE_VALUES, ...MULTILINE_VALUES]) {
      const text = withSecond((p) => set(p, value));
      expect({ value, shape: shape(text) }).toEqual({ value, shape: expected });
      expect(
        readBack(text).some((block) => block.includes(value)),
        value,
      ).toBe(true);
    }
  });

  it.each([
    ['openstates_url', (p: Person, url: string) => (p.openstates_url = url), 0, (u: string) => u],
    [
      'links[].url with a note',
      (p: Person, url: string) => (p.links[0]!.url = url),
      1,
      () => 'website',
    ],
    [
      'links[].url without a note',
      (p: Person, url: string) => (p.links[1]!.url = url),
      2,
      (u: string) => u,
    ],
    [
      'sources[].url with a note',
      (p: Person, url: string) => (p.sources[0]!.url = url),
      3,
      () => 'official roster',
    ],
    [
      'sources[].url without a note',
      (p: Person, url: string) => (p.sources[1]!.url = url),
      4,
      (u: string) => u,
    ],
  ] as const)('renders %s as one link to the URL', (_path, set, index, label) => {
    const perPerson = links(render(fixture)).length / 2;
    for (const url of ['https://example.org/plain', 'https://example.org/a b/(c)?q=<x>&amp;[y]']) {
      const link = links(withSecond((p) => set(p, url)))[perPerson + index];
      expect(link).toEqual({ href: normalizeLink(url), label: label(url) });
    }
    const literal = withSecond((p) => set(p, 'javascript:alert(1)'));
    expect(links(literal)).toHaveLength(perPerson * 2 - 1);
    expect(readBack(literal).some((block) => block.includes('javascript:alert(1)'))).toBe(true);
  });

  it('renders image as an image of the person, src the URL, alt the name', () => {
    const url = 'https://example.org/a b/(c)?q=<x>&amp;[y].jpg';
    const name = 'Maria *x* [y](https://e.org)';
    const text = withSecond((p) => {
      p.image = url;
      p.name = name;
    });
    const found = images(text);
    expect(found.map((i) => i.src)).toEqual([normalizeLink(person.image), normalizeLink(url)]);
    expect(found.map((i) => i.alt)).toEqual([person.name, name]);
  });

  it('renders a non-http(s) image as literal text with no image token', () => {
    const text = withSecond((p) => (p.image = 'data:image/png;base64,AAAA'));
    expect(inlineTokens(text).filter((t) => t.type === 'image')).toHaveLength(1);
    expect(readBack(text).some((block) => block.includes('data:image/png;base64,AAAA'))).toBe(true);
  });

  /**
   * A section label directly under a list was a lazy continuation of the list's last item, so
   * `- J. Smith` read back as `J. Smith\nOther identifiers:`. Each label is its own paragraph.
   */
  it('keeps each section label out of the list item above it', () => {
    const blocks = readBack(render(fixture));
    for (const label of ['Other names:', 'Other identifiers:', 'Sources:']) {
      expect(blocks.filter((block) => block === label)).toHaveLength(2);
    }
  });

  /** The #37/#38 empty-field rules: an empty note leaves no `_()_`, `: `, or empty parenthetical. */
  it('leaves no stray punctuation for an empty note', () => {
    const blocks = readBack(render(fixture));
    expect(blocks).toContain('J. Smith');
    expect(blocks).toContain('https://leg.wa.gov/roster');
    const lines = blocks.flatMap((block) => block.split('\n'));
    expect(lines).toContain('Links: website, https://x.example.gov/jsmith');
  });

  /**
   * Characterization: every non-blank line carrying no URL field is byte-identical to the pre-#53
   * output (blank lines now separate the section labels from the list above them), both tier
   * labels and the verbatim fallback included.
   */
  it('renders real-shaped values byte-identical outside the URL lines', () => {
    const municipal = structuredClone(person);
    municipal.id = 'ocd-person/x';
    municipal.jurisdiction.classification = 'municipality';
    const text = render({ legislators: [person, municipal] });
    const kept = text.split('\n').filter((line) => line !== '' && !line.includes('https://'));
    const body = (id: string, tier: string) => [
      '## Jane Smith',
      `**ID:** ${id}`,
      '**Given name:** Jane | **Family name:** Smith',
      '**Party:** Democratic',
      `**Jurisdiction:** Washington (ocd-jurisdiction/country:us/state:wa/government) — ${tier}`,
      '**Role:** Senator (upper) — District At-Large',
      '**Division:** ocd-division/country:us/state:wa/sldu:37',
      '**Email:** jane_smith@leg.wa.gov',
      '**Office:** Capitol Office [capitol] | Phone: 360-786-7660 | Fax: 360-786-1999 | Address: PO Box 40437; Olympia, WA 98504',
      '**Other names:**',
      '- Jane A. Smith _(ballot name)_',
      '- J. Smith',
      '**Other identifiers:**',
      '- WAL000123 (legacy_openstates)',
      '**Sources:**',
    ];
    expect(kept).toEqual([
      '**2 legislators found**',
      ...body('ocd-person/9eddb3cd-868e-42ba-831a-b415fd7ed445', 'state legislature'),
      ...body('ocd-person/x', 'municipality'),
    ]);
  });
});
