const { createClient } = require("@supabase/supabase-js");

async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { code, redirect_uri } = req.body || {};

    if (!code) {
      return res.status(400).json({ error: "No code provided" });
    }

    const tokenRedirectUri =
      (typeof redirect_uri === "string" && redirect_uri.trim()) ||
      process.env.LINKEDIN_REDIRECT_URI ||
      "https://linkedin-theta-seven.vercel.app/api/linkedin/callback";

    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (!bearerToken) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const supabaseUrl = (
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      ""
    ).replace(/\/$/, "").trim();
    const anonKey = (
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      ""
    ).trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    const clientId = (process.env.LINKEDIN_CLIENT_ID || "").trim();
    const clientSecret = (process.env.LINKEDIN_CLIENT_SECRET || "").trim();

    const missing = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!anonKey) missing.push("SUPABASE_ANON_KEY");
    if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!clientId) missing.push("LINKEDIN_CLIENT_ID");
    if (!clientSecret) missing.push("LINKEDIN_CLIENT_SECRET");

    if (missing.length > 0) {
      console.error("[LinkedIn exchange] Missing env vars:", missing.join(", "));
      return res.status(500).json({ error: "Server configuration error" });
    }

    // Verify the caller's Supabase session token
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(bearerToken);

    if (authError || !user) {
      console.error("[LinkedIn exchange] Auth error:", authError?.message);
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Exchange the LinkedIn authorization code for an access token
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: tokenRedirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const tokenData = await tokenRes.json().catch(() => ({}));

    if (!tokenData.access_token) {
      const errDetail = tokenData.error_description || tokenData.error || `HTTP ${tokenRes.status}`;
      console.error("[LinkedIn exchange] Token exchange failed:", errDetail, tokenData);
      return res.status(400).json({
        error: errDetail || "Failed to get LinkedIn access token",
      });
    }

    // Fetch LinkedIn profile info (sub = LinkedIn person ID)
    let linkedinProfileId = null;
    let linkedinProfileUrl = null;
    try {
      const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        linkedinProfileId = profileData.sub || null;
        linkedinProfileUrl = profileData.profile || profileData.website || null;
        console.log("[LinkedIn exchange] Profile ID fetched:", linkedinProfileId);
      } else {
        console.warn("[LinkedIn exchange] userinfo fetch failed:", profileRes.status);
      }
    } catch (e) {
      console.warn("[LinkedIn exchange] Could not fetch LinkedIn userinfo:", e.message);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const profileData = {
      user_id: user.id,
      linkedin_token: tokenData.access_token,
      linkedin_connected: true,
      ...(linkedinProfileId ? { linkedin_profile_id: linkedinProfileId } : {}),
      ...(linkedinProfileUrl ? { linkedin_profile_url: linkedinProfileUrl } : {}),
    };

    console.log("[LinkedIn exchange] Upserting profile:", JSON.stringify({
      user_id: user.id,
      linkedin_connected: true,
      token_length: tokenData.access_token.length,
      linkedin_profile_id: linkedinProfileId,
    }));

    // Upsert — creates or updates atomically; user.id is verified above via getUser(bearerToken)
    const { data: upsertResult, error: upsertError } = await supabaseAdmin
      .from("profiles")
      .upsert(profileData, { onConflict: "user_id" })
      .select("user_id, linkedin_connected, linkedin_token");

    console.log("[LinkedIn exchange] Upsert result:", JSON.stringify({ data: upsertResult, error: upsertError }));

    if (upsertError) {
      console.error("[LinkedIn exchange] Upsert error:", upsertError);
      return res.status(500).json({ error: `Failed to save LinkedIn connection: ${upsertError.message}` });
    }

    return res.status(200).json({
      success: true,
      linkedin_profile_id: linkedinProfileId,
    });
  } catch (error) {
    console.error("[LinkedIn exchange] Unhandled error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = handler;
