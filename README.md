# Lab 5 — `go2web`

A command-line HTTP/HTTPS client that speaks HTTP **directly over raw TCP sockets** — no `http`/`https`/`fetch`/`axios` libraries involved. The protocol is implemented from scratch.

## Stack

- **TypeScript** + Node.js
- Networking: `net` (TCP) and `tls` (TLS over TCP) — socket-level only
- HTML parsing: [`node-html-parser`](https://www.npmjs.com/package/node-html-parser) (third-party, allowed by lab hints)

## Build & Run

```bash
cd lab5
npm install
npm run build
./go2web -h
```

The `go2web` shell script auto-builds the TypeScript on first run, then invokes the compiled CLI.

## CLI

| Command | Description |
|---|---|
| `go2web -u <URL>` | Make an HTTP request to URL and print the response |
| `go2web -s <search-term...>` | Search via DuckDuckGo and print top 10 results |
| `go2web -o <N>` | Open the Nth result from the most recent search |
| `go2web -a <URL>` | Request URL, prefer JSON (content negotiation) |
| `go2web --no-cache` | Bypass cache (combine with `-u` / `-s`) |
| `go2web --clear-cache` | Clear local HTTP cache |
| `go2web -h` | Help |

### Examples

```bash
./go2web -u https://example.com
./go2web -s typescript handbook
./go2web -o 1                                          # opens first result
./go2web -a https://api.github.com/repos/nodejs/node   # JSON response, pretty-printed
./go2web -u http://github.com                          # follows redirect to https://github.com/
```

## Features

### Required (`+6` points)
- ✅ `-h`, `-u`, `-s` all implemented
- ✅ HTTP request/response built and parsed manually over TCP/TLS sockets
- ✅ Human-readable output: HTML stripped of tags, doctype/comments dropped, links inlined as `text [href]`
- ✅ DuckDuckGo HTML endpoint scraped for top 10 results

### Bonus features

- ✅ **Accessing search results** — `go2web -o <N>` opens result N from the last search
- ✅ **HTTP redirects** — follows 301/302/303/307/308 (up to 5 hops, with relative-URL resolution)
- ✅ **HTTP cache** — file-based cache in `~/.go2web-cache/`, respects `Cache-Control: max-age` / `no-store`, default TTL 5 min, `--clear-cache` to wipe
- ✅ **Content negotiation** — sends `Accept: text/html, application/json;q=0.9, */*;q=0.5` by default; `-a` flips it to prefer JSON. Response is rendered differently based on `Content-Type` (HTML → stripped text, JSON → pretty-printed)

## Architecture

```
src/
├── index.ts     CLI entry / argument parser / output renderer
├── http.ts      Raw HTTP/1.1 client over net/tls sockets — request building,
│                response parsing, chunked transfer decoding, redirects
├── client.ts    Cached GET wrapper around http.ts
├── cache.ts     Disk-backed cache (~/.go2web-cache), Cache-Control aware
├── search.ts    DuckDuckGo HTML scraping + uddg redirect decoding
└── html.ts      HTML→text conversion (strips tags, decodes entities, inlines links)
```

### What the HTTP layer actually does

1. Open a TCP socket (`net.connect`) or TLS socket (`tls.connect`) to host:port (port defaults to 80/443 from URL scheme).
2. Write a hand-built HTTP/1.1 request:
   ```
   GET /path HTTP/1.1
   Host: example.com
   User-Agent: go2web/1.0 (TCP-socket client)
   Accept: text/html, application/json;q=0.9, */*;q=0.5
   Accept-Encoding: identity
   Connection: close
   ```
3. Read every byte until the server closes the connection.
4. Split header block at `\r\n\r\n`, parse status line + headers manually.
5. If `Transfer-Encoding: chunked`, decode chunks (size in hex, then `size` bytes of data, terminated by `0\r\n\r\n`).
6. Decode body using charset from `Content-Type` (latin-1 / utf-8).

## Cache details

- Key = SHA-256 of `"<accept>::<url>"` so JSON and HTML variants are stored separately.
- Entry stored as JSON: `{ url, storedAt, expiresAt, etag, lastModified, response }`.
- `Cache-Control: no-store` and `private` skip caching entirely.
- Default TTL when no `max-age` is provided: 5 minutes.

## Notes

- The lab forbids HTTP/HTTPS *libraries*. Node's `net` and `tls` are TCP/TLS socket APIs — they don't speak HTTP. The HTTP framing in [src/http.ts](src/http.ts) is written byte-by-byte.
- Search uses `https://html.duckduckgo.com/html/` (the no-JS HTML endpoint), parses `div.result` blocks, and decodes the `/l/?uddg=…` redirect wrapper to get the real target URL.
