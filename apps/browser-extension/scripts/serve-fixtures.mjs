#!/usr/bin/env node

/**
 * Fixture Server for FC-005 (Sprint FC-005)
 *
 * Epistemological Boundary:
 * Minimal HTTP server serving ONLY authorized local synthetic fixture files.
 *
 * Requirements:
 * - Binds strictly to 127.0.0.1 (never 0.0.0.0 or remote addresses).
 * - Listens on port 4173.
 * - Serves ONLY allowlisted paths under /fc005/.
 * - No directory listing.
 * - No repository-root or parent directory access.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const BIND_ADDRESS = "127.0.0.1";
const PORT = 4173;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "../tests/fixtures/fc005");

const ALLOWED_ROUTES = new Map([
  ["/fc005/repository-visibility.html", "repository-visibility.html"],
  ["/fc005/browser-tests.html", "browser-tests.html"],
]);

const server = http.createServer((req, res) => {
  // Only accept GET and HEAD
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return;
  }

  // Parse path without query or hash
  let reqPath = "/";
  try {
    const parsedUrl = new URL(req.url || "/", `http://${BIND_ADDRESS}:${PORT}`);
    reqPath = parsedUrl.pathname;
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad Request");
    return;
  }

  const filename = ALLOWED_ROUTES.get(reqPath);
  if (!filename) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found: Fixture route is not authorized.");
    return;
  }

  const filePath = path.resolve(FIXTURE_DIR, filename);

  // Path traversal defense
  if (!filePath.startsWith(FIXTURE_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error reading fixture file.");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(data);
    }
  });
});

server.listen(PORT, BIND_ADDRESS, () => {
  console.log(`[fixture-server] Listening strictly on http://${BIND_ADDRESS}:${PORT}`);
  console.log(`[fixture-server] Authorized route: http://${BIND_ADDRESS}:${PORT}/fc005/repository-visibility.html`);
});
