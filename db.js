// language: Node.js, file: db.js
// SQLite3 wrapper — single file DB, zero config, persists on disk

const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "pool.db");
const db = new sqlite3.Database(DB_PATH);

function initDB(cb) {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS accounts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT    UNIQUE NOT NULL,
        password      TEXT    NOT NULL,
        session_token TEXT    NOT NULL,
        refresh_token TEXT    NOT NULL,
        prompts_used  INTEGER DEFAULT 0,
        last_refresh  TEXT    DEFAULT (datetime('now')),
        status        TEXT    DEFAULT 'ready'
        -- status: 'ready' | 'exhausted' | 'dead'
      )
    `, (err) => {
      if (err) throw err;
      console.log("[db] accounts table ready");
      if (cb) cb();
    });
  });
}

module.exports = { db, initDB };
