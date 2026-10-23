// language: Node.js, file: refresh.js
// Background worker — refreshes sessions every 50 minutes before they expire (1hr TTL)
// also re-enables exhausted accounts after refresh (new session = new eklas identity)

const { getStaleAccounts, updateAccountSession, markAccountDead } = require("./pool");
const { refreshSession, loginAccount } = require("./lovable");
const { db } = require("./db");

const REFRESH_INTERVAL_MS = 50 * 60 * 1000; // 50 minutes
const CHECK_INTERVAL_MS   = 5  * 60 * 1000; // check every 5 minutes

async function refreshAll() {
  let stale;
  try {
    stale = await getStaleAccounts();
  } catch (err) {
    console.error("[refresh] failed to fetch stale accounts:", err.message);
    return;
  }

  if (!stale.length) {
    console.log("[refresh] all sessions fresh, nothing to do");
    return;
  }

  console.log(`[refresh] refreshing ${stale.length} stale account(s)`);

  for (const account of stale) {
    let result = await refreshSession(account.refresh_token);

    // *if refresh token itself expired, fall back to email+password login*
    if (!result.ok) {
      console.warn(`[refresh] token refresh failed for ${account.email}, trying password login`);
      result = await loginAccount(account.email, account.password);
    }

    if (result.ok) {
      await updateAccountSession(account.id, result.session_token, result.refresh_token);
      console.log(`[refresh] ✓ ${account.email} — session refreshed, prompts reset`);
    } else {
      console.error(`[refresh] ✗ ${account.email} — ${result.error} — marking dead`);
      await markAccountDead(account.id);
    }

    // *small delay between accounts to avoid hammering supabase*
    await sleep(500);
  }
}

function startRefreshWorker() {
  console.log("[refresh] worker started — checking every 5 minutes");

  // run immediately on boot to ensure all sessions are fresh
  refreshAll().catch(console.error);

  // then on interval
  setInterval(() => {
    refreshAll().catch(console.error);
  }, CHECK_INTERVAL_MS);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { startRefreshWorker, refreshAll };
