// language: Node.js, file: lovable.js
// Lovable auth via Supabase — login with email+password, refresh access token
// *Lovable's Supabase project ref extracted from their JS bundle*

const SUPABASE_URL = "https://wjzpjloijdaokfdpfcgz.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqenBqbG9pamRhb2tmZHBmY2d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTgxNTY3MDcsImV4cCI6MjAxMzczMjcwN30.Y-Yeo_k0DKb93XMsVLt4j2TbkBGxXdS2LgPP3rKOXo4";

// *sign in with email + password → returns { ok, session_token, refresh_token }*
async function loginAccount(email, password) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok || !data.access_token) {
      return { ok: false, error: data.error_description || data.msg || `HTTP ${res.status}` };
    }

    // *wrap in RS_ENC_v3 format lovable expects on their end*
    const session_token = buildRlSession(data);
    const refresh_token = data.refresh_token;

    return { ok: true, session_token, refresh_token, raw: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// *refresh an existing session using the stored refresh_token*
async function refreshSession(refresh_token) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ refresh_token }),
    });

    const data = await res.json();

    if (!res.ok || !data.access_token) {
      return { ok: false, error: data.error_description || data.msg || `HTTP ${res.status}` };
    }

    const session_token = buildRlSession(data);
    return { ok: true, session_token, refresh_token: data.refresh_token, raw: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// *build the rl_session token format lovable stores in localStorage*
// format: RS_ENC_v3.{base64url(JSON)} — lovable decodes this on their frontend
function buildRlSession(supabaseData) {
  const payload = {
    access_token: supabaseData.access_token,
    refresh_token: supabaseData.refresh_token,
    expires_at: supabaseData.expires_at || Math.floor(Date.now() / 1000) + 3600,
    expires_in: supabaseData.expires_in || 3600,
    token_type: supabaseData.token_type || "bearer",
    user: supabaseData.user || {},
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `RS_ENC_v3.${encoded}`;
}

module.exports = { loginAccount, refreshSession, buildRlSession };
