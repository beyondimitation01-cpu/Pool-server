// language: Node.js, file: index.js, target: any VPS / Railway / Render
// Entry point — spins up Express, loads DB, starts session refresh worker

const express = require("express");
const cors = require("cors");
const { db, initDB } = require("./db");
const { getReadyAccount, markAccountUsed, resetAccountIfNeeded } = require("./pool");
const { startRefreshWorker } = require("./refresh");
const { loginAccount } = require("./lovable");

const app = express();
app.use(cors());
app.use(express.json());

const API_SECRET = process.env.API_SECRET || "changeme123";

// *middleware — all routes require X-API-Secret header*
function auth(req, res, next) {
  if (req.headers["x-api-secret"] !== API_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

// ── GET /session ────────────────────────────────────────────────────────────
// Extension calls this when eklas rate-limits. Returns a fresh account session.
app.get("/session", auth, async (req, res) => {
  try {
    const account = await getReadyAccount();
    if (!account) {
      return res.status(503).json({ ok: false, error: "Pool exhausted. Add more accounts." });
    }
    await markAccountUsed(account.id);
    res.json({
      ok: true,
      session: account.session_token,
      email: account.email,
      account_id: account.id,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /accounts ───────────────────────────────────────────────────────────
// Add a new lovable account to the pool manually
app.post("/accounts", auth, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "email and password required" });
  }
  try {
    const result = await loginAccount(email, password);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    db.run(
      `INSERT INTO accounts (email, password, session_token, refresh_token, prompts_used, last_refresh, status)
       VALUES (?, ?, ?, ?, 0, datetime('now'), 'ready')
       ON CONFLICT(email) DO UPDATE SET
         password=excluded.password,
         session_token=excluded.session_token,
         refresh_token=excluded.refresh_token,
         last_refresh=excluded.last_refresh,
         status='ready',
         prompts_used=0`,
      [email, password, result.session_token, result.refresh_token],
      function (err) {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        res.json({ ok: true, message: `Account ${email} added to pool`, id: this.lastID });
      }
    );
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /accounts ────────────────────────────────────────────────────────────
// Dashboard — see pool status
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

// ── DELETE /accounts/:id ──────────────────────────────────────────────────────
// Remove an account from pool
app.delete("/accounts/:id", auth, (req, res) => {
  db.run(`DELETE FROM accounts WHERE id = ?`, [req.params.id], function (err) {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true, deleted: this.changes });
  });
});

// ── POST /accounts/:id/reset ──────────────────────────────────────────────────
// Manually reset prompt counter for an account
app.post("/accounts/:id/reset", auth, (req, res) => {
  db.run(
    `UPDATE accounts SET prompts_used = 0, status = 'ready' WHERE id = ?`,
    [req.params.id],
    function (err) {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      res.json({ ok: true, reset: this.changes });
    }
  );
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// boot
initDB(() => {
  startRefreshWorker();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`[pool-server] listening on :${PORT}`));
});
