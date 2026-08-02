import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const allowedOrigins = new Set([
  "https://packlista.utiskogen.se",
  "https://darioswede.github.io",
  "http://localhost",
  "http://127.0.0.1",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://packlista.utiskogen.se",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Metoden stöds inte." }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(request, { error: "Du måste vara inloggad." }, 401);

  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  if (userError || !userResult.user) return json(request, { error: "Ogiltig session." }, 401);

  const callerId = userResult.user.id;
  const { data: callerProfile, error: profileError } = await admin
    .from("users").select("role,is_owner").eq("id", callerId).maybeSingle();
  if (profileError || !(callerProfile?.role === "admin" || callerProfile?.role === "owner" || callerProfile?.is_owner)) {
    return json(request, { error: "Administratörsbehörighet krävs." }, 403);
  }

  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(payload.action || "list");

  if (action === "list") {
    const { data: authData, error: authError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authError) return json(request, { error: authError.message }, 400);
    const ids = authData.users.map((user) => user.id);
    const { data: profiles, error: profilesError } = ids.length
      ? await admin.from("users").select("id,display_name,role,avatar_key,is_owner").in("id", ids)
      : { data: [], error: null };
    if (profilesError) return json(request, { error: profilesError.message }, 400);
    const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    return json(request, {
      users: authData.users.map((user) => {
        const profile = profileById.get(user.id);
        return {
          id: user.id,
          email: user.email || "",
          displayName: profile?.display_name || "",
          role: profile?.is_owner ? "owner" : (profile?.role || "user"),
          avatarKey: profile?.avatar_key || "backpack",
          confirmedAt: user.email_confirmed_at || user.confirmed_at || null,
          lastSignInAt: user.last_sign_in_at || null,
          createdAt: user.created_at,
        };
      }),
    });
  }

  if (action === "invite") {
    const email = String(payload.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(request, { error: "Ange en giltig e-postadress." }, 400);
    }
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://packlista.utiskogen.se/",
    });
    if (error) return json(request, { error: error.message }, 400);
    return json(request, { invited: true, userId: data.user?.id || null });
  }

  if (action === "approve") {
    const userId = String(payload.userId || "");
    if (!userId) return json(request, { error: "Ogiltig användare." }, 400);
    const { error } = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
    if (error) return json(request, { error: error.message }, 400);
    return json(request, { approved: true });
  }

  if (action === "set_role") {
    const userId = String(payload.userId || "");
    const role = String(payload.role || "");
    if (!userId || !["user", "admin"].includes(role)) {
      return json(request, { error: "Ogiltig användare eller roll." }, 400);
    }
    const { data: targetProfile } = await admin.from("users").select("is_owner").eq("id", userId).maybeSingle();
    if (targetProfile?.is_owner) return json(request, { error: "Ägarens behörighet kan inte ändras." }, 400);
    const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
    if (targetError || !target.user) return json(request, { error: "Användaren finns inte." }, 404);
    const { error } = await admin.from("users").upsert({
      id: userId,
      display_name: target.user.email?.split("@")[0] || "",
      role,
      updated_at: new Date().toISOString(),
    });
    if (error) return json(request, { error: error.message }, 400);
    return json(request, { updated: true });
  }

  return json(request, { error: "Okänd åtgärd." }, 400);
});
