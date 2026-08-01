import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://packlista.utiskogen.se",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Metoden stöds inte" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Inloggning krävs" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) return json({ error: "Serverkonfiguration saknas" }, 500);

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.slice("Bearer ".length);
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Ogiltig session" }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await adminClient
    .from("users")
    .select("role")
    .eq("id", authData.user.id)
    .single();
  if (profileError || !["admin", "owner"].includes(profile?.role)) {
    return json({ error: "Administratörsbehörighet krävs" }, 403);
  }

  const payload = await request.json().catch(() => ({}));
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Ange en giltig e-postadress" }, 400);

  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: "https://packlista.utiskogen.se/",
  });
  if (error) return json({ error: error.message }, 400);
  return json({ invited: true, user_id: data.user?.id });
});
