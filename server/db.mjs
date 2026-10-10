import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openStore(dataDir = "./data") {
  const databasePath = join(dataDir, "tracebrief.db");
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'analyzed',
      created_at TEXT NOT NULL,
      analysis_json TEXT NOT NULL
    );
  `);

  const listStatement = db.prepare(`
    SELECT id, title, status, created_at,
      json_extract(analysis_json, '$.summary.headline') AS headline,
      json_extract(analysis_json, '$.stats.evidenceItems') AS evidence_items
    FROM cases ORDER BY created_at DESC
  `);
  const getStatement = db.prepare("SELECT * FROM cases WHERE id = ?");
  const insertStatement = db.prepare(`
    INSERT INTO cases (id, title, status, created_at, analysis_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  const updateStatement = db.prepare("UPDATE cases SET analysis_json = ? WHERE id = ?");

  return {
    path: databasePath,
    list() {
      return listStatement.all().map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        createdAt: row.created_at,
        headline: row.headline,
        evidenceItems: row.evidence_items,
      }));
    },
    get(id) {
      const row = getStatement.get(id);
      if (!row) return null;
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        createdAt: row.created_at,
        analysis: JSON.parse(row.analysis_json),
      };
    },
    create(caseFile) {
      insertStatement.run(caseFile.id, caseFile.title, caseFile.status, caseFile.createdAt, JSON.stringify(caseFile.analysis));
      return this.get(caseFile.id);
    },
    updateAnalysis(id, analysis) {
      updateStatement.run(JSON.stringify(analysis), id);
      return this.get(id);
    },
    count() {
      return db.prepare("SELECT count(*) AS count FROM cases").get().count;
    },
    close() {
      db.close();
    },
  };
}
