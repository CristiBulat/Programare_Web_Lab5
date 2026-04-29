import * as net from 'net';
import * as tls from 'tls';
import { URL } from 'url';

export interface HttpResponse {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  rawHeaders: string;
  finalUrl: string;
}

export interface RequestOptions {
  accept?: string;
  followRedirects?: boolean;
  maxRedirects?: number;
  userAgent?: string;
  timeoutMs?: number;
}

const DEFAULT_USER_AGENT = 'go2web/1.0 (TCP-socket client)';

function buildRequest(method: string, url: URL, opts: RequestOptions): string {
  const path = url.pathname + (url.search || '');
  const accept = opts.accept ?? 'text/html, application/json;q=0.9, */*;q=0.5';
  const lines = [
    `${method} ${path} HTTP/1.1`,
    `Host: ${url.host}`,
    `User-Agent: ${opts.userAgent ?? DEFAULT_USER_AGENT}`,
    `Accept: ${accept}`,
    `Accept-Encoding: identity`,
    `Connection: close`,
    '',
    '',
  ];
  return lines.join('\r\n');
}

function connect(url: URL, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const port = url.port ? parseInt(url.port, 10) : isHttps ? 443 : 80;
    const host = url.hostname;

    const socket: net.Socket = isHttps
      ? tls.connect({ host, port, servername: host, ALPNProtocols: ['http/1.1'] })
      : net.connect({ host, port });

    const onError = (err: Error) => {
      socket.destroy();
      reject(err);
    };

    socket.setTimeout(timeoutMs, () => {
      onError(new Error(`Connection to ${host}:${port} timed out after ${timeoutMs}ms`));
    });

    if (isHttps) {
      (socket as tls.TLSSocket).once('secureConnect', () => resolve(socket));
    } else {
      socket.once('connect', () => resolve(socket));
    }
    socket.once('error', onError);
  });
}

function readAll(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks)));
    socket.on('close', () => resolve(Buffer.concat(chunks)));
    socket.on('error', reject);
  });
}

function parseHeaders(headerBlock: string): { statusCode: number; statusText: string; headers: Record<string, string> } {
  const lines = headerBlock.split('\r\n');
  const statusLine = lines.shift() ?? '';
  const statusMatch = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})\s*(.*)$/);
  if (!statusMatch) throw new Error(`Invalid status line: ${statusLine}`);

  const statusCode = parseInt(statusMatch[1], 10);
  const statusText = statusMatch[2];
  const headers: Record<string, string> = {};

  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    headers[key] = headers[key] ? `${headers[key]}, ${val}` : val;
  }

  return { statusCode, statusText, headers };
}

function decodeChunked(body: Buffer): Buffer {
  const result: Buffer[] = [];
  let offset = 0;
  while (offset < body.length) {
    const crlf = body.indexOf('\r\n', offset);
    if (crlf === -1) break;
    const sizeHex = body.slice(offset, crlf).toString('ascii').split(';')[0].trim();
    const size = parseInt(sizeHex, 16);
    if (isNaN(size)) break;
    offset = crlf + 2;
    if (size === 0) break;
    result.push(body.slice(offset, offset + size));
    offset += size + 2; // skip data + trailing CRLF
  }
  return Buffer.concat(result);
}

async function rawRequest(url: URL, opts: RequestOptions): Promise<HttpResponse> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const socket = await connect(url, timeoutMs);
  const request = buildRequest('GET', url, opts);
  socket.write(request);

  const raw = await readAll(socket);

  const headerEnd = raw.indexOf('\r\n\r\n');
  if (headerEnd === -1) throw new Error('Malformed HTTP response: no header terminator');

  const headerBlock = raw.slice(0, headerEnd).toString('utf8');
  const { statusCode, statusText, headers } = parseHeaders(headerBlock);

  let body: Buffer = Buffer.from(raw.slice(headerEnd + 4));
  if ((headers['transfer-encoding'] ?? '').toLowerCase().includes('chunked')) {
    body = decodeChunked(body);
  }

  // Charset detection from Content-Type
  const contentType = headers['content-type'] ?? '';
  const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
  const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf8';
  const encoding: BufferEncoding = ['utf-8', 'utf8', 'ascii', 'latin1', 'iso-8859-1'].includes(charset)
    ? charset === 'iso-8859-1' || charset === 'latin1' ? 'latin1'
      : 'utf8'
    : 'utf8';

  return {
    statusCode,
    statusText,
    headers,
    body: body.toString(encoding),
    rawHeaders: headerBlock,
    finalUrl: url.toString(),
  };
}

export async function httpGet(rawUrl: string, opts: RequestOptions = {}): Promise<HttpResponse> {
  const followRedirects = opts.followRedirects ?? true;
  const maxRedirects = opts.maxRedirects ?? 5;

  let currentUrl = new URL(rawUrl);
  let redirects = 0;

  while (true) {
    const res = await rawRequest(currentUrl, opts);
    res.finalUrl = currentUrl.toString();

    const isRedirect = [301, 302, 303, 307, 308].includes(res.statusCode);
    const location = res.headers['location'];

    if (followRedirects && isRedirect && location) {
      if (redirects >= maxRedirects) {
        throw new Error(`Too many redirects (>${maxRedirects})`);
      }
      const next = new URL(location, currentUrl);
      currentUrl = next;
      redirects++;
      continue;
    }

    return res;
  }
}
