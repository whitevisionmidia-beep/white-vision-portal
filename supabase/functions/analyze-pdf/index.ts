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

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function normalizeCount(value: unknown, field: string): number {
  if (value === undefined || value === null || value === "") return 0;
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const cleaned = value.trim().replace(/\s/g, "").replace(/[^\d,.-]/g, "");
    const normalized = /^\d{1,3}(?:,\d{3})+$/.test(cleaned) && !cleaned.includes(".")
      ? cleaned.replace(/,/g, "")
      : cleaned.includes(",")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : /^\d{1,3}(?:\.\d{3})+$/.test(cleaned)
      ? cleaned.replace(/\./g, "")
      : cleaned;
    parsed = Number(normalized);
  } else {
    throw new JsonParseError(`O campo numérico "${field}" tem um tipo inválido.`);
  }
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new JsonParseError(`O campo numérico "${field}" contém um valor inválido.`);
  }
  return Math.round(parsed);
}

function normalizeText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeStatus(value: unknown): "normal" | "alerta" | "zerado" | "desconhecido" {
  return value === "normal" || value === "alerta" || value === "zerado"
    ? value
    : "desconhecido";
}

function normalizeReport(source: JsonRecord) {
  const locais = (Array.isArray(source.locais) ? source.locais : []).map((value) => {
    const local = asRecord(value);
    const telas = (Array.isArray(local.telas) ? local.telas : []).map((value) => {
      const tela = asRecord(value);
      const target = tela.metaDiariaEsperada;
      return {
        nome: normalizeText(tela.nome),
        insercoes: normalizeCount(tela.insercoes, "locais.telas.insercoes"),
        detalhes: normalizeText(tela.detalhes),
        status: tela.status === "online" || tela.status === "offline"
          ? tela.status
          : "desconhecido",
        metaDiariaEsperada: target === null || target === undefined || target === ""
          ? null
          : normalizeCount(target, "locais.telas.metaDiariaEsperada"),
      };
    }).filter((screen) => screen.nome);
    return {
      nome: normalizeText(local.nome),
      endereco: normalizeText(local.endereco),
      horarioFuncionamento: normalizeText(local.horarioFuncionamento),
      links: (Array.isArray(local.links) ? local.links : []).map((value) => {
        const link = asRecord(value);
        return { rotulo: normalizeText(link.rotulo), url: normalizeText(link.url) };
      }),
      telas,
    };
  }).filter((local) => local.nome);

  const desempenhoPorTela = (Array.isArray(source.desempenhoPorTela)
    ? source.desempenhoPorTela
    : []).map((value) => {
      const screen = asRecord(value);
      return {
        localNome: normalizeText(screen.localNome),
        telaNome: normalizeText(screen.telaNome),
        insercoes: normalizeCount(screen.insercoes, "desempenhoPorTela.insercoes"),
        detalhes: normalizeText(screen.detalhes),
      };
    }).filter((screen) => screen.localNome && screen.telaNome);
  const normalizedPerformance = desempenhoPorTela.length
    ? desempenhoPorTela
    : locais.flatMap((local) => local.telas.map((screen) => ({
      localNome: local.nome,
      telaNome: screen.nome,
      insercoes: screen.insercoes,
      detalhes: screen.detalhes,
    })));

  const historicoDiario = (Array.isArray(source.historicoDiario) ? source.historicoDiario : [])
    .map((value) => {
      const day = asRecord(value);
      const date = normalizeText(day.dia);
      const parsedDate = new Date(`${date}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== date
      ) {
        throw new JsonParseError(`Data inválida no histórico diário: "${date}".`);
      }
      return {
        dia: date,
        insercoes: normalizeCount(day.insercoes, "historicoDiario.insercoes"),
        status: normalizeStatus(day.status),
        telas: (Array.isArray(day.telas) ? day.telas : []).map((value) => {
          const screen = asRecord(value);
          return {
            localNome: normalizeText(screen.localNome),
            telaNome: normalizeText(screen.telaNome),
            insercoes: normalizeCount(screen.insercoes, "historicoDiario.telas.insercoes"),
            pagina: normalizeCount(screen.pagina, "historicoDiario.telas.pagina"),
            evidencia: normalizeText(screen.evidencia),
            status: normalizeStatus(screen.status),
            observacaoFalha: normalizeText(screen.observacaoFalha),
          };
        }).filter((screen) => screen.localNome && screen.telaNome),
      };
    })
    .sort((left, right) => left.dia.localeCompare(right.dia));

  return {
    token: normalizeText(source.token),
    clienteNome: normalizeText(source.clienteNome),
    campanhaNome: normalizeText(source.campanhaNome),
    periodo: normalizeText(source.periodo),
    diasEmExibicaoTotal: normalizeCount(source.diasEmExibicaoTotal, "diasEmExibicaoTotal"),
    totalExibicoesHistorico: normalizeCount(source.totalExibicoesHistorico, "totalExibicoesHistorico"),
    insercoesPeriodo: normalizeCount(source.insercoesPeriodo, "insercoesPeriodo"),
    metaDiaria: normalizeCount(source.metaDiaria, "metaDiaria"),
    telasAtivas: normalizeCount(source.telasAtivas, "telasAtivas"),
    resumoRelatorio: normalizeText(source.resumoRelatorio),
    desempenhoPorTela: normalizedPerformance,
    locais,
    historicoDiario,
  };
}

async function callGroq(
  apiKey: string,
  pdfText: string,
  action: string
) {
  const systemPrompt = action === "summarize"
    ? `Leia o texto extraído do PDF e retorne um objeto JSON válido neste formato: {"resumoIA":"resumo executivo curto e factual em português"}. Não invente informações.`
    : `Você extrai dados de relatórios de mídia indoor. Analise todo o texto do PDF e retorne APENAS um objeto JSON válido, sem Markdown, cercas de código ou explicações. Use exatamente estas chaves e tipos, compatíveis com a tela e o gráfico do portal:
{
 "token":string,"clienteNome":string,"campanhaNome":string,"periodo":string,
 "diasEmExibicaoTotal":number,"totalExibicoesHistorico":number,
 "insercoesPeriodo":number,"metaDiaria":number,
 "telasAtivas":number,"resumoRelatorio":string,
 "desempenhoPorTela":[{"localNome":string,"telaNome":string,"insercoes":number,"detalhes":string}],
 "locais":[{"nome":string,"endereco":string,"horarioFuncionamento":string,
   "links":[{"rotulo":string,"url":string}],
   "telas":[{"nome":string,"insercoes":number,"detalhes":string,"status":"online"|"offline"|"desconhecido","metaDiariaEsperada":number|null}]}],
 "historicoDiario":[{"dia":"YYYY-MM-DD","insercoes":number,"status":"normal"|"alerta"|"zerado"|"desconhecido",
   "telas":[{"localNome":string,"telaNome":string,"insercoes":number,"pagina":number,"evidencia":string,
   "status":"normal"|"alerta"|"zerado"|"desconhecido","observacaoFalha":string}]}]
}
Instruções de extração:
- "clienteNome": copie o nome exato do cliente que aparece no relatório. Não use o nome do arquivo nem infira.
- "periodo": copie as datas inicial e final exatas da campanha e preserve-as em uma representação clara (por exemplo, DD/MM/AAAA - DD/MM/AAAA). Não use a data atual nem deduza o período.
- "metaDiaria": copie fielmente o valor numérico explicitamente impresso no relatório. Não estime, calcule, arredonde nem substitua pela média. Se não houver valor explícito, use 0.
- "locais[].horarioFuncionamento": copie o horário de atendimento/funcionamento exatamente como aparece para cada local. Não combine horários de locais diferentes.
- "locais[].links": extraia todos os links/URLs explicitamente associados ao local ou relatório, com o rótulo exato quando houver. Não invente, complete nem transforme endereços incompletos em links; se não houver, use lista vazia.
- "telasAtivas": informe o número de telas explicitamente ativas. Em "locais", liste cada local identificado; em cada local, "telas" deve conter TODAS as telas individuais que constam no PDF, sem limite de quantidade, com nome/identificação exatos, inserções/exibições, detalhes e especificações vinculados, status e meta por tela quando disponíveis. Nunca crie nomes genéricos, agrupe ou duplique telas. Copie a meta por tela exatamente como impressa, sem estimar ou calcular; use null se não estiver indicada.
- "desempenhoPorTela": inclua cada tela individual com local, nome exato, total exato de inserções do período e detalhes/especificações explícitos. Não invente contagens ausentes; use 0.
- "historicoDiario": extraia todos os dias exibidos no relatório, normalmente os 30 dias do período. Se o PDF mostrar 30 dias, retorne exatamente as 30 linhas. Inclua um item por data com data completa em YYYY-MM-DD e quantidade diária total de inserções; use o ano indicado pelo período do próprio relatório. Mantenha ordem cronológica e inclua dias zerados somente quando constarem no relatório. Não invente linhas para datas ausentes. Este mesmo histórico é usado no gráfico e na tabela do portal. Em cada dia, quando o PDF trouxer a decomposição por tela, inclua todas as telas com inserções, status e observações de falhas/quedas. Não deduza valores por tela a partir do total diário.
- Calcule "insercoesPeriodo" somando os valores diários do período, salvo quando o documento declarar explicitamente outro total; não some períodos duplicados. "totalExibicoesHistorico" e "diasEmExibicaoTotal" devem refletir os acumulados declarados no documento, não apenas o período atual.
- "resumoRelatorio" deve ser um resumo executivo bem elaborado, factual e em português: identifique cliente e período, total de exibições do período, locais auditados, quantidade de telas ativas e destaques/ocorrências relevantes. Não inclua afirmações sem evidência no PDF.
- Todos os campos de contagem e meta devem ser números JSON inteiros, nunca strings. Use somente informações do PDF. Para valores numéricos ausentes, use 0; para meta individual sem valor explícito use null; para texto/listas ausentes, use string/lista vazia e status "desconhecido". Não invente datas, telas, locais, valores ou cálculos sem dados suficientes. A saída deve ser JSON puro, parseável diretamente.`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: pdfText },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_completion_tokens: 8192,
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

    const normalizedReport = normalizeReport(asRecord(generated));
    if (!normalizedReport.clienteNome || !normalizedReport.resumoRelatorio) {
      throw new Error("O relatório precisa conter nome do cliente e resumo.");
    }

    const { data: campaign, error: campaignError } = await serviceClient
      .from("campaigns")
      .select("*")
      .eq("id", upload.campaign_id)
      .single();
    if (campaignError || !campaign) throw campaignError || new Error("Cliente não encontrado.");

    const report = {
      ...normalizedReport,
      campanhaNome: normalizedReport.campanhaNome || campaign.campaign_name,
      periodo: normalizedReport.periodo || campaign.period,
      totalExibicoesPeriodo: normalizedReport.insercoesPeriodo,
    };
    const metricas = {
      insercoesPeriodo: report.insercoesPeriodo,
      metaDiaria: report.metaDiaria,
      telasAtivas: report.telasAtivas,
      desempenhoPorTela: report.desempenhoPorTela,
      locais: report.locais.map((local: {
        nome: string;
        horarioFuncionamento?: string;
        links?: Array<{ rotulo?: string; url?: string }>;
      }) => ({
        nome: local.nome,
        horarioFuncionamento: local.horarioFuncionamento || "",
        links: (local.links || []).flatMap((link) => {
          if (typeof link.url !== "string") return [];
          try {
            const parsedUrl = new URL(link.url);
            if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return [];
            return [{ rotulo: link.rotulo || link.url, url: parsedUrl.href }];
          } catch {
            return [];
          }
        }),
      })),
      historicoDiario: report.historicoDiario.map((day) => ({
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
      report_summary: report.resumoRelatorio,
      dashboard_metrics: metricas,
    }).eq("id", upload.campaign_id);
    if (campaignUpdate.error) throw campaignUpdate.error;

    const screenIdByName = new Map<string, string>();
    const screenTargetById = new Map<string, number | null>();
    for (const local of report.locais) {
      const pointResult = await serviceClient.from("points").upsert({
        campaign_id: upload.campaign_id,
        name: local.nome,
        address: local.endereco || "",
        operating_hours: local.horarioFuncionamento || "",
      }, { onConflict: "campaign_id,name" }).select("id").single();
      if (pointResult.error) throw pointResult.error;
      for (const screen of local.telas) {
        const screenResult = await serviceClient.from("screens").upsert({
          point_id: pointResult.data.id,
          name: screen.nome,
          daily_target: screen.metaDiariaEsperada,
          status: screen.status || "desconhecido",
        }, { onConflict: "point_id,name" }).select("id").single();
        if (screenResult.error) throw screenResult.error;
        screenTargetById.set(screenResult.data.id, screen.metaDiariaEsperada);
        screenIdByName.set(
          `${local.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}::${screen.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}`,
          screenResult.data.id
        );
      }
    }
    const dailyRows = report.historicoDiario.flatMap((day) =>
      day.telas.flatMap((screen) => {
        const normalizedLocal = screen.localNome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const normalizedScreen = screen.telaNome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const screenId = screenIdByName.get(`${normalizedLocal}::${normalizedScreen}`);
        return screenId ? [{
          report_date: day.dia,
          screen_id: screenId,
          impressions_delivered: screen.insercoes,
          daily_target: screenTargetById.get(screenId) ?? null,
          nominal_failure: screen.status === "alerta" || screen.status === "zerado",
          report_status: screen.status || "desconhecido",
          failure_note: screen.observacaoFalha || null,
        }] : [];
      })
    );
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
        metaDiaria: report.metaDiaria,
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
      : error instanceof GroqResponseError
      ? 502
      : 500;
    return jsonResponse({
      error: message,
      ...(error instanceof GroqResponseError ? { upstreamStatus: error.status } : {}),
      code: error instanceof JsonParseError
        ? "INVALID_GROQ_JSON"
        : error instanceof GroqResponseError
        ? "GROQ_REQUEST_FAILED"
        : "ANALYSIS_FAILED",
    }, status);
  }
});
