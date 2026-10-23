const express = require("express");
const cors = require("cors");
const { db, initDB } = require("./db");
const { getReadyAccount, markAccountUsed } = require("./pool");
const { startRefreshWorker } = require("./refresh");
const { loginAccount } = require("./lovable");

const app = express();
app.use(cors());
app.use(express.json());

const API_SECRET = process.env.API_SECRET || "changeme123";

// accepts secret from header OR query param so browser URL bar works
function auth(req, res, next) {
  const secret = req.headers["x-api-secret"] || req.query.secret;
  if (secret !== API_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

// ── GET /add?secret=xxx&email=xxx&password=xxx ───────────────────────────────
// add account straight from browser URL bar — no console, no fetch
app.get("/add", auth, async (req, res) => {
  const { email, password } = req.query;
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "email and password required" });
  }
  const result = await loginAccount(email, password);
  if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
  db.run(
    `INSERT INTO accounts (email, password, session_token, refresh_token, prompts_used, last_refresh, status)
     VALUES (?, ?, ?, ?, 0, datetime('now'), 'ready')
     ON CONFLICT(email) DO UPDATE SET
       password=excluded.password, session_token=excluded.session_token,
       refresh_token=excluded.refresh_token, last_refresh=excluded.last_refresh,
       status='ready', prompts_used=0`,
    [email, password, result.session_token, result.refresh_token],
    function (err) {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      res.json({ ok: true, message: `${email} added to pool`, id: this.lastID });
    }
  );
});

// ── GET /session?secret=xxx ──────────────────────────────────────────────────
// extension calls this when rate limited — returns fresh session
app.get("/session", auth, async (req, res) => {
  const account = await getReadyAccount();
  if (!account) return res.status(503).json({ ok: false, error: "Pool exhausted. Add more accounts." });
  await markAccountUsed(account.id);
  res.json({ ok: true, session: account.session_token, email: account.email });
});

// ── GET /accounts?secret=xxx ─────────────────────────────────────────────────
// view all accounts and their status
app.get("/accounts", auth, (req, res) => {
  db.all(
    `SELECT id, email, prompts_used, status, last_refresh FROM accounts ORDER BY prompts_used ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      res.json({ ok: true, total: rows.length, accounts: rows });
    }
  );
});

// ── GET /reset/:id?secret=xxx ────────────────────────────────────────────────
// manually reset prompt counter for an account
app.get("/reset/:id", auth, (req, res) => {
  db.run(
    `UPDATE accounts SET prompts_used = 0, status = 'ready' WHERE id = ?`,
    [req.params.id],
    function (err) {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      res.json({ ok: true, reset: this.changes });
    }
  );
});

// ── GET /delete/:id?secret=xxx ───────────────────────────────────────────────
// remove an account from pool
app.get("/delete/:id", auth, (req, res) => {
  db.run(
    `DELETE FROM accounts WHERE id = ?`,
    [req.params.id],
    function (err) {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      res.json({ ok: true, deleted: this.changes });
    }
  );
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

initDB(() => {
  startRefreshWorker();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`[pool-server] :${PORT}`));
});
