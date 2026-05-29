const { createClient } = require("@supabase/supabase-js");

// Primary redirect URI comes from LINKEDIN_REDIRECT_URI env var (must match LinkedIn Developer Portal EXACTLY).
// The frontend also embeds the URI it used in the OAuth state param so they always stay in sync.
const DEFAULT_REDIRECT_URI =
  process.env.LINKEDIN_REDIRECT_URI ||
  "https://linkedin-saas-git-dev-hrudai.vercel.app/api/linkedin/callback";

// FRONTEND_APP_URL can be set in Vercel env vars; falls back to the primary deployment domain.
const FRONTEND_BASE =
  process.env.FRONTEND_APP_URL ||
  "https://linkedin-saas-git-dev-hrudai.vercel.app";

const ALLOWED_ORIGINS = [
  "https://linkedin-saas-git-dev-hrudai.vercel.app",
  "https://linkedin-saas-three.vercel.app",
  "https://linkedin-theta-seven.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function redirect(res, status, url) {
  res.writeHead(status, { Location: url });
  res.end();
}

// Strip accidental "KEY=value" format from Vercel env var values
function stripKeyPrefix(raw) {
  const s = (raw || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]+$/.test(s.slice(0, eq))) {
    return s.slice(eq + 1).trim();
  }
  return s;
}

async function handler(req, res) {
  let appOrigin = FRONTEND_BASE;
  let returnPath = "/app/profile-setup";

  const makeSuccessUrl = () => `${appOrigin}/#${returnPath}?linkedin=connected`;
  const makeErrorUrl = (code = "linkedin_failed", detail = "") =>
    `${appOrigin}/#/app/profile-setup?linkedin_error=${encodeURIComponent(code)}${detail ? `&msg=${encodeURIComponent(detail)}` : ""}`;

  try {
    if (req.method !== "GET") {
      redirect(res, 302, makeErrorUrl("method_not_allowed"));
      return;
    }

    const code = req.query.code;
    const state = req.query.state;

    if (req.query.error) {
      console.error("[LinkedIn callback] LinkedIn error:", req.query.error, req.query.error_description);
      redirect(res, 302, makeErrorUrl("linkedin_denied", req.query.error_description || req.query.error));
      return;
    }

    if (!code) {
      redirect(res, 302, makeErrorUrl("no_code"));
      return;
    }

    if (!state) {
      console.error("[LinkedIn callback] No state found");
      redirect(res, 302, makeErrorUrl("no_state"));
      return;
    }

    // --- Parse state ---
    let userEmail = null;
    let userId = null;
    let stateRedirectUri = null;
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
      userEmail = (decoded && decoded.email) || null;
      userId = (decoded && decoded.userId) || null;
      // Frontend embeds the redirect URI it used in the state so token exchange always matches
      stateRedirectUri = (decoded && typeof decoded.redirectUri === "string" && decoded.redirectUri.startsWith("https://"))
        ? decoded.redirectUri : null;

      if (decoded.appOrigin && ALLOWED_ORIGINS.includes(decoded.appOrigin)) {
        appOrigin = decoded.appOrigin;
      }
      if (decoded.returnPath && decoded.returnPath.startsWith("/")) {
        returnPath = decoded.returnPath;
      }
    } catch (e) {
      console.error("[LinkedIn callback] Invalid state:", e.message);
      redirect(res, 302, makeErrorUrl("bad_state"));
      return;
    }
    console.log("[LinkedIn callback] Callback URL:", req.url);
    console.log("[LinkedIn callback] Authorization code present:", !!code, "Code length:", code ? code.length : 0);

    if (!userId && !userEmail) {
      console.error("[LinkedIn callback] No userId or email in state");
      redirect(res, 302, makeErrorUrl("no_identity"));
      return;
    }

    // --- Resolve env vars ---
    const supabaseUrl = stripKeyPrefix(
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      ""
    ).replace(/\/$/, "");
    const serviceKey = stripKeyPrefix(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const clientId = stripKeyPrefix(process.env.LINKEDIN_CLIENT_ID);
    const clientSecret = stripKeyPrefix(process.env.LINKEDIN_CLIENT_SECRET);

    const missing = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!clientId) missing.push("LINKEDIN_CLIENT_ID");
    if (!clientSecret) missing.push("LINKEDIN_CLIENT_SECRET");

    if (missing.length > 0) {
      console.error("[LinkedIn callback] Missing env vars:", missing.join(", "));
      redirect(res, 302, makeErrorUrl("config_error", `Missing: ${missing.join(", ")}`));
      return;
    }

    const projectId = supabaseUrl.replace("https://", "").split(".")[0];
    console.log("[LinkedIn callback] State — userId:", userId, "email:", userEmail, "project:", projectId);

    // --- Step 1: Verify the user ID against auth.users BEFORE consuming the OAuth code ---
    // This ensures we use the REAL auth.users.id and prevents FK violations on upsert.
    let resolvedUserId = null;

    if (userId && typeof userId === "string" && userId.trim()) {
      const uId = userId.trim();
      console.log("[LinkedIn callback] Verifying userId against auth.users:", uId);
      const verifyRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uId}`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      console.log("[LinkedIn callback] Auth admin verify status:", verifyRes.status);
      if (verifyRes.ok) {
        const verifyData = await verifyRes.json().catch(() => ({}));
        resolvedUserId = verifyData?.id ?? null;
        console.log("[LinkedIn callback] Verified auth user:", JSON.stringify({
          id: verifyData?.id,
          email: verifyData?.email,
          created_at: verifyData?.created_at,
        }));
      } else {
        const body = await verifyRes.text().catch(() => "");
        console.warn("[LinkedIn callback] userId not found in auth.users, status:", verifyRes.status, body.slice(0, 200));
      }
    }

    // Fallback: look up by email via admin API
    if (!resolvedUserId && userEmail) {
      console.log("[LinkedIn callback] Falling back to email lookup:", userEmail);
      const emailLookup = await fetch(
        `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(userEmail.trim())}`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      );
      console.log("[LinkedIn callback] Email lookup status:", emailLookup.status);
      if (emailLookup.ok) {
        const emailData = await emailLookup.json().catch(() => ({}));
        resolvedUserId = emailData?.users?.[0]?.id ?? null;
        console.log("[LinkedIn callback] Resolved userId via email:", resolvedUserId, "total users found:", emailData?.users?.length);
      } else {
        const body = await emailLookup.text().catch(() => "");
        console.warn("[LinkedIn callback] Email lookup failed:", emailLookup.status, body.slice(0, 200));
      }
    }

    if (!resolvedUserId) {
      console.error("[LinkedIn callback] Could not verify user in auth.users — email:", userEmail, "userId from state:", userId);
      redirect(res, 302, makeErrorUrl("user_not_found", "Could not verify your account. Please sign out, sign in again, and retry."));
      return;
    }

    // --- Step 2: Exchange OAuth code for LinkedIn access token ---
    // Redirect URI priority: (1) embedded in state by frontend, (2) LINKEDIN_REDIRECT_URI env var, (3) hardcoded default
    // MUST exactly match the URI registered in the LinkedIn Developer Portal.
    const tokenExchangeRedirectUri =
      stateRedirectUri ||
      stripKeyPrefix(process.env.LINKEDIN_REDIRECT_URI || "") ||
      DEFAULT_REDIRECT_URI;

    console.log("[LinkedIn callback] Token exchange request:", JSON.stringify({
      grant_type: "authorization_code",
      redirect_uri: tokenExchangeRedirectUri,
      client_id_length: clientId.length,
      code_length: code.length,
    }));

    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: tokenExchangeRedirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const tokenRawText = await tokenRes.text();
    let tokenData = {};
    try { tokenData = JSON.parse(tokenRawText); } catch { /**/ }

    console.log("[LinkedIn callback] Token exchange response status:", tokenRes.status);
    console.log("[LinkedIn callback] Token exchange response:", tokenRawText.slice(0, 500));

    const accessToken = tokenData && tokenData.access_token;

    if (!accessToken || typeof accessToken !== "string") {
      const errDetail = tokenData.error_description || tokenData.error || `HTTP ${tokenRes.status}`;
      console.error("[LinkedIn callback] Token exchange failed. Detail:", errDetail, "Full response:", tokenRawText.slice(0, 500));
      redirect(res, 302, makeErrorUrl("token_failed", errDetail));
      return;
    }

    console.log("[LinkedIn callback] Access token obtained. Token length:", accessToken.length);

    // --- Step 3: Fetch LinkedIn profile info ---
    let linkedinProfileId = null;
    let linkedinProfileUrl = null;
    try {
      const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        linkedinProfileId = profileData.sub || null;
        linkedinProfileUrl = profileData.profile || profileData.website || null;
        console.log("[LinkedIn callback] LinkedIn profile fetched:", JSON.stringify({
          sub: linkedinProfileId,
          name: profileData.name,
          profile: linkedinProfileUrl,
        }));
      } else {
        console.warn("[LinkedIn callback] userinfo fetch failed:", profileRes.status);
      }
    } catch (profileErr) {
      console.warn("[LinkedIn callback] Could not fetch LinkedIn profile info:", profileErr.message);
    }

    // --- Step 4: Upsert profile row using verified user.id ---
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const profileData = {
      user_id: resolvedUserId,
      linkedin_token: accessToken,
      linkedin_connected: true,
      ...(linkedinProfileId ? { linkedin_profile_id: linkedinProfileId } : {}),
      ...(linkedinProfileUrl ? { linkedin_profile_url: linkedinProfileUrl } : {}),
    };

    console.log("[LinkedIn callback] Upserting profile:", JSON.stringify({
      user_id: resolvedUserId,
      linkedin_connected: true,
      token_length: accessToken.length,
      linkedin_profile_id: linkedinProfileId,
      linkedin_profile_url: linkedinProfileUrl,
      project: projectId,
    }));

    const { data: upsertResult, error: saveError } = await supabase
      .from("profiles")
      .upsert(profileData, { onConflict: "user_id" })
      .select("user_id, linkedin_connected, linkedin_token");

    console.log("[LinkedIn callback] Upsert result:", JSON.stringify({
      data: upsertResult,
      error: saveError,
    }));

    if (saveError) {
      console.error("[LinkedIn callback] Upsert error on project:", projectId, saveError);
      // FK violation — resolvedUserId verified above, so this shouldn't happen; log it clearly
      if (saveError.code === "23503" || (saveError.message && saveError.message.includes("foreign key"))) {
        console.error("[LinkedIn callback] FK violation despite admin API verification! userId:", resolvedUserId);
        redirect(res, 302, makeErrorUrl("auth_mismatch", "Account mismatch. Please sign out, sign in again, and retry."));
        return;
      }
      redirect(res, 302, makeErrorUrl("db_error", `${saveError.message}`));
      return;
    }

    console.log("[LinkedIn callback] Success! userId:", resolvedUserId, "profileId:", linkedinProfileId, "origin:", appOrigin);
    redirect(res, 302, makeSuccessUrl());
  } catch (err) {
    console.error("[LinkedIn callback] Unhandled error:", err);
    redirect(res, 302, makeErrorUrl("server_error", err.message || "Unexpected error"));
  }
}

module.exports = handler;
