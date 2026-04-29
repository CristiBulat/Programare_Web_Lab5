import { parse } from 'node-html-parser';
import { httpGet } from './http';
import { getCached } from './client';

export interface SearchResult {
  rank: number;
  title: string;
  url: string;
  snippet: string;
}

function decodeDuckRedirect(href: string): string {
  // DuckDuckGo HTML wraps results in /l/?uddg=<encoded>
  try {
    if (href.startsWith('//')) href = 'https:' + href;
    const u = new URL(href, 'https://duckduckgo.com');
    if (u.pathname === '/l/' && u.searchParams.has('uddg')) {
      return decodeURIComponent(u.searchParams.get('uddg')!);
    }
    return u.toString();
  } catch {
    return href;
  }
}

export async function search(term: string, useCache = true): Promise<SearchResult[]> {
  const q = encodeURIComponent(term);
  const url = `https://html.duckduckgo.com/html/?q=${q}`;

  const res = useCache
    ? await getCached(url, { accept: 'text/html' })
    : await httpGet(url, { accept: 'text/html' });

  const root = parse(res.body);
  const results: SearchResult[] = [];

  const containers = root.querySelectorAll('div.result');
  for (const c of containers) {
    if (results.length >= 10) break;

    const titleA = c.querySelector('a.result__a');
    const snippetEl = c.querySelector('a.result__snippet') || c.querySelector('.result__snippet');

    if (!titleA) continue;
    const title = titleA.text.trim();
    const href = titleA.getAttribute('href') || '';
    const url = decodeDuckRedirect(href);
    const snippet = snippetEl ? snippetEl.text.trim().replace(/\s+/g, ' ') : '';

    if (!title || !url) continue;
    results.push({ rank: results.length + 1, title, url, snippet });
  }

  return results;
}
