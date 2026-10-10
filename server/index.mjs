import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { analyzeBundle } from "./analyze.mjs";
import { modelConfiguration, runModelReview } from "./ai.mjs";
import { openStore } from "./db.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(root, "public");
const demoDir = join(root, "demo", "incident-bundle");
const port = Number(process.env.PORT ?? 8787);
const store = openStore(process.env.DATA_DIR ?? join(root, "data"));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) {
      const error = new Error("Request exceeds the 8 MB limit.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function loadDemoFiles() {
  return ["kubernetes-events.log", "nginx-access.log", "checkout-api.log", "postgresql.log", "deployment.yaml", "database.conf"]
    .map((name) => ({ name, content: readFileSync(join(demoDir, name), "utf8") }));
}

function createCase(title, files, options = {}) {
  const analysis = analyzeBundle(files, options);
  return store.create({
    id: randomUUID(),
    title: String(title || "Untitled incident").trim().slice(0, 120),
    status: "analyzed",
    createdAt: new Date().toISOString(),
    analysis,
  });
}

if (store.count() === 0) createCase("Checkout outage · Demo", loadDemoFiles(), { synthetic: true });

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json(response, 200, { status: "ok", model: modelConfiguration(), database: "sqlite" });
  }
  if (request.method === "GET" && url.pathname === "/api/cases") return json(response, 200, { cases: store.list() });

  if (request.method === "POST" && url.pathname === "/api/cases") {
    const body = await readJson(request);
    if (!Array.isArray(body.files) || body.files.length === 0) return json(response, 422, { error: "Add at least one evidence file." });
    const files = body.files.slice(0, 30).map((file) => ({ name: file.name, content: String(file.content ?? "").slice(0, 1_000_000) }));
    return json(response, 201, { case: createCase(body.title, files) });
  }

  if (request.method === "POST" && url.pathname === "/api/demo") {
    return json(response, 201, { case: createCase("Checkout outage · Demo", loadDemoFiles(), { synthetic: true }) });
  }

  const match = url.pathname.match(/^\/api\/cases\/([^/]+)$/);
  if (request.method === "GET" && match) {
    const caseFile = store.get(match[1]);
    return caseFile ? json(response, 200, { case: caseFile }) : json(response, 404, { error: "Case not found." });
  }

  const aiMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/ai$/);
  if (request.method === "POST" && aiMatch) {
    const caseFile = store.get(aiMatch[1]);
    if (!caseFile) return json(response, 404, { error: "Case not found." });
    const modelReport = await runModelReview(caseFile.analysis);
    caseFile.analysis.ai = modelReport;
    return json(response, 200, { case: store.updateAnalysis(caseFile.id, caseFile.analysis) });
  }

  return json(response, 404, { error: "API route not found." });
}

function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = normalize(join(publicDir, requested));
  if (!resolved.startsWith(publicDir) || !existsSync(resolved)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    return response.end("Not found");
  }
  response.writeHead(200, {
    "content-type": mimeTypes[extname(resolved)] ?? "application/octet-stream",
    "cache-control": [".html", ".js", ".css"].includes(extname(resolved)) ? "no-cache" : "public, max-age=300",
  });
  response.end(readFileSync(resolved));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(request, response, url);
    else serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    json(response, error.statusCode ?? 500, { error: error.message ?? "Unexpected server error." });
  }
});

server.listen(port, () => {
  console.log(`TraceBrief is listening on http://localhost:${port}`);
  console.log(`Evidence database: ${store.path}`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
