import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { HttpResponse } from './http';

interface CacheEntry {
  url: string;
  storedAt: number;
  expiresAt: number;
  etag?: string;
  lastModified?: string;
  response: HttpResponse;
}

const CACHE_DIR = path.join(os.homedir(), '.go2web-cache');
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function keyFor(url: string, accept: string): string {
  return crypto.createHash('sha256').update(`${accept}::${url}`).digest('hex');
}

function pathFor(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

function parseMaxAge(cacheControl: string): number | null {
  const m = cacheControl.match(/max-age=(\d+)/i);
  if (!m) return null;
  return parseInt(m[1], 10) * 1000;
}

export function readCache(url: string, accept: string): CacheEntry | null {
  ensureCacheDir();
  const file = pathFor(keyFor(url, accept));
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const entry = JSON.parse(raw) as CacheEntry;
    return entry;
  } catch {
    return null;
  }
}

export function isFresh(entry: CacheEntry): boolean {
  return Date.now() < entry.expiresAt;
}

export function writeCache(url: string, accept: string, response: HttpResponse): void {
  ensureCacheDir();
  const cacheControl = response.headers['cache-control'] ?? '';
  if (/no-store|private/i.test(cacheControl)) return;

  const maxAge = parseMaxAge(cacheControl);
  const ttl = maxAge ?? DEFAULT_TTL_MS;
  const now = Date.now();

  const entry: CacheEntry = {
    url,
    storedAt: now,
    expiresAt: now + ttl,
    etag: response.headers['etag'],
    lastModified: response.headers['last-modified'],
    response,
  };

  const file = pathFor(keyFor(url, accept));
  fs.writeFileSync(file, JSON.stringify(entry), 'utf8');
}

export function buildValidationHeaders(entry: CacheEntry): Record<string, string> {
  const headers: Record<string, string> = {};
  if (entry.etag) headers['If-None-Match'] = entry.etag;
  if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
  return headers;
}

export function clearCache(): number {
  if (!fs.existsSync(CACHE_DIR)) return 0;
  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) fs.unlinkSync(path.join(CACHE_DIR, f));
  return files.length;
}

export const cacheLocation = CACHE_DIR;
