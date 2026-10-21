import { requireAdmin } from "../_shared/admin.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const keyName = "gemini_api_key";
const geminiEndpoint =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  try {
    const { serviceClient } = await requireAdmin(request);
    const body = await request.json();
    const action = body?.action;
    const { data: stored, error } = await serviceClient
      .from("private_settings")
      .select("secret_value")
      .eq("setting_key", keyName)
      .maybeSingle();
    if (error) throw error;
    const apiKey = stored?.secret_value || Deno.env.get("GEMINI_API_KEY");

    if (action === "status") {
      return jsonResponse({
        status: stored?.secret_value ? "memoria" : Deno.env.get("GEMINI_API_KEY") ? "ambiente" : "ausente",
      });
    }

    if (action === "set-key") {
      if (typeof body.apiKey !== "string" || body.apiKey.trim().length < 20 || body.apiKey.length > 512) {
        return jsonResponse({ error: "Informe uma chave Gemini válida." }, 400);
      }
      const saved = await serviceClient.from("private_settings").upsert({
        setting_key: keyName,
        secret_value: body.apiKey.trim(),
        updated_at: new Date().toISOString(),
      });
      if (saved.error) throw saved.error;
      return jsonResponse({ status: "memoria" });
    }

    if (action === "test") {
      if (!apiKey) return jsonResponse({ error: "Configure a chave Gemini no painel ou como secret GEMINI_API_KEY." }, 503);
      const response = await fetch(`${geminiEndpoint}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Responda apenas: OK" }] }],
          generationConfig: { maxOutputTokens: 8 },
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        return jsonResponse({ error: `Teste Gemini falhou (${response.status}): ${detail.slice(0, 500)}` }, 502);
      }
      return jsonResponse({ connected: true });
    }

    return jsonResponse({ error: "Ação Gemini inválida." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, /autenticação|sessão|acesso/i.test(message) ? 401 : 500);
  }
});
