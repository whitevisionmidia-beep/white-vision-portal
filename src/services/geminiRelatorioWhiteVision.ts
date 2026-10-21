import { GoogleGenAI, Type } from "@google/genai";
import type { RelatorioData } from "../types/whiteVision.ts";
import { getGeminiApiKey } from "../../server/geminiKeyStore.ts";
import { verifyPdfEvidence } from "../../server/pdfEvidence.ts";

const MODEL_NAME = "gemini-3.5-flash";
const FALLBACK_MODEL_NAME = "gemini-3.5-flash-lite";

function isTransientModelError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = "status" in error ? Number(error.status) : undefined;
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|temporarily unavailable/i.test(error.message)
  );
}

export async function testarConexaoGemini(): Promise<void> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada no servidor.");
  }

  const ai = new GoogleGenAI({ apiKey });
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
  for (const model of [MODEL_NAME, FALLBACK_MODEL_NAME]) {
    try {
      response = await ai.models.generateContent({
        model,
        contents: "Responda somente com: OK",
      });
      break;
    } catch (error) {
      if (model === FALLBACK_MODEL_NAME || !isTransientModelError(error)) throw error;
      console.warn(`Modelo Gemini ${model} indisponível; tentando ${FALLBACK_MODEL_NAME}.`);
    }
  }
  if (!response) throw new Error("Nenhum modelo Gemini respondeu ao teste de conexão.");
  if (!response.text?.trim()) {
    throw new Error("O Gemini não retornou uma resposta ao teste de conexão.");
  }
}

export async function gerarResumoRelatorioWhiteVision(
  relatorio: RelatorioData
): Promise<string> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada no arquivo .env do servidor.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [
      "Resuma o relatório operacional abaixo em português do Brasil. Destaque o período, total de inserções, média diária, locais e telas, além de falhas relevantes. Use somente os dados fornecidos, não invente conclusões e limite a resposta a 5 tópicos curtos.",
      JSON.stringify(relatorio),
    ],
  });
  const summary = response.text?.trim();
  if (!summary) {
    throw new Error("O Gemini retornou um resumo vazio.");
  }
  return summary;
}

/**
 * Função de extração server-side com Google Gemini API (@google/genai)
 * para processar relatórios operacionais em PDF da White Vision (Mídia Indoor)
 * e retornar exatamente o objeto estritamente tipado RelatorioData.
 *
 * Exclusivo para auditoria da rede White Vision.
 */
export async function extrairRelatorioWhiteVision(
  pdfBufferOrBase64: Buffer | string,
  options?: {
    apiKey?: string;
    modelName?: string;
  }
): Promise<RelatorioData> {
  const apiKey = options?.apiKey || getGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY não configurada. Configure no arquivo .env ou no painel de Secrets da aplicação."
    );
  }

  const ai = new GoogleGenAI({ apiKey });

  const base64Data =
    typeof pdfBufferOrBase64 === "string"
      ? pdfBufferOrBase64.replace(/^data:application\/pdf;base64,/, "")
      : pdfBufferOrBase64.toString("base64");

  const models = options?.modelName
    ? [options.modelName]
    : [MODEL_NAME, FALLBACK_MODEL_NAME];

  const prompt = `Você é um analista especialista em dados de auditoria da White Vision (Mídia Indoor).
Analise o relatório operacional em PDF anexo emitido pela White Vision.
Extraia com precisão factual. Responda exclusivamente com um objeto JSON válido que corresponda ao schema recebido, sem explicações nem blocos Markdown:
REGRA OBRIGATÓRIA: isto é uma tarefa de transcrição, não de análise, consultoria ou estimativa. O PDF é a única fonte de verdade. Não complete lacunas, não deduza valores, não estime, não corrija, não arredonde, não converta unidades e não invente nomes, datas, URLs, status, ocorrências ou campos.
1. Copie cliente, campanha, token, período, totais acumulados, frequência, locais e telas exatamente como aparecem no documento.
2. Retorne sempre clienteNome e resumoRelatorio. O resumo deve ser curto, fiel apenas aos dados legíveis e mencionar quando o documento não trouxer informações suficientes.
3. Transcreva as linhas diárias por local e tela que puder associar com certeza. Para cada linha informe página do PDF (base 1) e evidência literal quando disponível. Não invente valores; omita dados ausentes ou ambíguos em vez de rejeitar o relatório.
4. Status online/offline, endereço, meta diária e frequência local só podem ser preenchidos se estiverem explicitamente no PDF. Quando ausentes use "desconhecido", null ou string vazia, conforme o campo, e evidência vazia. Não derive status a partir de inserções.
5. Extraia frequenciaLoop procurando explicitamente por frequência, duração, intervalo ou tempo do loop/ciclo das mídias em todo o PDF (por exemplo, "a cada X min", "X minutos", "30s", "30 segundos"). Preserve a unidade e o texto que aparece no documento; se não encontrar, use string vazia.
6. Para metaDiaria, primeiro extraia a meta ou média diária explicitamente informada no contrato/relatório. Se não houver valor explícito, calcule insercoesPeriodo dividido pelo número de dias do período coberto no histórico diário do PDF e arredonde para o inteiro mais próximo. Não confunda esta média com metaDiariaEsperada por tela. Se não houver total ou período identificável para o cálculo, use 0.
7. Inclua explicitamente insercoesPeriodo (total do período), telasAtivas (contagem de telas identificáveis em operação), desempenhoPorTela (localNome, telaNome e insercoes acumuladas no período) e historicoDiario (dia ISO YYYY-MM-DD e insercoes totais naquele dia). Use as contagens impressas, sem somar métricas de períodos incompatíveis; quando faltarem, use 0 ou listas vazias.

Retorne estritamente o JSON conforme o schema. Em caso de dúvida, não escolha uma interpretação.`;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      token: { type: Type.STRING },
      clienteNome: { type: Type.STRING },
      resumoRelatorio: { type: Type.STRING },
      insercoesPeriodo: { type: Type.INTEGER },
      metaDiaria: { type: Type.INTEGER },
      frequenciaLoop: { type: Type.STRING },
      telasAtivas: { type: Type.INTEGER },
      desempenhoPorTela: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            localNome: { type: Type.STRING },
            telaNome: { type: Type.STRING },
            insercoes: { type: Type.INTEGER },
          },
          required: ["localNome", "telaNome", "insercoes"],
        },
      },
      campanhaNome: { type: Type.STRING },
      periodo: { type: Type.STRING },
      diasEmExibicaoTotal: { type: Type.INTEGER },
      totalExibicoesHistorico: { type: Type.INTEGER },
      evidencias: {
        type: Type.OBJECT,
        properties: {
          clienteNome: { type: Type.STRING },
          campanhaNome: { type: Type.STRING },
          token: { type: Type.STRING },
          periodo: { type: Type.STRING },
          diasEmExibicaoTotal: { type: Type.STRING },
          totalExibicoesHistorico: { type: Type.STRING },
          frequenciaGeral: { type: Type.STRING },
        },
      },
      frequenciaGeral: { type: Type.STRING },
      locais: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            nome: { type: Type.STRING },
            endereco: { type: Type.STRING },
            horarioFuncionamento: { type: Type.STRING },
            evidenciaEndereco: { type: Type.STRING },
            evidenciaHorarioFuncionamento: { type: Type.STRING },
            evidenciaFrequenciaLocal: { type: Type.STRING },
            frequenciaLocal: { type: Type.STRING },
            telas: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  nome: { type: Type.STRING },
                  status: {
                    type: Type.STRING,
                    enum: ["online", "offline", "desconhecido"],
                  },
                  metaDiariaEsperada: { type: Type.INTEGER, nullable: true },
                  evidenciaMetaDiaria: { type: Type.STRING },
                  evidenciaStatus: { type: Type.STRING },
                  detalhe: { type: Type.STRING },
                },
                required: ["nome"],
              },
            },
          },
          required: ["nome"],
        },
      },
      historicoDiario: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            dia: { type: Type.STRING },
            insercoes: { type: Type.INTEGER },
            telas: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  localNome: { type: Type.STRING },
                  telaNome: { type: Type.STRING },
                  insercoes: { type: Type.INTEGER },
                  pagina: { type: Type.INTEGER },
                  evidencia: { type: Type.STRING },
                  status: {
                    type: Type.STRING,
                    enum: ["normal", "alerta", "zerado", "desconhecido"],
                  },
                  evidenciaStatus: { type: Type.STRING },
                  observacaoFalha: { type: Type.STRING },
                },
              },
            },
          },
          required: ["dia"],
        },
      },
    },
    required: [
      "clienteNome",
      "resumoRelatorio",
      "insercoesPeriodo",
      "metaDiaria",
      "frequenciaLoop",
      "telasAtivas",
      "desempenhoPorTela",
      "historicoDiario",
    ],
  };

  const pdfBytes =
    typeof pdfBufferOrBase64 === "string"
      ? Buffer.from(base64Data, "base64").length
      : pdfBufferOrBase64.length;
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
  let lastModelError: unknown;
  for (const [index, model] of models.entries()) {
    console.log(`[Gemini PDF] Iniciando generateContent: model=${model}, pdfBytes=${pdfBytes}.`);
    try {
      response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: "application/pdf",
              },
            },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema,
        },
      });
      console.log(
        `[Gemini PDF] generateContent concluído: model=${model}, responseCharacters=${response.text?.length ?? 0}, finishReason=${response.candidates?.[0]?.finishReason ?? "unknown"}.`
      );
      break;
    } catch (error) {
      lastModelError = error;
      console.error(
        `[Gemini PDF] Erro de generateContent (${model}):`,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined
      );
      if (index === models.length - 1 || !isTransientModelError(error)) throw error;
      console.warn(`Modelo Gemini ${model} indisponível; tentando ${models[index + 1]}.`);
    }
  }
  if (!response) throw lastModelError;

  const rawText = response.text;
  if (!rawText) {
    throw new Error("Gemini retornou resposta vazia para o PDF.");
  }

  const jsonText = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.error(
      `[Gemini PDF] JSON.parse falhou (${rawText.length} caracteres):`,
      error
    );
    throw new Error(
      `Gemini não retornou um JSON válido para o PDF: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gemini retornou estrutura inválida para o PDF.");
  }
  const report = parsed as RelatorioData & {
    evidencias?: Record<string, unknown>;
    resumoRelatorio?: string;
  };
  if (
    typeof report.clienteNome !== "string" ||
    !report.clienteNome.trim() ||
    typeof report.resumoRelatorio !== "string" ||
    !report.resumoRelatorio.trim()
  ) {
    throw new Error("O Gemini precisa retornar o nome do cliente e um resumo geral do PDF.");
  }

  const hasEvidence =
    Object.values(report.evidencias || {}).some(
      (evidence) => typeof evidence === "string" && evidence.trim()
    ) ||
    (report.locais || []).some(
      (local) =>
        Boolean(local.evidenciaEndereco?.trim()) ||
        Boolean(local.evidenciaHorarioFuncionamento?.trim()) ||
        Boolean(local.evidenciaFrequenciaLocal?.trim()) ||
        local.telas.some(
          (screen) =>
            Boolean(screen.evidenciaMetaDiaria?.trim()) ||
            Boolean(screen.evidenciaStatus?.trim())
        )
    ) ||
    (report.historicoDiario || []).some((day) =>
      (day.telas || []).some(
        (screen) =>
          Boolean(screen.evidencia?.trim()) ||
          Boolean(screen.evidenciaStatus?.trim())
      )
    );
  if (hasEvidence) {
    await verifyPdfEvidence(
      typeof pdfBufferOrBase64 === "string"
        ? Buffer.from(base64Data, "base64")
        : pdfBufferOrBase64,
      report
    );
  }

  return report;
}

// Manter alias retrocompatível sem menções externas
export const extrairRelatorioAdeusPendrive = extrairRelatorioWhiteVision;
