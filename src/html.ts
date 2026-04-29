import { parse, HTMLElement } from 'node-html-parser';

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'nav', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'br', 'hr', 'pre',
  'blockquote', 'figure', 'figcaption', 'main', 'address',
]);

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'template']);

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function walk(node: HTMLElement | any, out: string[]): void {
  if (!node) return;
  if (node.nodeType === 3) {
    const text = decodeEntities(node.rawText ?? '');
    if (text.trim()) out.push(text);
    return;
  }
  if (!node.tagName) {
    for (const child of node.childNodes ?? []) walk(child, out);
    return;
  }
  const tag = node.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return;

  const isBlock = BLOCK_TAGS.has(tag);
  if (isBlock) out.push('\n');

  if (tag === 'a') {
    const text = (node.text ?? '').trim();
    const href = node.getAttribute('href');
    if (text && href) {
      out.push(`${text} [${href}]`);
    } else if (text) {
      out.push(text);
    }
    return;
  }

  if (tag === 'li') out.push('• ');

  for (const child of node.childNodes ?? []) walk(child, out);

  if (isBlock) out.push('\n');
}

export function htmlToText(html: string): string {
  const cleaned = html.replace(/<!doctype[^>]*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const root = parse(cleaned, {
    blockTextElements: { script: false, noscript: false, style: false, pre: true },
  });
  const out: string[] = [];
  walk(root, out);
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function getTitle(html: string): string | null {
  const root = parse(html);
  const titleEl = root.querySelector('title');
  return titleEl ? titleEl.text.trim() : null;
}

export { parse as parseHtml };
