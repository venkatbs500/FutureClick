#!/usr/bin/env node

/**
 * Fixture Server for FutureClick browser extension (FC-005 / FC-006)
 *
 * Epistemological Boundary:
 * Minimal HTTP server serving ONLY authorized local synthetic fixture files.
 *
 * Requirements:
 * - Binds strictly to 127.0.0.1 (never 0.0.0.0 or remote addresses).
 * - Listens on port 4173.
 * - Serves ONLY allowlisted exact fixture paths.
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
const FIXTURES_ROOT = path.resolve(__dirname, "../tests/fixtures");

const ALLOWED_ROUTES = new Map([
  ["/fc005/repository-visibility.html", path.join("fc005", "repository-visibility.html")],
  ["/fc005/browser-tests.html", path.join("fc005", "browser-tests.html")],
  [
    "/fc006/repository-visibility-interception.html",
    path.join("fc006", "repository-visibility-interception.html"),
  ],
  [
    "/fc007/github-settings-visibility.html",
    path.join("fc007", "github-settings-visibility.html"),
  ],
]);

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return;
  }

  let reqPath = "/";
  try {
    const parsedUrl = new URL(req.url || "/", `http://${BIND_ADDRESS}:${PORT}`);
    reqPath = parsedUrl.pathname;
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad Request");
    return;
  }

  const relativeFile = ALLOWED_ROUTES.get(reqPath);
  if (!relativeFile) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found: Fixture route is not authorized.");
    return;
  }

  const filePath = path.resolve(FIXTURES_ROOT, relativeFile);

  if (!filePath.startsWith(FIXTURES_ROOT)) {
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
  console.log(
    `[fixture-server] Authorized route: http://${BIND_ADDRESS}:${PORT}/fc005/repository-visibility.html`,
  );
  console.log(
    `[fixture-server] Authorized route: http://${BIND_ADDRESS}:${PORT}/fc006/repository-visibility-interception.html`,
  );
});
