import type { PdfReportUpload, RelatorioDiarioTela, TelaPonto, WhiteVisionDb } from "../types/adminDb";
import type { ClientTheme, RelatorioData } from "../types/whiteVision";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Falha na API (${response.status})`);
  }
  return payload;
}

export function fetchAuthSession(): Promise<{ authenticated: boolean }> {
  return requestJson("/api/auth/session");
}

export function login(username: string, password: string): Promise<{ authenticated: boolean }> {
  return requestJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<{ authenticated: boolean }> {
  return requestJson("/api/auth/logout", { method: "POST" });
}

export function fetchEstado(): Promise<{ db: WhiteVisionDb }> {
  return requestJson("/api/estado");
}

export type GeminiKeyStatus = "ambiente" | "memoria" | "ausente";

export function fetchGeminiKeyStatus(): Promise<{ status: GeminiKeyStatus }> {
  return requestJson("/api/admin/gemini-key");
}

export function updateGeminiApiKey(apiKey: string): Promise<{ status: GeminiKeyStatus }> {
  return requestJson("/api/admin/gemini-key", {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export function testGeminiConnection(): Promise<{ connected: boolean }> {
  return requestJson("/api/admin/gemini-key/test", { method: "POST" });
}

export async function uploadWhiteVisionLogo(file: File): Promise<void> {
  const pngFile = await convertImageToPng(file);
  const response = await fetch("/api/admin/logo", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "image/png" },
    body: pngFile,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Falha ao atualizar a logo (${response.status})`);
  }
}

async function convertImageToPng(file: File): Promise<Blob> {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 8192 || image.naturalHeight > 8192) {
      throw new Error("A imagem deve ter dimensões válidas de até 8192 × 8192 pixels.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível processar a imagem selecionada.");
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("Não foi possível converter a imagem para PNG.");
    return png;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Não foi possível ler a imagem selecionada: ${error.message}`);
    }
    throw error;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export async function uploadClientThemeLogo(file: File): Promise<{ logoUrl: string }> {
  const pngFile = await convertImageToPng(file);
  const response = await fetch("/api/admin/client-logos", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "image/png" },
    body: pngFile,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    logoUrl?: string;
    error?: string;
  };
  if (!response.ok || !payload.logoUrl) {
    throw new Error(payload.error || `Falha ao enviar a logo do cliente (${response.status}).`);
  }
  return { logoUrl: payload.logoUrl };
}

export class PdfImportError extends Error {
  constructor(
    message: string,
    readonly pdfSaved: boolean,
    readonly uploadId?: string
  ) {
    super(message);
  }
}

export async function importPdfReport(file: File, clientId: string): Promise<{
  db: WhiteVisionDb;
  uploadId: string;
  campaignId: string;
  clientName: string;
  clientPath: string;
  report: RelatorioData;
  totals: {
    totalExibicoesPeriodo: number;
    mediaDiariaPeriodo: number;
    diasEmExibicaoTotal: number;
    totalExibicoesHistorico: number;
  };
}> {
  const response = await fetch(
    `/api/admin/clientes/${encodeURIComponent(clientId)}/relatorios-pdf`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/pdf",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    }
  );
  const payload = (await response.json().catch(() => ({}))) as {
    db?: WhiteVisionDb;
    uploadId?: string;
    campaignId?: string;
    clientName?: string;
    clientPath?: string;
    report?: RelatorioData;
    totals?: {
      totalExibicoesPeriodo: number;
      mediaDiariaPeriodo: number;
      diasEmExibicaoTotal: number;
      totalExibicoesHistorico: number;
    };
    pdfSaved?: boolean;
    error?: string;
  };
  if (!response.ok) {
    throw new PdfImportError(
      payload.error || `Falha no processamento do PDF (${response.status}).`,
      Boolean(payload.pdfSaved),
      payload.uploadId
    );
  }
  if (
    !payload.db ||
    !payload.uploadId ||
    !payload.campaignId ||
    !payload.clientName ||
    !payload.clientPath ||
    !payload.report ||
    !payload.totals
  ) {
    throw new PdfImportError("O servidor não retornou o resultado completo do processamento.", true, payload.uploadId);
  }
  return {
    db: payload.db,
    uploadId: payload.uploadId,
    campaignId: payload.campaignId,
    clientName: payload.clientName,
    clientPath: payload.clientPath,
    report: payload.report,
    totals: payload.totals,
  };
}

export function savePdfReport(uploadId: string): Promise<{ db: WhiteVisionDb }> {
  return requestJson(`/api/admin/relatorios-pdf/${encodeURIComponent(uploadId)}/salvar`, {
    method: "POST",
  });
}

export function generatePdfReportSummary(
  uploadId: string
): Promise<{ db: WhiteVisionDb; resumoIA: string }> {
  return requestJson(`/api/admin/relatorios-pdf/${encodeURIComponent(uploadId)}/resumo`, {
    method: "POST",
  });
}

export function savePdfReportToClient(
  uploadId: string
): Promise<{ db: WhiteVisionDb; clientName: string; clientPath: string }> {
  return requestJson(
    `/api/admin/relatorios-pdf/${encodeURIComponent(uploadId)}/salvar-perfil`,
    { method: "POST" }
  );
}

export function deletePdfReport(uploadId: string): Promise<{ db: WhiteVisionDb }> {
  return requestJson(`/api/admin/relatorios-pdf/${encodeURIComponent(uploadId)}`, {
    method: "DELETE",
  });
}

export function fetchPublicClientReport(slug: string): Promise<{ report: RelatorioData }> {
  return requestJson(`/api/public/clientes/${encodeURIComponent(slug)}`, {
    cache: "no-store",
  });
}

export function createClient(body: {
  clienteNome: string;
  campanhaNome: string;
}): Promise<{ db: WhiteVisionDb; clientPath: string }> {
  return requestJson("/api/clientes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function removeClient(clientId: string): Promise<{ db: WhiteVisionDb }> {
  return requestJson(`/api/clientes/${encodeURIComponent(clientId)}`, { method: "DELETE" });
}

export function saveCampanha(
  campanhaId: string,
  body: {
    status?: string;
    diasAcumulados?: number;
    totalExibicoesAcumuladas?: number;
    clienteNome?: string;
    campanhaNome?: string;
    periodo?: string;
    clientTheme?: ClientTheme;
  }
): Promise<{ db: WhiteVisionDb }> {
  return requestJson(`/api/campanhas/${encodeURIComponent(campanhaId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function saveTela(
  telaId: string,
  body: Partial<TelaPonto>
): Promise<{ db: WhiteVisionDb }> {
  return requestJson(`/api/telas/${encodeURIComponent(telaId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function saveRelatorios(
  items: RelatorioDiarioTela[]
): Promise<{ db: WhiteVisionDb }> {
  return requestJson("/api/relatorios-diarios", {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

export async function uploadClientMedia(
  campaignId: string,
  file: File,
  title: string,
  description: string
): Promise<{ db: WhiteVisionDb }> {
  const query = new URLSearchParams({ titulo: title, descricao: description });
  const response = await fetch(
    `/api/clientes/${encodeURIComponent(campaignId)}/midias?${query.toString()}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": file.type,
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    }
  );
  const payload = (await response.json().catch(() => ({}))) as {
    db?: WhiteVisionDb;
    error?: string;
  };
  if (!response.ok || !payload.db) {
    throw new Error(payload.error || `Falha no envio do arquivo (${response.status})`);
  }
  return { db: payload.db };
}

export function adminMediaPath(fileId: string): string {
  return `/api/admin/midias/${encodeURIComponent(fileId)}`;
}

export function updateClientMedia(
  mediaId: string,
  body: { campanhaId: string; titulo: string; descricao: string }
): Promise<{ db: WhiteVisionDb }> {
  return requestJson(`/api/videos/${encodeURIComponent(mediaId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function removeVideo(videoId: string): Promise<{ db: WhiteVisionDb }> {
  return requestJson(`/api/videos/${encodeURIComponent(videoId)}`, { method: "DELETE" });
}

export function generateReportSummary(campaignId: string): Promise<{ resumo: string }> {
  return requestJson("/api/assistente/resumo", {
    method: "POST",
    body: JSON.stringify({ campaignId }),
  });
}
