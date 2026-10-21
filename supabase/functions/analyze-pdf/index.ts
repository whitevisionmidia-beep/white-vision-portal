import { requireAdmin } from "../_shared/admin.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const geminiEndpoint =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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

async function callGemini(apiKey: string, pdfBase64: string, action: string) {
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

  const response = await fetch(`${geminiEndpoint}?key=${encodeURIComponent(apiKey)}`, {
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
        : { responseMimeType: "application/json", maxOutputTokens: 8192 },
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Gemini ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  }
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("").trim();
  if (!text) throw new Error("Gemini não retornou conteúdo.");
  return action === "summarize" ? text : JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
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
    const generated = await callGemini(apiKey, base64(new Uint8Array(await file.arrayBuffer())), action);

    if (action === "summarize") {
      const { error } = await serviceClient.from("pdf_reports")
        .update({ ai_summary: generated })
        .eq("id", uploadId);
      if (error) throw error;
      return jsonResponse({ resumoIA: generated });
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
      const url = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (url && serviceRoleKey) {
        const { createClient } = await import("npm:@supabase/supabase-js@2");
        const service = createClient(url, serviceRoleKey);
        await service.from("pdf_reports").update({ status: "falhou", error_message: message }).eq("id", uploadId);
      }
    }
    return jsonResponse({ error: message }, /autenticação|sessão|acesso/i.test(message) ? 401 : 500);
  }
});
