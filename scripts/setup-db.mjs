import fs from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

const root = process.cwd();
const databasePath = path.join(root, "prisma", "dev.db");
const sqlPath = path.join(root, "prisma", "init.sql");

await fs.mkdir(path.dirname(databasePath), { recursive: true });
const sql = await fs.readFile(sqlPath, "utf8");

const db = new Database(databasePath);
db.pragma("foreign_keys = ON");
db.exec(sql);

function ensureColumn(tableName, columnName, ddl) {
  const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE "${tableName}" ADD COLUMN ${ddl}`);
  }
}

ensureColumn("GeneratedPaper", "reviewStatus", "\"reviewStatus\" TEXT NOT NULL DEFAULT 'DRAFT'");
ensureColumn("GeneratedPaper", "qualityReportJson", "\"qualityReportJson\" TEXT");
ensureColumn("GeneratedPaper", "approvedAt", "\"approvedAt\" DATETIME");
ensureColumn(
  "GeneratedPaper",
  "updatedAt",
  "\"updatedAt\" DATETIME NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'",
);

db.close();

console.log(`SQLite schema ensured at ${databasePath}`);
