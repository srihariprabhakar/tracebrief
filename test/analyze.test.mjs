import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeBundle, validateModelReport } from "../server/analyze.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const demoDir = join(root, "demo", "incident-bundle");
const names = ["kubernetes-events.log", "nginx-access.log", "checkout-api.log", "postgresql.log", "deployment.yaml", "database.conf"];
const files = names.map((name) => ({ name, content: readFileSync(join(demoDir, name), "utf8") }));

test("demo bundle produces a supported cross-layer hypothesis", () => {
  const result = analyzeBundle(files, { synthetic: true });

  assert.equal(result.calculations.replicas, 10);
  assert.equal(result.calculations.poolSize, 20);
  assert.equal(result.calculations.maxConnections, 100);
  assert.equal(result.calculations.projectedConnections, 200);
  assert.ok(result.hypotheses[0].confidence >= 0.9);
  assert.match(result.hypotheses[0].title, /connection budget/i);
  assert.ok(result.facts.every((fact) => fact.citations.length > 0));
  assert.ok(result.timeline.length >= 10);
  const gatewayFact = result.facts.find((fact) => /gateway errors/i.test(fact.title));
  assert.equal(gatewayFact.detail, "4 evidence lines mention 502–504 responses or upstream failure.");
  assert.ok(gatewayFact.citations.every((item) => item.source === "nginx-access.log"));
  const appTimeout = result.evidence.find((item) => item.id === "E018");
  assert.equal(appTimeout.component, "Checkout API");
});

test("secrets and personal data are redacted before storage", () => {
  const result = analyzeBundle(files);
  const storedText = result.files.map((file) => file.content).join("\n");

  assert.doesNotMatch(storedText, /summer-rain-42/);
  assert.doesNotMatch(storedText, /buyer@example\.com/);
  assert.match(storedText, /\[REDACTED\]/);
  assert.match(storedText, /\[EMAIL REDACTED\]/);
  assert.ok(result.stats.redactions >= 2);
});

test("instruction-like evidence is quarantined, not deleted", () => {
  const result = analyzeBundle(files);
  const unsafe = result.evidence.find((item) => item.text.includes("ignore previous instructions"));

  assert.ok(unsafe);
  assert.equal(unsafe.quarantined, true);
  assert.equal(result.stats.quarantinedInstructions, 1);
});

test("model reports retain only hypotheses with real citations", () => {
  const analysis = analyzeBundle(files);
  const report = validateModelReport({
    summary: "A bounded second opinion.",
    hypotheses: [
      { title: "Supported", confidence: 0.8, explanation: "Has a citation.", citations: ["E001", "MADE_UP"] },
      { title: "Unsupported", confidence: 0.9, explanation: "No valid source.", citations: ["NOT_REAL"] },
    ],
    missingEvidence: ["Pool utilization"],
  }, analysis.evidence);

  assert.equal(report.hypotheses.length, 1);
  assert.deepEqual(report.hypotheses[0].citations.map((item) => item.id), ["E001"]);
});

test("model reports fail closed when no claims can be verified", () => {
  const analysis = analyzeBundle(files);
  assert.throws(() => validateModelReport({
    hypotheses: [{ title: "Guess", confidence: 1, citations: ["NOT_REAL"] }],
  }, analysis.evidence), /no hypotheses with valid evidence citations/i);
});
