import { requireAdmin } from "../_shared/admin.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import pdfParse from "npm:pdf-parse@1.1.1";
import { Buffer } from "node:buffer";

class GroqResponseError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

class JsonParseError extends Error {}

function cleanJsonText(text: string): string {
  const withoutMarkdown = text
    .replace(/^\uFEFF/, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const jsonStart = withoutMarkdown.indexOf("{");
  const jsonEnd = withoutMarkdown.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new JsonParseError("A IA não retornou um objeto JSON.");
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

function repairJsonSeparators(json: string): string {
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

function parseGroqJson(text: string) {
  const sanitized = cleanJsonText(text);
  try {
    const parsed = JSON.parse(sanitized);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new JsonParseError("A resposta precisa ser um objeto JSON.");
    }
    return parsed;
  } catch (firstError) {
    try {
      const parsed = JSON.parse(repairJsonSeparators(sanitized));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("A resposta recuperada não é um objeto JSON.");
      }
      console.warn("Groq JSON parsed after separator recovery.");
      return parsed;
    } catch (recoveryError) {
      const detail = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
      const original = firstError instanceof Error ? firstError.message : String(firstError);
      throw new JsonParseError(
        `Resposta JSON inválida do Groq; recuperação não foi possível (${detail}; original: ${original}).`
      );
    }
  }
}

async function extractPdfText(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  if (!buffer.byteLength) throw new Error("O arquivo PDF está vazio.");
  const parsed = await pdfParse(Buffer.from(buffer));
  const text = parsed.text.trim();
  if (!text) throw new Error("Não foi possível extrair texto do PDF.");
  return text;
}

async function callGroq(
  apiKey: string,
  pdfText: string,
  action: string
) {
  const systemPrompt = action === "summarize"
    ? `Leia o texto extraído do PDF e retorne um objeto JSON válido neste formato: {"resumoIA":"resumo executivo curto e factual em português"}. Não invente informações.`
    : `Analise o texto extraído do relatório de mídia indoor e retorne exatamente um objeto JSON válido com esta estrutura:
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
Use somente informações explícitas do documento. Para campos ausentes, use string vazia, zero, lista vazia, null ou status desconhecido. Não invente valores. Preserve a unidade da frequência de loop. Meta diária: use o valor explícito ou, se ausente, calcule inserções do período dividido pelo número de dias no histórico. O resumo deve incluir o nome do cliente.`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: pdfText },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 8192,
    }),
  });

  const responseText = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new GroqResponseError(`Resposta inválida do Groq (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new GroqResponseError(
      `Groq ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`,
      response.status
    );
  }

  const choices = payload.choices as
    | Array<{ message?: { content?: string | null } }>
    | undefined;
  const content = choices?.[0]?.message?.content?.trim();
  if (!content) throw new GroqResponseError("Groq não retornou conteúdo.");

  const result = parseGroqJson(content);
  if (action === "summarize") {
    if (typeof result.resumoIA !== "string" || !result.resumoIA.trim()) {
      throw new JsonParseError("Groq não retornou o campo resumoIA.");
    }
    return result.resumoIA;
  }
  return result;
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
    const environmentKey = Deno.env.get("GROQ_API_KEY")?.trim();
    let apiKey = environmentKey;
    if (!apiKey) {
      const { data: storedGroqKey, error: groqKeyError } = await serviceClient
        .from("private_settings")
        .select("secret_value")
        .eq("setting_key", "groq_api_key")
        .maybeSingle();
      if (groqKeyError) throw groqKeyError;
      apiKey = storedGroqKey?.secret_value?.trim();
    }
    if (!apiKey) {
      throw new Error("Configure a chave Groq no painel administrativo ou como secret GROQ_API_KEY.");
    }
    const action = body.action === "summarize" ? "summarize" : "analyze";
    const pdfText = await extractPdfText(file);
    const generated = await callGroq(apiKey, pdfText, action);

    if (action === "summarize") {
      if (typeof generated !== "string") {
        throw new Error("Groq retornou um formato inesperado para o resumo.");
      }
      const { error } = await serviceClient.from("pdf_reports")
        .update({ ai_summary: generated })
        .eq("id", uploadId);
      if (error) throw error;
      return jsonResponse({ resumoIA: generated });
    }

    if (typeof generated === "string") {
      throw new Error("Groq retornou texto em vez do JSON esperado para o relatório.");
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
    const status = /autenticação|sessão|acesso/i.test(message)
      ? 401
      : 500;
    return jsonResponse({
      error: message,
      code: error instanceof JsonParseError
        ? "INVALID_GROQ_JSON"
        : error instanceof GroqResponseError
        ? "GROQ_REQUEST_FAILED"
        : "ANALYSIS_FAILED",
    }, status);
  }
});
