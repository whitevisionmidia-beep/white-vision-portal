import { createClient } from "npm:@supabase/supabase-js@2";

export async function requireAdmin(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) throw new Error("Autenticação obrigatória.");

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Configure SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY na Edge Function.");
  }

  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) throw new Error("Sessão inválida ou expirada.");

  const { data: admin, error: adminError } = await authClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .eq("enabled", true)
    .maybeSingle();
  if (adminError || !admin) throw new Error("Acesso administrativo não habilitado.");

  const serviceClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { user: userData.user, serviceClient };
}
