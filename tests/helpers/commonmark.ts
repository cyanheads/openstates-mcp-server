/**
 * @fileoverview CommonMark read-back helpers for asserting that `format()` text carries upstream
 * strings literally. Parses with markdown-it in `commonmark` mode, the reference grammar for
 * `content[]` parity: a value that round-trips here reads the same as its `structuredContent` twin.
 * @module tests/helpers/commonmark
 */

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt('commonmark');

type Token = ReturnType<typeof md.parse>[number];

/** Block tokens of `src`. */
export function parseBlocks(src: string): Token[] {
  return md.parse(src, {});
}

/** Every inline child token across all blocks, in document order. */
export function inlineTokens(src: string): Token[] {
  return parseBlocks(src).flatMap((t) => (t.type === 'inline' ? (t.children ?? []) : []));
}

/**
 * The text a reader sees for each inline block (heading, paragraph, list item), in order:
 * text and code-span content concatenated, soft and hard breaks as `\n`. Markup tokens
 * (emphasis, links, images, raw HTML) contribute nothing, so an escaped value reads back
 * byte-identical and an unescaped one reads back altered.
 */
export function readBack(src: string): string[] {
  return parseBlocks(src)
    .filter((t) => t.type === 'inline')
    .map((t) =>
      (t.children ?? [])
        .map((c) => {
          if (c.type === 'text' || c.type === 'code_inline') return c.content;
          if (c.type === 'softbreak' || c.type === 'hardbreak') return '\n';
          return '';
        })
        .join(''),
    );
}

/** Links in `src` as parsed: destination (`href`) and the label's read-back text. */
export function links(src: string): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  let current: { href: string; label: string } | undefined;
  for (const t of inlineTokens(src)) {
    if (t.type === 'link_open') current = { href: String(t.attrGet('href') ?? ''), label: '' };
    else if (t.type === 'link_close' && current) {
      out.push(current);
      current = undefined;
    } else if (current && (t.type === 'text' || t.type === 'code_inline'))
      current.label += t.content;
  }
  return out;
}

/**
 * Images in `src` as parsed: source (`src`) and alt text as a reader sees it.
 * The alt is read back from the token's children; the token's own `content` is escaped source.
 */
export function images(src: string): { src: string; alt: string }[] {
  return inlineTokens(src)
    .filter((t) => t.type === 'image')
    .map((t) => ({
      src: String(t.attrGet('src') ?? ''),
      alt: (t.children ?? []).map((c) => (c.type === 'text' ? c.content : '')).join(''),
    }));
}

/** Inline token types present in `src` — e.g. assert no `em_open`, `link_open`, `html_inline`. */
export function inlineTypes(src: string): Set<string> {
  return new Set(inlineTokens(src).map((t) => t.type));
}

/** markdown-it's destination normalization — what a parsed `href`/`src` equals for a given URL. */
export function normalizeLink(url: string): string {
  return md.normalizeLink(url);
}
