import { requireAdmin } from "../_shared/admin.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const keyName = "groq_api_key";
const groqEndpoint = "https://api.groq.com/openai/v1/chat/completions";
const model = "openai/gpt-oss-120b";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  try {
    const { serviceClient } = await requireAdmin(request);
    const body = await request.json();
    const { data: stored, error } = await serviceClient
      .from("private_settings")
      .select("secret_value")
      .eq("setting_key", keyName)
      .maybeSingle();
    if (error) throw error;

    const storedKey = stored?.secret_value?.trim();
    const environmentKey = Deno.env.get("GROQ_API_KEY")?.trim();
    const apiKey = environmentKey || storedKey;

    if (body?.action === "status") {
      return jsonResponse({
        status: environmentKey ? "ambiente" : storedKey ? "portal" : "ausente",
      });
    }

    if (body?.action === "set-key") {
      if (typeof body.apiKey !== "string" || body.apiKey.trim().length < 20 || body.apiKey.length > 512) {
        return jsonResponse({ error: "Informe uma chave Groq válida." }, 400);
      }
      const saved = await serviceClient.from("private_settings").upsert({
        setting_key: keyName,
        secret_value: body.apiKey.trim(),
        updated_at: new Date().toISOString(),
      });
      if (saved.error) throw saved.error;
      return jsonResponse({ status: "portal" });
    }

    if (body?.action === "test") {
      if (!apiKey) {
        return jsonResponse({ error: "Configure a chave Groq nesta tela ou como secret GROQ_API_KEY." }, 503);
      }
      const response = await fetch(groqEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "user", content: "Responda apenas: OK" },
          ],
          max_completion_tokens: 32,
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        return jsonResponse({
          error: `Teste Groq falhou (${response.status}): ${detail.slice(0, 500)}`,
        }, 502);
      }
      return jsonResponse({ connected: true });
    }

    return jsonResponse({ error: "Ação Groq inválida." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("groq-admin failed", message);
    return jsonResponse({ error: message }, /autenticação|sessão|acesso/i.test(message) ? 401 : 500);
  }
});
