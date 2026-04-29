#!/usr/bin/env node
import { getCached } from './client';
import { httpGet } from './http';
import { htmlToText, getTitle } from './html';
import { search, SearchResult } from './search';
import { clearCache, cacheLocation } from './cache';

const HELP = `go2web - HTTP/HTTPS client over raw TCP sockets

Usage:
  go2web -u <URL>                make an HTTP request to URL and print the response
  go2web -s <search-term...>     search the web (DuckDuckGo) and print top 10 results
  go2web -o <number>             open the Nth result from the most recent search
  go2web -a <URL>                request URL but accept JSON (content negotiation)
  go2web --no-cache              bypass cache for this request (combine with -u/-s)
  go2web --clear-cache           clear the local HTTP cache
  go2web -h | --help             show this help

Examples:
  go2web -u https://example.com
  go2web -s web programming course
  go2web -s nodejs && go2web -o 3
  go2web -a https://api.github.com/repos/nodejs/node
`;

interface ParsedArgs {
  mode: 'help' | 'url' | 'search' | 'open' | 'clear-cache' | 'unknown';
  value?: string;
  acceptJson?: boolean;
  noCache?: boolean;
  errorMsg?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  let acceptJson = false;
  let noCache = false;

  // Flags that can appear anywhere
  const filtered: string[] = [];
  for (const a of args) {
    if (a === '--no-cache') noCache = true;
    else filtered.push(a);
  }

  if (filtered.length === 0 || filtered[0] === '-h' || filtered[0] === '--help') {
    return { mode: 'help' };
  }

  const flag = filtered[0];
  const rest = filtered.slice(1);

  if (flag === '--clear-cache') return { mode: 'clear-cache' };

  if (flag === '-u') {
    if (rest.length !== 1) return { mode: 'unknown', errorMsg: '-u expects exactly one URL argument' };
    return { mode: 'url', value: rest[0], noCache };
  }

  if (flag === '-a') {
    if (rest.length !== 1) return { mode: 'unknown', errorMsg: '-a expects exactly one URL argument' };
    return { mode: 'url', value: rest[0], acceptJson: true, noCache };
  }

  if (flag === '-s') {
    if (rest.length === 0) return { mode: 'unknown', errorMsg: '-s expects at least one search term' };
    return { mode: 'search', value: rest.join(' '), noCache };
  }

  if (flag === '-o') {
    if (rest.length !== 1) return { mode: 'unknown', errorMsg: '-o expects a result number' };
    return { mode: 'open', value: rest[0], noCache };
  }

  return { mode: 'unknown', errorMsg: `Unknown option: ${flag}` };
}

function normalizeUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}

function isJsonResponse(contentType: string): boolean {
  return /\bapplication\/json\b/i.test(contentType) || /\+json\b/i.test(contentType);
}

async function handleUrl(rawUrl: string, acceptJson: boolean, noCache: boolean): Promise<void> {
  const url = normalizeUrl(rawUrl);
  const accept = acceptJson
    ? 'application/json, text/html;q=0.5, */*;q=0.1'
    : 'text/html, application/json;q=0.9, */*;q=0.5';

  const res = noCache
    ? await httpGet(url, { accept })
    : await getCached(url, { accept });

  const contentType = res.headers['content-type'] ?? '';

  console.log(`HTTP ${res.statusCode} ${res.statusText}`);
  console.log(`URL:          ${res.finalUrl}`);
  console.log(`Content-Type: ${contentType || '(none)'}`);
  console.log(`Length:       ${res.body.length} bytes`);
  console.log('─'.repeat(60));

  if (isJsonResponse(contentType)) {
    try {
      const parsed = JSON.parse(res.body);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(res.body);
    }
    return;
  }

  if (/\btext\/html\b/i.test(contentType) || /<html/i.test(res.body.slice(0, 1000))) {
    const title = getTitle(res.body);
    if (title) console.log(`Title: ${title}\n`);
    console.log(htmlToText(res.body));
    return;
  }

  // Default: plain text or unknown — print as-is
  console.log(res.body);
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const LAST_RESULTS_PATH = path.join(os.homedir(), '.go2web-cache', 'last-results.json');

function saveLastResults(results: SearchResult[]): void {
  try {
    fs.mkdirSync(path.dirname(LAST_RESULTS_PATH), { recursive: true });
    fs.writeFileSync(LAST_RESULTS_PATH, JSON.stringify(results), 'utf8');
  } catch {
    /* non-fatal */
  }
}

function loadLastResults(): SearchResult[] | null {
  try {
    if (!fs.existsSync(LAST_RESULTS_PATH)) return null;
    return JSON.parse(fs.readFileSync(LAST_RESULTS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function handleSearch(term: string, noCache: boolean): Promise<void> {
  console.log(`Searching for: "${term}"\n`);
  const results = await search(term, !noCache);

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  saveLastResults(results);

  for (const r of results) {
    console.log(`${r.rank}. ${r.title}`);
    console.log(`   ${r.url}`);
    if (r.snippet) console.log(`   ${r.snippet}`);
    console.log();
  }

  console.log(`(Use 'go2web -o <N>' to open one of the above results.)`);
}

async function handleOpen(numStr: string, noCache: boolean): Promise<void> {
  const n = parseInt(numStr, 10);
  if (isNaN(n) || n < 1) {
    console.error(`Invalid result number: ${numStr}`);
    process.exit(2);
  }
  const results = loadLastResults();
  if (!results || results.length === 0) {
    console.error('No previous search results. Run `go2web -s <term>` first.');
    process.exit(2);
  }
  const target = results.find((r) => r.rank === n);
  if (!target) {
    console.error(`Result #${n} not found (have 1..${results.length}).`);
    process.exit(2);
  }
  console.log(`Opening result #${n}: ${target.title}\n${target.url}\n`);
  console.log('─'.repeat(60));
  await handleUrl(target.url, false, noCache);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  switch (parsed.mode) {
    case 'help':
      console.log(HELP);
      return;
    case 'clear-cache': {
      const n = clearCache();
      console.log(`Cleared ${n} cache entr${n === 1 ? 'y' : 'ies'} from ${cacheLocation}`);
      return;
    }
    case 'url':
      await handleUrl(parsed.value!, parsed.acceptJson ?? false, parsed.noCache ?? false);
      return;
    case 'search':
      await handleSearch(parsed.value!, parsed.noCache ?? false);
      return;
    case 'open':
      await handleOpen(parsed.value!, parsed.noCache ?? false);
      return;
    case 'unknown':
    default:
      console.error(parsed.errorMsg ?? 'Invalid arguments');
      console.error('\n' + HELP);
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
