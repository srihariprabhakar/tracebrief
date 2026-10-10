const state = {
  cases: [],
  activeCase: null,
  activeTab: "overview",
  uploadFiles: [],
  modelConfigured: false,
};

const el = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[character]);

function toast(message) {
  const element = el("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 2600);
}

async function request(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

function timeAgo(value) {
  const difference = Date.now() - Date.parse(value);
  const minutes = Math.max(0, Math.floor(difference / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function renderCases() {
  el("#case-count").textContent = state.cases.length;
  el("#case-list").innerHTML = state.cases.map((caseFile) => `
    <button class="case-item ${caseFile.id === state.activeCase?.id ? "active" : ""}" data-case-id="${escapeHtml(caseFile.id)}">
      <strong>${escapeHtml(caseFile.title)}</strong>
      <p>${escapeHtml(caseFile.headline)}</p>
      <span class="case-meta"><span>${caseFile.evidenceItems} items</span><span>${timeAgo(caseFile.createdAt)}</span></span>
    </button>
  `).join("");
  document.querySelectorAll("[data-case-id]").forEach((button) => button.addEventListener("click", () => loadCase(button.dataset.caseId)));
}

function citations(items = []) {
  if (!items.length) return "";
  return `<div class="citations">${items.map((item) => `<button class="citation" data-citation="${escapeHtml(item.id)}">${escapeHtml(item.id)} · ${escapeHtml(item.source)}:${item.line}</button>`).join("")}</div>`;
}

function confidence(value) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function metric(value, label, className = "") {
  return `<div class="metric ${className}"><span class="metric-value">${escapeHtml(value)}</span><span class="metric-label">${escapeHtml(label)}</span></div>`;
}

function overview(analysis) {
  const hypothesis = analysis.hypotheses[0];
  const calculation = analysis.calculations;
  const chain = [
    ["01 · change", calculation.replicas ? `Scaled to ${calculation.replicas} replicas` : "Deployment changed", ""],
    ["02 · pressure", calculation.projectedConnections ? `${calculation.projectedConnections} potential DB connections` : "Connection pressure", "danger"],
    ["03 · cascade", "Readiness endpoints removed", "danger"],
    ["04 · impact", "502s reached customers", "danger"],
  ];
  return `
    <section class="section">
      <div class="summary-card">
        <div>
          <span class="eyebrow">Leading hypothesis</span>
          <h2>${escapeHtml(hypothesis.title)}</h2>
          <p>${escapeHtml(analysis.summary.description)}</p>
        </div>
        <div class="confidence" style="--confidence:${Math.round(hypothesis.confidence * 100)}"><span>${confidence(hypothesis.confidence)}</span></div>
      </div>
    </section>
    <section class="section">
      <div class="section-heading"><h2>Probable causal chain</h2><p>Ordered from change to customer impact</p></div>
      <div class="causal-chain">${chain.map(([label, copy, tone]) => `<div class="chain-node ${tone}"><span class="node-top"><span>${label}</span><span>●</span></span><strong>${escapeHtml(copy)}</strong></div>`).join("")}</div>
    </section>
    <section class="section">
      <div class="section-heading"><h2>Established facts</h2><p>Deterministic findings only</p></div>
      <div class="fact-grid">${analysis.facts.map((item) => `
        <article class="fact-card ${escapeHtml(item.tone)}">
          <div class="fact-card-top"><span class="fact-mark">✓</span><h3>${escapeHtml(item.title)}</h3></div>
          <p>${escapeHtml(item.detail)}</p>${citations(item.citations)}
        </article>`).join("")}</div>
    </section>
    <section class="section">
      <div class="security-card"><span class="shield">◈</span><div><strong>Hostile-input boundary active</strong><p>${escapeHtml(analysis.security.notice)} ${escapeHtml(analysis.security.modelBoundary)}</p></div></div>
    </section>
  `;
}

function hypothesisCard(item, isAi = false) {
  return `<article class="hypothesis-card">
    <div class="score">${confidence(item.confidence)}</div>
    <div><h3>${escapeHtml(item.title)} <span class="badge ${isAi ? "ai" : ""}">${isAi ? "AI · cited" : "rule · cited"}</span></h3>
      <p>${escapeHtml(item.explanation)}</p>${citations(item.citations)}</div>
  </article>`;
}

function hypothesesView(analysis) {
  const modelItems = analysis.ai?.hypotheses ?? [];
  return `
    <div class="ai-callout">
      <div><h3>${state.modelConfigured ? "A model is available for a second opinion" : "Optional AI review is not configured"}</h3>
      <p>Only redacted evidence is sent. Claims without valid evidence IDs are discarded before they reach this screen.</p></div>
      <button class="button ${state.modelConfigured ? "primary" : "ghost"}" id="ai-review-button" ${state.modelConfigured ? "" : "disabled"}>${modelItems.length ? "Run again" : "Run AI review"}</button>
    </div>
    ${modelItems.length ? `<section class="section"><div class="section-heading"><h2>Model review</h2><p>${escapeHtml(analysis.ai.summary)}</p></div><div class="hypothesis-list">${modelItems.map((item) => hypothesisCard(item, true)).join("")}</div></section>` : ""}
    <section class="section"><div class="section-heading"><h2>Bounded hypotheses</h2><p>Ranked by evidence strength</p></div><div class="hypothesis-list">${analysis.hypotheses.map((item) => hypothesisCard(item)).join("")}</div></section>
    <section class="section"><div class="section-heading"><h2>Missing evidence</h2><p>What would increase confidence</p></div><div class="checklist">${analysis.missingEvidence.map((item) => `<div class="check-item"><span>○</span>${escapeHtml(item)}</div>`).join("")}</div></section>
    <section class="section"><div class="section-heading"><h2>Next diagnostic moves</h2><p>Review before execution</p></div>${analysis.nextSteps.map((item) => `<div class="command-card"><code>${escapeHtml(item.command)}</code><p>${escapeHtml(item.reason)}</p></div>`).join("")}</section>
  `;
}

function timelineView(analysis) {
  return `<section class="section"><div class="section-heading"><h2>Cross-layer timeline</h2><p>${analysis.timeline.length} timestamped signals</p></div>
    <div class="timeline">${analysis.timeline.map((item) => `<article class="timeline-event ${escapeHtml(item.severity)}">
      <time class="timeline-time">${new Date(item.timestamp).toISOString().slice(11, 23)}</time>
      <span class="component-chip">${escapeHtml(item.component)}</span>
      <span class="timeline-copy" data-citation="${escapeHtml(item.id)}">${escapeHtml(item.text)}</span>
    </article>`).join("")}</div></section>`;
}

function evidenceView(analysis) {
  return `<section class="section"><div class="section-heading"><h2>Evidence ledger</h2><p>Redacted and addressable by line</p></div>
    <table class="evidence-table"><thead><tr><th>ID</th><th>Source</th><th>Component</th><th>Evidence</th></tr></thead>
    <tbody>${analysis.evidence.map((item) => `<tr data-citation="${escapeHtml(item.id)}" class="${item.quarantined ? "quarantined-row" : ""}">
      <td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.source)}:${item.line}</td><td>${escapeHtml(item.component)}</td><td>${escapeHtml(item.text)} ${item.quarantined ? '<span class="quarantine-label"> · QUARANTINED</span>' : ""}</td>
    </tr>`).join("")}</tbody></table></section>`;
}

function renderWorkspace() {
  if (!state.activeCase) return;
  const caseFile = state.activeCase;
  const analysis = caseFile.analysis;
  const views = {
    overview: overview(analysis),
    timeline: timelineView(analysis),
    hypotheses: hypothesesView(analysis),
    evidence: evidenceView(analysis),
  };
  el("#workspace").innerHTML = `<div class="workspace-inner">
    <header class="case-header"><div><span class="eyebrow">Analyzed case · ${new Date(caseFile.createdAt).toLocaleString()}</span><h1>${escapeHtml(caseFile.title)}</h1><p class="case-subtitle">${escapeHtml(analysis.summary.impact)}</p></div><span class="case-id">${escapeHtml(caseFile.id.slice(0, 8))}</span></header>
    ${analysis.stats.quarantinedInstructions ? `<div class="alert-strip"><span class="symbol">⚠</span><span><strong>${analysis.stats.quarantinedInstructions} instruction-like log line quarantined.</strong> It remains visible as evidence but cannot control model behavior.</span></div>` : ""}
    <div class="metric-row">
      ${metric(analysis.stats.sources, "Sources")}${metric(analysis.stats.evidenceItems, "Evidence")}${metric(analysis.stats.facts, "Facts", "accent")}${metric(analysis.stats.redactions, "Redactions")}${metric(analysis.stats.quarantinedInstructions, "Quarantined", analysis.stats.quarantinedInstructions ? "warning" : "")}
    </div>
    <nav class="tabs" aria-label="Case views">
      <button class="tab ${state.activeTab === "overview" ? "active" : ""}" data-tab="overview">Overview</button>
      <button class="tab ${state.activeTab === "timeline" ? "active" : ""}" data-tab="timeline">Timeline <span class="count">${analysis.timeline.length}</span></button>
      <button class="tab ${state.activeTab === "hypotheses" ? "active" : ""}" data-tab="hypotheses">Hypotheses <span class="count">${analysis.hypotheses.length + (analysis.ai?.hypotheses.length ?? 0)}</span></button>
      <button class="tab ${state.activeTab === "evidence" ? "active" : ""}" data-tab="evidence">Evidence <span class="count">${analysis.evidence.length}</span></button>
    </nav>
    <div class="tab-content">${views[state.activeTab]}</div>
  </div>`;
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { state.activeTab = button.dataset.tab; renderWorkspace(); }));
  document.querySelectorAll("[data-citation]").forEach((button) => button.addEventListener("click", () => showEvidence(button.dataset.citation)));
  el("#ai-review-button")?.addEventListener("click", runAiReview);
}

function showEvidence(id) {
  const analysis = state.activeCase.analysis;
  const item = analysis.evidence.find((entry) => entry.id === id);
  if (!item) return;
  const file = analysis.files.find((entry) => entry.name === item.source);
  const lines = file?.content.split(/\r?\n/) ?? [];
  const start = Math.max(0, item.line - 3);
  const end = Math.min(lines.length, item.line + 2);
  el("#evidence-panel").innerHTML = `
    <header class="evidence-header"><div><span class="evidence-source">${escapeHtml(item.id)} · source evidence</span><h2>${escapeHtml(item.source)}:${item.line}</h2></div><button class="icon-button" id="close-evidence" aria-label="Close">×</button></header>
    <div class="evidence-body">
      ${item.quarantined ? '<div class="quarantine-box">⚠ This line contains instruction-like language. It is preserved as evidence but isolated from the model instruction channel.</div>' : ""}
      <div class="evidence-meta"><div class="meta-box"><span>Component</span><strong>${escapeHtml(item.component)}</strong></div><div class="meta-box"><span>Severity</span><strong>${escapeHtml(item.severity)}</strong></div><div class="meta-box"><span>Timestamp</span><strong>${escapeHtml(item.timestamp?.slice(11, 19) ?? "—")}</strong></div><div class="meta-box"><span>Integrity</span><strong>${item.quarantined ? "Quarantined" : "Accepted"}</strong></div></div>
      <div class="source-code">${lines.slice(start, end).map((line, index) => { const lineNumber = start + index + 1; return `<div class="code-line ${lineNumber === item.line ? "selected" : ""}"><span class="line-number">${lineNumber}</span><span class="line-content">${escapeHtml(line)}</span></div>`; }).join("")}</div>
    </div>`;
  el("#evidence-panel").classList.add("open");
  el("#close-evidence").addEventListener("click", closeEvidence);
}

function closeEvidence() {
  el("#evidence-panel").classList.remove("open");
  window.setTimeout(() => { el("#evidence-panel").innerHTML = '<div class="panel-empty"><div class="empty-symbol">⌁</div><strong>Evidence inspector</strong><p>Select a citation to inspect its original context.</p></div>'; }, 180);
}

async function loadCase(id) {
  el("#workspace").innerHTML = '<div class="loading-state"><div class="loader"></div><p>Opening case file…</p></div>';
  try {
    state.activeCase = (await request(`/api/cases/${id}`)).case;
    state.activeTab = "overview";
    renderCases();
    renderWorkspace();
    closeEvidence();
  } catch (error) { toast(error.message); }
}

async function loadApp() {
  try {
    const [health, payload] = await Promise.all([request("/api/health"), request("/api/cases")]);
    state.modelConfigured = health.model.configured;
    const status = el("#model-status");
    status.textContent = health.model.configured ? `${health.model.model} ready` : "AI optional";
    status.classList.toggle("online", health.model.configured);
    state.cases = payload.cases;
    renderCases();
    if (state.cases[0]) await loadCase(state.cases[0].id);
  } catch (error) {
    el("#workspace").innerHTML = `<div class="loading-state"><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function createDemo() {
  const button = el("#demo-button");
  button.disabled = true;
  button.textContent = "Building demo…";
  try {
    const payload = await request("/api/demo", { method: "POST", body: "{}" });
    el("#upload-dialog").close();
    state.cases.unshift({ ...payload.case, headline: payload.case.analysis.summary.headline, evidenceItems: payload.case.analysis.stats.evidenceItems });
    await loadCase(payload.case.id);
    toast("Synthetic incident analyzed");
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = "Use synthetic demo"; }
}

async function submitFiles(event) {
  event.preventDefault();
  if (!state.uploadFiles.length) return toast("Choose at least one evidence file");
  const button = el("#analyze-button");
  button.disabled = true;
  button.textContent = "Analyzing…";
  try {
    const files = await Promise.all(state.uploadFiles.map(async (file) => ({ name: file.name, content: await file.text() })));
    const payload = await request("/api/cases", { method: "POST", body: JSON.stringify({ title: el("#case-title").value, files }) });
    el("#upload-dialog").close();
    state.uploadFiles = [];
    state.cases.unshift({ ...payload.case, headline: payload.case.analysis.summary.headline, evidenceItems: payload.case.analysis.stats.evidenceItems });
    await loadCase(payload.case.id);
    toast("Evidence brief created");
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = "Analyze evidence"; }
}

async function runAiReview() {
  const button = el("#ai-review-button");
  button.disabled = true;
  button.textContent = "Reviewing evidence…";
  try {
    state.activeCase = (await request(`/api/cases/${state.activeCase.id}/ai`, { method: "POST", body: "{}" })).case;
    renderWorkspace();
    toast("Cited model review added");
  } catch (error) { toast(error.message); button.disabled = false; button.textContent = "Run AI review"; }
}

function exportBrief() {
  if (!state.activeCase) return;
  const { title, analysis } = state.activeCase;
  const lines = [
    `# ${title}`, "", `> Generated by TraceBrief on ${new Date(analysis.generatedAt).toLocaleString()}`, "",
    "## Summary", "", analysis.summary.description, "", `**Impact:** ${analysis.summary.impact}`, "",
    "## Established facts", "",
    ...analysis.facts.flatMap((item) => [`- **${item.title}.** ${item.detail}`, `  Evidence: ${item.citations.map((cite) => `${cite.id} (${cite.source}:${cite.line})`).join(", ")}`]), "",
    "## Hypotheses", "",
    ...analysis.hypotheses.flatMap((item) => [`- **${item.title}** (${confidence(item.confidence)})`, `  ${item.explanation}`, `  Evidence: ${item.citations.map((cite) => `${cite.id} (${cite.source}:${cite.line})`).join(", ")}`]), "",
    "## Missing evidence", "", ...analysis.missingEvidence.map((item) => `- ${item}`), "", "## Suggested diagnostic steps", "",
    ...analysis.nextSteps.flatMap((item) => ["```", item.command, "```", item.reason, ""]),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tracebrief"}.md`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  toast("Markdown brief exported");
}

function updateSelectedFiles(files) {
  state.uploadFiles = [...files].slice(0, 30);
  el("#selected-files").innerHTML = state.uploadFiles.map((file) => `<span class="file-chip">${escapeHtml(file.name)} · ${Math.ceil(file.size / 1024)} KB</span>`).join("");
}

el("#new-case-button").addEventListener("click", () => el("#upload-dialog").showModal());
el("#dialog-close-button").addEventListener("click", () => el("#upload-dialog").close());
el("#dialog-cancel-button").addEventListener("click", () => el("#upload-dialog").close());
el("#export-button").addEventListener("click", exportBrief);
el("#demo-button").addEventListener("click", createDemo);
el("#upload-form").addEventListener("submit", submitFiles);
el("#file-input").addEventListener("change", (event) => updateSelectedFiles(event.target.files));
const dropZone = el("#drop-zone");
for (const eventName of ["dragenter", "dragover"]) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); });
for (const eventName of ["dragleave", "drop"]) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); });
dropZone.addEventListener("drop", (event) => updateSelectedFiles(event.dataTransfer.files));

loadApp();
