import { httpGet, HttpResponse, RequestOptions } from './http';
import { readCache, writeCache, isFresh } from './cache';

export async function getCached(url: string, opts: RequestOptions = {}): Promise<HttpResponse> {
  const accept = opts.accept ?? 'text/html, application/json;q=0.9, */*;q=0.5';
  const entry = readCache(url, accept);

  if (entry && isFresh(entry)) {
    return entry.response;
  }

  // No revalidation pass for now (server may ignore it). Always do a fresh GET if not fresh.
  const res = await httpGet(url, opts);

  if (res.statusCode >= 200 && res.statusCode < 300) {
    writeCache(url, accept, res);
  }

  return res;
}
