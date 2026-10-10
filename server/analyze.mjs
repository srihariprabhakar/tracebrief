import { containsInstructionLikeText, redactDocument, sanitizeFilename } from "./security.mjs";

const timestampPatterns = [
  /\b(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\b/,
  /\b(20\d{2}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:?\d{2})?)\b/,
];

function timestampFrom(line) {
  for (const pattern of timestampPatterns) {
    const match = line.match(pattern);
    if (match) {
      const parsed = Date.parse(match[1].replace(" ", "T"));
      if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    }
  }
  return null;
}

function severityFrom(line) {
  if (/\b(?:fatal|panic|critical)\b/i.test(line)) return "critical";
  if (/\b(?:error|failed|failure|unhealthy|502|503|504)\b/i.test(line)) return "error";
  if (/\b(?:warn|warning|backoff)\b/i.test(line)) return "warning";
  return "info";
}

function componentFrom(filename, line) {
  const source = filename.toLowerCase();
  if (/nginx|proxy|gateway/.test(source)) return "Nginx";
  if (/postgres|database|(^|[._-])db([._-]|$)/.test(source)) return "PostgreSQL";
  if (/kube|k8s|deployment|service|ingress|helm/.test(source)) return "Kubernetes";
  if (/checkout|application|(^|[._-])app([._-]|$)/.test(source)) return "Checkout API";

  const value = line.toLowerCase();
  if (/nginx|upstream|gateway/.test(value)) return "Nginx";
  if (/postgres|pg_|database|db[_ -]|connection pool/.test(value)) return "PostgreSQL";
  if (/k8s|kube|pod|deployment|replicaset|readiness|liveness/.test(value)) return "Kubernetes";
  if (/checkout|application|app\.|node/.test(value)) return "Checkout API";
  return "Platform";
}

function tagsFrom(line) {
  const tags = [];
  const tests = [
    ["gateway-error", /\b50[234]\b|bad gateway|upstream.*(?:fail|timeout)/i],
    ["db-exhaustion", /too many clients|remaining connection slots|connection limit|pool.*(?:exhaust|timeout)/i],
    ["readiness", /readiness|unready|health check.*fail/i],
    ["scale", /scaled|scaling|replicas?\s*[:=]|desired.*replica/i],
    ["pool-size", /db_pool_size|pool[_ -]?size|max(?:imum)? pool/i],
    ["max-connections", /max_connections|max connections/i],
    ["deploy", /deploy|rollout|image.*v\d/i],
  ];
  for (const [tag, pattern] of tests) if (pattern.test(line)) tags.push(tag);
  return tags;
}

function asNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function citation(evidence) {
  return { id: evidence.id, source: evidence.source, line: evidence.line };
}

function firstWithTag(evidence, tag) {
  return evidence.find((item) => item.tags.includes(tag));
}

function allWithTag(evidence, tag) {
  return evidence.filter((item) => item.tags.includes(tag));
}

function fact(id, title, detail, items, tone = "neutral") {
  return {
    id,
    title,
    detail,
    tone,
    citations: items.filter(Boolean).map(citation),
  };
}

export function analyzeBundle(inputFiles, options = {}) {
  const files = [];
  const evidence = [];
  const redactionSummary = new Map();
  let instructionCount = 0;

  for (const rawFile of inputFiles.slice(0, 30)) {
    const name = sanitizeFilename(rawFile.name);
    const { content, findings } = redactDocument(rawFile.content);
    for (const finding of findings) {
      redactionSummary.set(finding.kind, (redactionSummary.get(finding.kind) ?? 0) + finding.count);
    }

    const file = { name, content, bytes: Buffer.byteLength(content), lineCount: content.split(/\r?\n/).length };
    files.push(file);

    content.split(/\r?\n/).forEach((text, index) => {
      if (!text.trim()) return;
      const quarantined = containsInstructionLikeText(text);
      if (quarantined) instructionCount += 1;
      const component = componentFrom(name, text);
      const tags = tagsFrom(text).filter((tag) => tag !== "gateway-error" || component === "Nginx");
      evidence.push({
        id: `E${String(evidence.length + 1).padStart(3, "0")}`,
        source: name,
        line: index + 1,
        text: text.slice(0, 1600),
        timestamp: timestampFrom(text),
        severity: severityFrom(text),
        component,
        tags,
        quarantined,
      });
    });
  }

  const gateway = allWithTag(evidence, "gateway-error");
  const dbExhaustion = allWithTag(evidence, "db-exhaustion");
  const readiness = allWithTag(evidence, "readiness");
  const scale = allWithTag(evidence, "scale");
  const poolEvidence = firstWithTag(evidence, "pool-size");
  const maxEvidence = firstWithTag(evidence, "max-connections");
  const deploy = allWithTag(evidence, "deploy");

  const combined = evidence.map((item) => item.text).join("\n");
  const replicas = asNumber(combined, [
    /replicas?\s*[:=]\s*["']?(\d+)/i,
    /scaled\s+(?:deployment\s+)?\S+\s+(?:from\s+\d+\s+)?to\s+(\d+)/i,
  ]);
  const poolSize = asNumber(combined, [
    /DB_POOL_SIZE["']?\s*[:=]\s*["']?(\d+)/i,
    /pool[_ -]?size\s*[:=]\s*(\d+)/i,
  ]);
  const maxConnections = asNumber(combined, [/max_connections\s*[:=]\s*(\d+)/i, /max connections\s*[:=]\s*(\d+)/i]);
  const projectedConnections = replicas && poolSize ? replicas * poolSize : null;

  const facts = [];
  if (deploy.length) facts.push(fact("F1", "A deployment or scale event preceded the failure", "The bundle records a rollout or replica change in the incident window.", deploy.slice(0, 3)));
  if (dbExhaustion.length) facts.push(fact("F2", "PostgreSQL rejected connections", "Database evidence explicitly reports exhausted connection capacity.", dbExhaustion.slice(0, 3), "danger"));
  if (readiness.length) facts.push(fact("F3", "Application readiness degraded", "Health or readiness checks failed while database connectivity was impaired.", readiness.slice(0, 3), "warning"));
  if (gateway.length) facts.push(fact("F4", "Users received gateway errors", `${gateway.length} evidence line${gateway.length === 1 ? "" : "s"} mention 502–504 responses or upstream failure.`, gateway.slice(0, 4), "danger"));
  if (poolEvidence && maxEvidence && projectedConnections) {
    facts.push(fact("F5", "Configured pool demand exceeded database capacity", `${replicas} replicas × ${poolSize} connections = ${projectedConnections} potential connections, compared with max_connections=${maxConnections}.`, [poolEvidence, maxEvidence, scale[0]], projectedConnections > maxConnections ? "danger" : "neutral"));
  }

  const hypotheses = [];
  if (dbExhaustion.length) {
    const math = projectedConnections && maxConnections
      ? `The configuration permits ${projectedConnections} application connections against a ${maxConnections}-connection database ceiling.`
      : "Multiple layers independently report connection exhaustion.";
    hypotheses.push({
      id: "H1",
      title: "Scale-out exhausted the database connection budget",
      confidence: projectedConnections > maxConnections ? 0.96 : 0.88,
      explanation: `${math} The timing and cross-layer symptoms support database saturation as the initiating failure.`,
      status: "supported",
      citations: [scale[0], poolEvidence, maxEvidence, dbExhaustion[0]].filter(Boolean).map(citation),
    });
  }
  if (readiness.length && gateway.length) {
    hypotheses.push({
      id: "H2",
      title: "Strict readiness checks amplified the outage",
      confidence: 0.82,
      explanation: "Database-dependent readiness failures removed application endpoints, leaving Nginx without healthy upstreams and widening the customer impact.",
      status: "supported",
      citations: [readiness[0], gateway[0]].map(citation),
    });
  }
  if (!hypotheses.length) {
    hypotheses.push({
      id: "H1",
      title: "The current bundle is insufficient for a bounded root-cause hypothesis",
      confidence: 0.34,
      explanation: "TraceBrief found evidence, but no supported cross-layer causal chain. Gather the missing evidence before drawing a conclusion.",
      status: "needs-evidence",
      citations: evidence.slice(0, 2).map(citation),
    });
  }

  const timeline = evidence
    .filter((item) => item.timestamp && (item.severity !== "info" || item.tags.length))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(0, 80)
    .map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      component: item.component,
      severity: item.severity,
      text: item.text,
      citation: citation(item),
    }));

  const redactionCount = [...redactionSummary.values()].reduce((sum, count) => sum + count, 0);
  const earliest = timeline[0]?.timestamp ?? null;
  const latest = timeline.at(-1)?.timestamp ?? null;
  const components = [...new Set(evidence.map((item) => item.component))];

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    engine: "deterministic",
    summary: {
      headline: hypotheses[0].title,
      description: dbExhaustion.length
        ? "A deployment increased aggregate database demand beyond available capacity. Connection failures then cascaded through readiness checks to the edge proxy."
        : "TraceBrief organized the supplied evidence but needs more signal before identifying a likely initiating failure.",
      impact: gateway.length ? "Customer requests failed at the Nginx edge." : "Impact is not established by the supplied evidence.",
      window: earliest && latest ? { start: earliest, end: latest } : null,
    },
    stats: {
      sources: files.length,
      evidenceItems: evidence.length,
      facts: facts.length,
      hypotheses: hypotheses.length,
      redactions: redactionCount,
      quarantinedInstructions: instructionCount,
      components: components.length,
    },
    calculations: { replicas, poolSize, maxConnections, projectedConnections },
    redactions: [...redactionSummary].map(([kind, count]) => ({ kind, count })),
    facts,
    hypotheses,
    timeline,
    evidence,
    topology: {
      nodes: ["Client", ...components.filter((name) => name !== "Platform")],
      edges: [
        ["Client", "Nginx"],
        ["Nginx", "Kubernetes"],
        ["Kubernetes", "Checkout API"],
        ["Checkout API", "PostgreSQL"],
      ],
    },
    missingEvidence: [
      "A pg_stat_activity snapshot grouped by application_name during the incident",
      "The deployment diff and rollout timestamps for the affected release",
      "Connection acquisition latency and pool utilization before saturation",
      "Request volume and retry rate across the same incident window",
    ],
    nextSteps: [
      { command: "kubectl -n shop get deploy,pods,events --sort-by=.metadata.creationTimestamp", reason: "Confirm rollout and readiness timing." },
      { command: "kubectl -n shop logs deploy/checkout-api --since=30m --prefix", reason: "Correlate pool timeouts across replicas." },
      { command: "SELECT application_name, state, count(*) FROM pg_stat_activity GROUP BY 1,2 ORDER BY 3 DESC;", reason: "Measure connection ownership before changing limits." },
      { command: "kubectl -n shop set env deploy/checkout-api DB_POOL_SIZE=8", reason: "Candidate mitigation; validate against traffic and workload concurrency first." },
    ],
    security: {
      modelBoundary: "Only redacted evidence may cross the model boundary.",
      quarantinedInstructions: instructionCount,
      notice: instructionCount
        ? "Instruction-like text was found inside evidence and marked as untrusted data."
        : "No instruction-like evidence was detected.",
    },
    files,
    options,
  };
}

export function validateModelReport(report, evidence) {
  const allowed = new Set(evidence.map((item) => item.id));
  const hypotheses = Array.isArray(report?.hypotheses) ? report.hypotheses : [];
  const validHypotheses = hypotheses
    .filter((item) => item && typeof item.title === "string" && Array.isArray(item.citations))
    .map((item, index) => ({
      id: `AI${index + 1}`,
      title: item.title.slice(0, 180),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      explanation: String(item.explanation ?? "").slice(0, 1200),
      status: "model-generated",
      citations: [...new Set(item.citations)].filter((id) => allowed.has(id)).map((id) => {
        const match = evidence.find((entry) => entry.id === id);
        return citation(match);
      }),
    }))
    .filter((item) => item.citations.length > 0);

  if (!validHypotheses.length) throw new Error("The model returned no hypotheses with valid evidence citations.");
  return {
    generatedAt: new Date().toISOString(),
    summary: String(report.summary ?? "").slice(0, 1600),
    hypotheses: validHypotheses,
    missingEvidence: Array.isArray(report.missingEvidence)
      ? report.missingEvidence.slice(0, 8).map((item) => String(item).slice(0, 240))
      : [],
  };
}
