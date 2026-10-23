// language: Node.js, file: pool.js
// Account pool — rotation, usage tracking, exhaustion logic

const { db } = require("./db");

const PROMPT_LIMIT = 9; // rotate at 9 to stay safely under eklas's 10 limit

// *pick the account with fewest prompts_used that is still 'ready'*
function getReadyAccount() {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM accounts
       WHERE status = 'ready' AND prompts_used < ?
       ORDER BY prompts_used ASC
       LIMIT 1`,
      [PROMPT_LIMIT],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

// *increment prompt counter — mark exhausted if hitting the limit*
function markAccountUsed(id) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE accounts
       SET prompts_used = prompts_used + 1,
           status = CASE WHEN prompts_used + 1 >= ? THEN 'exhausted' ELSE 'ready' END
       WHERE id = ?`,
      [PROMPT_LIMIT, id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes);
      }
    );
  });
}

// *reset exhausted accounts — called by refresh worker after session refresh*
function resetAccountIfNeeded(id) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE accounts SET prompts_used = 0, status = 'ready' WHERE id = ? AND status = 'exhausted'`,
      [id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes);
      }
    );
  });
}

// *get all accounts that need a session refresh (older than 50 minutes)*
function getStaleAccounts() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM accounts
       WHERE status != 'dead'
       AND (
         last_refresh IS NULL
         OR datetime(last_refresh, '+50 minutes') < datetime('now')
       )`,
      [],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

// *update session after refresh*
function updateAccountSession(id, sessionToken, refreshToken) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE accounts
       SET session_token = ?,
           refresh_token = ?,
           last_refresh  = datetime('now'),
           status        = CASE WHEN status = 'exhausted' THEN 'ready' ELSE status END,
           prompts_used  = CASE WHEN status = 'exhausted' THEN 0 ELSE prompts_used END
       WHERE id = ?`,
      [sessionToken, refreshToken, id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes);
      }
    );
  });
}

// *mark account as dead if login/refresh fully fails*
function markAccountDead(id) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE accounts SET status = 'dead' WHERE id = ?`,
      [id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes);
      }
    );
  });
}

module.exports = {
  getReadyAccount,
  markAccountUsed,
  resetAccountIfNeeded,
  getStaleAccounts,
  updateAccountSession,
  markAccountDead,
};
