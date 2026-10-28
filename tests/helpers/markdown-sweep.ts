/**
 * @fileoverview Shared fixtures for the CommonMark hostile-string sweeps (#53): the payload
 * classes, the leaf enumerator and setter for record-shaped output, and the rendered-structure
 * summaries the sweeps compare. Per-tool fixtures and slot rules stay in each test file.
 * @module tests/helpers/markdown-sweep
 */

import { inlineTokens, parseBlocks } from './commonmark.js';

/** Hostile payload classes keyed by name, for sweeps that set one string leaf at a time. */
export const HOSTILE: Record<string, string> = {
  emphasis: 'Q *e* _u_ Z',
  link: 'Q [y](https://example.org/forged) Z',
  image: 'Q ![i](https://example.org/i.png) Z',
  backticks: 'Q `c` Z',
  html: 'Q <b>h</b> Z',
  autolink: 'Q <https://example.org/a> Z',
  entity: 'Q &amp; Z',
  backslash: 'Q \\* Z',
  trailingHash: 'Q Z #',
  lineStartHash: '# Q',
  lineStartQuote: '> Q',
  lineStartDash: '- Q',
  lineStartOrdered: '1. Q',
  edgeWhitespace: '  Q Z  ',
  lineBreakHeading: 'Q\n# H',
  lineBreakList: 'Q\n- L',
};

/** Inline tokens the authored layout produces; anything else is upstream text parsed as syntax. */
export const AUTHORED_INLINE = new Set([
  'text',
  'softbreak',
  'hardbreak',
  'strong_open',
  'strong_close',
  'link_open',
  'link_close',
]);

type Path = (string | number)[];

/** Paths of string leaves; `url` leaves are link destinations, swept separately. */
export function leaves(value: unknown, wantUrl: boolean, path: Path = []): Path[] {
  if (typeof value === 'string') return (path.at(-1) === 'url') === wantUrl ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, wantUrl, [...path, i]));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) => leaves(v, wantUrl, [...path, k]));
  return [];
}

/** A deep copy of `base` with the string leaf at `path` replaced by `value`. */
export function withLeaf<T>(base: T, path: Path, value: string): T {
  const copy = structuredClone(base);
  let node = copy as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  node[path.at(-1)!] = value;
  return copy;
}

/** Single-line hostile values, for sweeps that run every payload through each field setter. */
export const HOSTILE_VALUES = [
  '*em* and _em_',
  '[forged](https://example.org/forged)',
  '![img](https://example.org/i.png)',
  'a `code` span',
  '<b>raw</b> html',
  '<https://example.org/auto>',
  'AT&amp;T &copy;',
  'C:\\dir\\ a\\*b\\',
  'ends with #',
  '# heading',
  '> quote',
  '- item',
  '1. ordered',
  '  edge whitespace  ',
];

/** Values with an embedded line break, for fields outside heading and code-span slots. */
export const MULTILINE_VALUES = ['first\n# H', 'first\n- L'];

const NON_TEXT = new Set(['text', 'softbreak', 'hardbreak']);

/** Rendered shape: block token types in order, and every markup inline token type in order. */
export function shape(text: string) {
  return {
    blocks: parseBlocks(text).map((t) => t.type),
    markup: inlineTokens(text)
      .map((t) => t.type)
      .filter((t) => !NON_TEXT.has(t)),
  };
}

/** Where a bill-sweep string lands: a heading holds one line, an inline slot may carry breaks. */
export type Slot = 'heading' | 'inline';

/** Hostile payload classes built around a unique marker; a multi-line value skips heading slots. */
export const PAYLOADS: [string, (marker: string, slot: Slot) => string][] = [
  ['emphasis', (m) => `*${m}* _${m}_ **${m}**`],
  ['forged link', (m) => `[${m}](https://example.org/forged)`],
  ['image', (m) => `![${m}](https://example.org/i.png)`],
  ['backticks', (m) => `\`${m}\` \`\``],
  ['raw HTML', (m) => `<b>${m}</b> <!-- c -->`],
  ['autolink', (m) => `<https://example.org/${m}> <a@b.co>`],
  ['entity', (m) => `${m} &amp; &copy; &#123;`],
  ['backslash', (m) => `${m}\\* \\_ \\`],
  ['trailing #', (m) => `${m} #`],
  ['line-leading #', (m) => `# ${m}`],
  ['line-leading >', (m) => `> ${m}`],
  ['line-leading -', (m) => `- ${m}`],
  ['line-leading 1.', (m) => `1. ${m}`],
  ['edge whitespace', (m) => `  ${m} `],
  ['line break then # H', (m, slot) => (slot === 'heading' ? m : `${m}\n# H`)],
  ['line break then - L', (m, slot) => (slot === 'heading' ? m : `${m}\n- L`)],
];

/** Rendered structure: block token types in order, and counts of every markup inline token. */
export function structure(text: string) {
  const inline: Record<string, number> = {};
  for (const token of inlineTokens(text)) {
    if (token.type === 'text' || token.type === 'softbreak' || token.type === 'hardbreak') continue;
    inline[token.type] = (inline[token.type] ?? 0) + 1;
  }
  return { blocks: parseBlocks(text).map((token) => token.type), inline };
}
