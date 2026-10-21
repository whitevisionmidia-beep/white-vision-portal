import { requireAdmin } from "../_shared/admin.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const models = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];
const maxRetryCycles = 5;
const retryDelayMs = 2_000;

class GeminiJsonParseError extends Error {}

class GeminiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function cleanGeminiJson(text: string): string {
  const withoutMarkdown = text
    .replace(/^\uFEFF/, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const jsonStart = withoutMarkdown.indexOf("{");
  const jsonEnd = withoutMarkdown.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new GeminiJsonParseError("Gemini não retornou um objeto JSON.");
  }

  const candidate = withoutMarkdown.slice(jsonStart, jsonEnd + 1);
  let sanitized = "";
  let inString = false;
  for (let index = 0; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (!inString) {
      sanitized += character;
      if (character === '"') inString = true;
      continue;
    }

    if (character === "\\") {
      const next = candidate[index + 1];
      if (next && /["\\/bfnrtu]/.test(next)) {
        sanitized += character + next;
        index += 1;
      } else {
        sanitized += "\\\\";
      }
      continue;
    }

    if (character === '"') {
      let nextIndex = index + 1;
      while (/\s/.test(candidate[nextIndex] || "")) nextIndex += 1;
      const nextSignificant = candidate[nextIndex];
      let nextAfterComma = nextIndex;
      if (nextSignificant === ",") {
        nextAfterComma += 1;
        while (/\s/.test(candidate[nextAfterComma] || "")) nextAfterComma += 1;
      }
      const commaHasFollowingJsonValue =
        nextSignificant !== "," ||
        /["[{tfn0-9-]/.test(candidate[nextAfterComma] || "");
      if (
        nextSignificant &&
        !/[:,}\]]/.test(nextSignificant) ||
        (nextSignificant === "," && !commaHasFollowingJsonValue)
      ) {
        sanitized += '\\"';
      } else {
        sanitized += character;
        inString = false;
      }
      continue;
    }

    if (character.charCodeAt(0) < 0x20) {
      if (character === "\n") sanitized += "\\n";
      else if (character === "\r") sanitized += "\\r";
      else if (character === "\t") sanitized += "\\t";
      else sanitized += `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    } else {
      sanitized += character;
    }
  }
  return sanitized;
}

function repairGeminiJsonSeparators(json: string): string {
  let repaired = "";
  let inString = false;
  for (let index = 0; index < json.length; index += 1) {
    const character = json[index];
    if (!inString) {
      const scalar = json.slice(index).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
      if (scalar) {
        const afterScalar = index + scalar.length;
        let nextIndex = afterScalar;
        while (/\s/.test(json[nextIndex] || "")) nextIndex += 1;
        const next = json[nextIndex];
        repaired += scalar;
        if (
          nextIndex > afterScalar &&
          next &&
          /["[{tfn0-9-]/.test(next)
        ) {
          repaired += ",";
        }
        index = afterScalar - 1;
        continue;
      }
    }
    if (!inString && character === ",") {
      let nextIndex = index + 1;
      while (/\s/.test(json[nextIndex] || "")) nextIndex += 1;
      if (json[nextIndex] === "}" || json[nextIndex] === "]") continue;
    }
    repaired += character;

    if (character === "\\") {
      repaired += json[index + 1] || "";
      index += 1;
      continue;
    }
    if (character === '"') inString = !inString;
    if (inString || (character !== "}" && character !== "]" && character !== '"')) continue;

    let nextIndex = index + 1;
    while (/\s/.test(json[nextIndex] || "")) nextIndex += 1;
    const next = json[nextIndex];
    if (
      next &&
      !/[,}:\]]/.test(next) &&
      (character !== '"' || next === '"' || next === "{" || next === "[")
    ) {
      repaired += ",";
    }
  }
  return repaired;
}

function parseGeminiJson(text: string) {
  const sanitized = cleanGeminiJson(text);
  try {
    const parsed = JSON.parse(sanitized);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new GeminiJsonParseError("A resposta precisa ser um objeto JSON.");
    }
    return parsed;
  } catch (firstError) {
    try {
      const parsed = JSON.parse(repairGeminiJsonSeparators(sanitized));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("A resposta recuperada não é um objeto JSON.");
      }
      console.warn("Gemini JSON parsed after separator recovery.");
      return parsed;
    } catch (recoveryError) {
      const detail = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
      const original = firstError instanceof Error ? firstError.message : String(firstError);
      throw new GeminiJsonParseError(
        `Resposta JSON inválida do Gemini; recuperação não foi possível (${detail}; original: ${original}).`
      );
    }
  }
}

async function getGeminiKey(serviceClient: SupabaseClient) {
  const { data, error } = await serviceClient
    .from("private_settings")
    .select("secret_value")
    .eq("setting_key", "gemini_api_key")
    .maybeSingle();
  if (error) throw error;
  const key = data?.secret_value || Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("Configure a chave Gemini no painel ou como secret GEMINI_API_KEY.");
  return key as string;
}

async function callGemini(
  apiKey: string,
  pdfBase64: string,
  action: string
) {
  const prompt = action === "summarize"
    ? "Leia o PDF e retorne um resumo executivo curto e factual em português. Não invente informações."
    : `Analise o PDF do relatório de mídia indoor e retorne somente JSON válido.
Use somente dados explícitos do documento. Se um campo não existir, use string vazia, zero, lista vazia, null ou status desconhecido. Não invente dados.
Schema:
{
 "token":string,"clienteNome":string,"campanhaNome":string,"periodo":string,
 "diasEmExibicaoTotal":number,"totalExibicoesHistorico":number,
 "insercoesPeriodo":number,"metaDiaria":number,"frequenciaLoop":string,
 "telasAtivas":number,"resumoRelatorio":string,"frequenciaGeral":string,
 "desempenhoPorTela":[{"localNome":string,"telaNome":string,"insercoes":number}],
 "locais":[{"nome":string,"endereco":string,"horarioFuncionamento":string,"frequenciaLocal":string,
   "telas":[{"nome":string,"status":"online"|"offline"|"desconhecido","metaDiariaEsperada":number|null}]}],
 "historicoDiario":[{"dia":"YYYY-MM-DD","insercoes":number,"status":"normal"|"alerta"|"zerado"|"desconhecido",
   "telas":[{"localNome":string,"telaNome":string,"insercoes":number,"pagina":number,"evidencia":string,
   "status":"normal"|"alerta"|"zerado"|"desconhecido","observacaoFalha":string}]}]
}
Frequência de loop deve preservar unidade como aparece (por exemplo 30s ou a cada 3 min). Meta diária: usar valor explícito; se não existir, dividir inserções do período pelo número de dias no histórico e arredondar. O resumo deve conter o nome do cliente e uma síntese fiel.`;

  let lastError: GeminiRequestError | null = null;
  for (let cycle = 1; cycle <= maxRetryCycles; cycle += 1) {
    let shouldRetryCycle = false;
    for (const modelName of models) {
      const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
              ],
            }],
            generationConfig: action === "summarize"
              ? { maxOutputTokens: 1024 }
              : {
                responseMimeType: "application/json",
                maxOutputTokens: 8192,
              },
          }),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        lastError = new GeminiRequestError(
          `Falha de rede ao chamar ${modelName}: ${detail}`,
          503,
          true
        );
        shouldRetryCycle = true;
        console.warn(`Ciclo ${cycle}/${maxRetryCycles}: ${modelName} falhou na rede; tentando o próximo modelo.`);
        continue;
      }

      let responseText: string;
      try {
        responseText = await response.text();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        lastError = new GeminiRequestError(
          `Falha ao ler a resposta de ${modelName}: ${detail}`,
          502,
          true
        );
        shouldRetryCycle = true;
        console.warn(`Ciclo ${cycle}/${maxRetryCycles}: falha ao ler a resposta de ${modelName}; tentando o próximo modelo.`);
        continue;
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        payload = { error: responseText.slice(0, 1200) };
      }

      if (!response.ok) {
        const detail = JSON.stringify(payload).slice(0, 1200);
        const retryable =
          response.status === 429 ||
          response.status === 503 ||
          /high demand|overload|unavailable|resource_exhausted|service unavailable/i.test(detail);
        const fallbackOnly =
          response.status === 404 ||
          /model not found|not supported for generatecontent/i.test(detail);
        const requestError = new GeminiRequestError(
          `Gemini ${response.status} (${modelName}): ${detail}`,
          response.status,
          retryable
        );
        if (!retryable && !fallbackOnly) throw requestError;

        lastError = requestError;
        shouldRetryCycle ||= retryable;
        console.warn(
          `Ciclo ${cycle}/${maxRetryCycles}: ${modelName} indisponível (${response.status}); tentando o próximo modelo.`
        );
        continue;
      }

      const candidates = payload.candidates as
        | Array<{ content?: { parts?: Array<{ text?: string }> } }>
        | undefined;
      const text = candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();
      if (!text) {
        lastError = new GeminiRequestError(`Gemini não retornou conteúdo para ${modelName}.`, 502, true);
        shouldRetryCycle = true;
        console.warn(`Ciclo ${cycle}/${maxRetryCycles}: ${modelName} retornou conteúdo vazio; tentando o próximo modelo.`);
        continue;
      }

      if (action === "summarize") {
        console.log(`Gemini respondeu usando ${modelName} no ciclo ${cycle}.`);
        return text;
      }

      try {
        const report = parseGeminiJson(text);
        console.log(`Gemini respondeu usando ${modelName} no ciclo ${cycle}.`);
        return report;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        lastError = new GeminiRequestError(
          `JSON inválido retornado por ${modelName}: ${detail}`,
          502,
          true
        );
        shouldRetryCycle = true;
        console.warn(`Ciclo ${cycle}/${maxRetryCycles}: JSON inválido de ${modelName}; tentando o próximo modelo.`);
      }
    }

    if (!shouldRetryCycle) break;
    if (cycle < maxRetryCycles) {
      console.warn(`Todos os modelos falharam no ciclo ${cycle}; nova tentativa em ${retryDelayMs} ms.`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw lastError ||
    new GeminiRequestError("Todos os modelos Gemini falharam.", 503, true);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  let uploadId: string | undefined;
  try {
    const { serviceClient } = await requireAdmin(request);
    const body = await request.json();
    uploadId = body.uploadId;
    if (typeof uploadId !== "string") return jsonResponse({ error: "Envio não informado." }, 400);

    const { data: upload, error: uploadError } = await serviceClient
      .from("pdf_reports")
      .select("*")
      .eq("id", uploadId)
      .single();
    if (uploadError || !upload) throw uploadError || new Error("PDF não encontrado.");
    const { data: file, error: fileError } = await serviceClient.storage
      .from("report-pdfs")
      .download(upload.storage_path);
    if (fileError || !file) throw fileError || new Error("Arquivo PDF não encontrado.");
    const apiKey = await getGeminiKey(serviceClient);
    const action = body.action === "summarize" ? "summarize" : "analyze";
    let pdfBase64: string;
    try {
      const pdfBuffer = await file.arrayBuffer();
      if (pdfBuffer.byteLength === 0) throw new Error("O arquivo está vazio.");
      pdfBase64 = base64(new Uint8Array(pdfBuffer));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Não foi possível ler o PDF salvo no Storage: ${detail}`);
    }
    const generated = await callGemini(apiKey, pdfBase64, action);

    if (action === "summarize") {
      if (typeof generated !== "string") {
        throw new Error("Gemini retornou um formato inesperado para o resumo.");
      }
      const { error } = await serviceClient.from("pdf_reports")
        .update({ ai_summary: generated })
        .eq("id", uploadId);
      if (error) throw error;
      return jsonResponse({ resumoIA: generated });
    }

    if (typeof generated === "string") {
      throw new Error("Gemini retornou texto em vez do JSON esperado para o relatório.");
    }

    if (!generated.clienteNome || !generated.resumoRelatorio) {
      throw new Error("O relatório precisa conter nome do cliente e resumo.");
    }

    const { data: campaign, error: campaignError } = await serviceClient
      .from("campaigns")
      .select("*")
      .eq("id", upload.campaign_id)
      .single();
    if (campaignError || !campaign) throw campaignError || new Error("Cliente não encontrado.");

    const report = {
      ...generated,
      clienteNome: String(generated.clienteNome),
      campanhaNome: generated.campanhaNome || campaign.campaign_name,
      periodo: generated.periodo || campaign.period,
      diasEmExibicaoTotal: Number(generated.diasEmExibicaoTotal || 0),
      totalExibicoesHistorico: Number(generated.totalExibicoesHistorico || 0),
      insercoesPeriodo: Number(generated.insercoesPeriodo || 0),
      metaDiaria: Number(generated.metaDiaria || 0),
      frequenciaLoop: generated.frequenciaLoop || "",
      telasAtivas: Number(generated.telasAtivas || 0),
      locais: Array.isArray(generated.locais) ? generated.locais : [],
      historicoDiario: Array.isArray(generated.historicoDiario) ? generated.historicoDiario : [],
      desempenhoPorTela: Array.isArray(generated.desempenhoPorTela) ? generated.desempenhoPorTela : [],
    };
    const metricas = {
      insercoesPeriodo: report.insercoesPeriodo,
      metaDiaria: report.metaDiaria,
      telasAtivas: report.telasAtivas,
      desempenhoPorTela: report.desempenhoPorTela,
      historicoDiario: report.historicoDiario.map((day: { dia: string; insercoes: number; status: string }) => ({
        data: day.dia,
        insercoes: day.insercoes,
        status: day.status,
      })),
    };
    const campaignUpdate = await serviceClient.from("campaigns").update({
      client_name: report.clienteNome,
      campaign_name: report.campanhaNome,
      period: report.periodo,
      days_accumulated: report.diasEmExibicaoTotal,
      total_impressions_accumulated: report.totalExibicoesHistorico,
      general_frequency: report.frequenciaLoop || generated.frequenciaGeral || campaign.general_frequency,
      report_summary: report.resumoRelatorio,
      dashboard_metrics: metricas,
    }).eq("id", upload.campaign_id);
    if (campaignUpdate.error) throw campaignUpdate.error;

    const screenIdByName = new Map<string, string>();
    for (const local of report.locais) {
      const pointResult = await serviceClient.from("points").upsert({
        campaign_id: upload.campaign_id,
        name: local.nome,
        address: local.endereco || "",
        operating_hours: local.horarioFuncionamento || "",
        local_frequency: local.frequenciaLocal || "",
      }, { onConflict: "campaign_id,name" }).select("id").single();
      if (pointResult.error) throw pointResult.error;
      for (const screen of Array.isArray(local.telas) ? local.telas : []) {
        const screenResult = await serviceClient.from("screens").upsert({
          point_id: pointResult.data.id,
          name: screen.nome,
          daily_target: screen.metaDiariaEsperada ?? null,
          status: screen.status || "desconhecido",
        }, { onConflict: "point_id,name" }).select("id").single();
        if (screenResult.error) throw screenResult.error;
        screenIdByName.set(
          `${local.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}::${screen.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}`,
          screenResult.data.id
        );
      }
    }
    const dailyRows = report.historicoDiario.flatMap((day: {
      dia: string;
      telas?: Array<{
        localNome: string;
        telaNome: string;
        insercoes: number;
        status?: string;
        observacaoFalha?: string;
      }>;
    }) => (day.telas || []).flatMap((screen) => {
      const normalizedLocal = screen.localNome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const normalizedScreen = screen.telaNome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const screenId = screenIdByName.get(`${normalizedLocal}::${normalizedScreen}`);
      return screenId ? [{
        report_date: day.dia,
        screen_id: screenId,
        impressions_delivered: Number(screen.insercoes || 0),
        daily_target: null,
        nominal_failure: screen.status === "alerta" || screen.insercoes === 0,
        report_status: screen.status || "desconhecido",
        failure_note: screen.observacaoFalha || null,
      }] : [];
    }));
    if (dailyRows.length) {
      const savedDaily = await serviceClient.from("daily_screen_reports").upsert(dailyRows, {
        onConflict: "report_date,screen_id",
      });
      if (savedDaily.error) throw savedDaily.error;
    }

    const updated = await serviceClient.from("pdf_reports").update({
      status: "analisado",
      report,
      error_message: null,
    }).eq("id", uploadId);
    if (updated.error) throw updated.error;

    return jsonResponse({
      uploadId,
      campaignId: upload.campaign_id,
      clientName: report.clienteNome,
      clientPath: `/c/${campaign.slug}`,
      report,
      totals: {
        totalExibicoesPeriodo: report.insercoesPeriodo,
        mediaDiariaPeriodo: report.metaDiaria,
        diasEmExibicaoTotal: report.diasEmExibicaoTotal,
        totalExibicoesHistorico: report.totalExibicoesHistorico,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("analyze-pdf failed", message);
    if (uploadId) {
      try {
        const url = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (url && serviceRoleKey) {
          const { createClient } = await import("npm:@supabase/supabase-js@2");
          const service = createClient(url, serviceRoleKey);
          const update = await service
            .from("pdf_reports")
            .update({ status: "falhou", error_message: message })
            .eq("id", uploadId);
          if (update.error) {
            console.error("Failed to update PDF report status after analysis error.", update.error);
          }
        }
      } catch (statusUpdateError) {
        console.error("Could not persist the PDF analysis error status.", statusUpdateError);
      }
    }
    const status = error instanceof GeminiJsonParseError
      ? 422
      : error instanceof GeminiRequestError
      ? error.retryable ? 503 : 502
      : /autenticação|sessão|acesso/i.test(message)
      ? 401
      : 500;
    return jsonResponse({
      error: message,
      code: error instanceof GeminiJsonParseError
        ? "INVALID_GEMINI_JSON"
        : error instanceof GeminiRequestError
        ? error.retryable ? "GEMINI_UNAVAILABLE" : "GEMINI_REQUEST_FAILED"
        : "ANALYSIS_FAILED",
    }, status);
  }
});
