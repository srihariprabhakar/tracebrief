# Talk outline: Your logs are trying to prompt-inject your incident bot

**Format:** 25-minute technical talk plus 10-minute live demo  
**Audience:** TAMs, support engineers, SREs, platform engineers, and AI application builders

## Abstract

An LLM can summarize a thousand log lines in seconds—but should an investigator trust it? This talk builds a safer incident-analysis assistant from first principles. We treat logs as hostile input, separate facts from hypotheses, redact evidence before inference, and reject every AI claim that cannot cite an exact source line. A live Kubernetes-to-PostgreSQL outage demo shows where deterministic analysis ends, where model reasoning helps, and why a citation is necessary but never sufficient.

## Story arc

### 1. The confident answer problem · 4 minutes

- An incident bundle contains multiple clocks, formats, layers, and red herrings.
- A polished paragraph can obscure weak evidence.
- Operational trust depends on being able to inspect the chain, not merely read the conclusion.

### 2. Logs are hostile input · 5 minutes

- Customer-controlled strings routinely enter application logs.
- Those strings can look like instructions to a language model.
- The key design rule: evidence belongs in the data channel and never gets instruction authority.

### 3. Build the evidence ledger first · 6 minutes

- Preserve source filename and original line number.
- Normalize timestamps without destroying raw context.
- Redact before persistence or model inference.
- Distinguish facts, calculations, hypotheses, and missing evidence.

### 4. The AI trust contract · 5 minutes

- Explicit opt-in to model use.
- Redacted evidence only.
- Structured response with mandatory evidence IDs.
- Fail closed when citations do not resolve.
- Why a valid citation still does not prove a claim.

### 5. Live demo · 10 minutes

1. Open the synthetic checkout incident.
2. Show the 502 errors without revealing the cause.
3. Follow the cross-layer timeline backward through readiness failures and database errors.
4. Inspect the `10 × 20 > 100` connection-budget calculation.
5. Click exact citations in Kubernetes, PostgreSQL, and Nginx sources.
6. Reveal the quarantined prompt-injection string.
7. Run an optional model review and deliberately demo rejection of an invented citation.
8. Export the incident brief.

## Closing message

AI is most useful in an incident when it reduces the cost of inspecting evidence—not when it removes the investigator from the loop. Build provenance before personality, and make uncertainty a first-class output.

## Optional extensions

- Forty-five-minute workshop: attendees add a parser and a deterministic rule.
- TAM version: translating the evidence ledger into a customer-safe incident update.
- Security version: prompt injection, retention, authorization, and model-boundary threat modeling.
