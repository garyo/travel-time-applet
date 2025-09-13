#!/usr/bin/env bun

/**
 * Local development server that serves the HTML file with API URLs rewritten to localhost
 * Usage: bun run dev-server.js [port]
 */

import { serve } from "bun";
import { readFile } from "fs/promises";
import { join } from "path";

const PORT = parseInt(process.argv[2]) || 3000;
const HTML_PATH = join(process.cwd(), "../public/index.html");
const PRODUCTION_URL = "https://travel-time-worker.garyo.workers.dev";
const LOCAL_URL = "http://localhost:8787";

console.log(`🌐 Starting development server on http://localhost:${PORT}`);
console.log(`📝 Serving HTML from: ${HTML_PATH}`);
console.log(`🔄 Rewriting API calls: ${PRODUCTION_URL} → ${LOCAL_URL}`);

const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve the main HTML file with URL rewriting
    if (url.pathname === "/" || url.pathname === "/index.html") {
      try {
        const htmlContent = await readFile(HTML_PATH, "utf-8");

        // Replace production URLs with local URLs
        const rewrittenHtml = htmlContent.replace(
          new RegExp(PRODUCTION_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          LOCAL_URL
        );

        return new Response(rewrittenHtml, {
          headers: {
            "Content-Type": "text/html",
            "Cache-Control": "no-cache"
          }
        });
      } catch (error) {
        return new Response(`Error reading HTML file: ${error.message}`, {
          status: 500,
          headers: { "Content-Type": "text/plain" }
        });
      }
    }

    // Serve other static files if needed
    if (url.pathname.startsWith("/public/")) {
      try {
        const filePath = join(process.cwd(), "..", url.pathname);
        const file = Bun.file(filePath);

        if (await file.exists()) {
          return new Response(file);
        }
      } catch (error) {
        // Fall through to 404
      }
    }

    return new Response("Not Found", { status: 404 });
  }
});

console.log(`✅ Server running at http://localhost:${PORT}`);
console.log(`   Open in browser and the API calls will automatically use the local worker`);
console.log(`   Make sure your worker is running: bun run dev`);