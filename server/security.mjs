const rules = [
  {
    kind: "database credential",
    pattern: /(postgres(?:ql)?:\/\/[^:\s/]+:)([^@\s]+)(@)/gi,
    replacement: "$1[REDACTED]$3",
  },
  {
    kind: "bearer token",
    pattern: /(bearer\s+)[a-z0-9._~+/=-]{12,}/gi,
    replacement: "$1[REDACTED]",
  },
  {
    kind: "secret value",
    pattern: /((?:password|passwd|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*["']?)([^\s,"']+)/gi,
    replacement: "$1[REDACTED]",
  },
  {
    kind: "email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[EMAIL REDACTED]",
  },
];

const instructionPatterns = [
  /ignore (?:all |any )?(?:previous|prior|system) instructions?/i,
  /reveal (?:the )?(?:system|developer) prompt/i,
  /(?:system|assistant|developer)\s*:/i,
  /<\|(?:system|assistant|user)\|>/i,
  /you are (?:chatgpt|an ai|a language model)/i,
];

export function redactDocument(content) {
  let redacted = String(content ?? "");
  const findings = [];

  for (const rule of rules) {
    let matches = 0;
    redacted = redacted.replace(rule.pattern, (...args) => {
      matches += 1;
      if (typeof rule.replacement === "function") return rule.replacement(...args);
      return rule.replacement.replace(/\$(\d)/g, (_, index) => args[Number(index)] ?? "");
    });
    if (matches) findings.push({ kind: rule.kind, count: matches });
  }

  return { content: redacted, findings };
}

export function containsInstructionLikeText(line) {
  return instructionPatterns.some((pattern) => pattern.test(line));
}

export function sanitizeFilename(name) {
  return String(name ?? "evidence.txt")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}
