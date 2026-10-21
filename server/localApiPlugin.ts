import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import type { Plugin } from "vite";
import type {
  PdfReportUpload,
  RelatorioDiarioTela,
  TelaPonto,
  WhiteVisionDb,
} from "../src/types/adminDb.ts";
import type { RelatorioData } from "../src/types/whiteVision.ts";
import {
  extrairRelatorioWhiteVision,
  gerarResumoRelatorioWhiteVision,
  testarConexaoGemini,
} from "../src/services/geminiRelatorioWhiteVision.ts";
import {
  createClient,
  createVideo,
  addPdfReportUpload,
  deletePdfReportUpload,
  deleteClient,
  deleteVideo,
  patchCampanha,
  patchTela,
  readDb,
  upsertRelatorios,
  updateVideoMetadata,
  updatePdfReportUpload,
} from "./dbStore.ts";
import { buildRelatorioData } from "./relatorioMapper.ts";
import { hasValidSession, login, logout } from "./auth.ts";
import { normalizeExtractedReport, persistExtractedReport } from "./reportImport.ts";
import { PdfEvidenceError } from "./pdfEvidence.ts";
import { readStoredPdf, removeStoredPdf, storePdfReport } from "./pdfUploadStore.ts";
import {
  getGeminiApiKey,
  geminiApiKeyStatus,
  setGeminiApiKey,
} from "./geminiKeyStore.ts";
import {
  getMediaMaxBytes,
  readStoredMedia,
  removeStoredMedia,
  storeUploadedMedia,
  validateUploadedMedia,
} from "./mediaStore.ts";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 15 * 1024 * 1024;
const MAX_MEDIA_REQUEST_BYTES = 100 * 1024 * 1024;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function sendMedia(
  req: IncomingMessage,
  res: ServerResponse,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  inline: boolean
): void {
  const safeName = fileName.replace(/[^\w.-]/g, "_");
  const range = req.headers.range;
  let start = 0;
  let end = buffer.length - 1;
  let statusCode = 200;
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${buffer.length}`);
      res.end();
      return;
    }
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${buffer.length}`);
        res.end();
        return;
      }
      start = Math.max(0, buffer.length - suffixLength);
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : end;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= buffer.length || end < start) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${buffer.length}`);
      res.end();
      return;
    }
    end = Math.min(end, buffer.length - 1);
    statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${buffer.length}`);
  }
  res.statusCode = statusCode;
  res.setHeader("Content-Type", mimeType);
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  );
  res.setHeader("Content-Length", end - start + 1);
  if (mimeType === "video/mp4") res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.end(buffer.subarray(start, end + 1));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      if (size > MAX_REQUEST_BYTES) return;
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new ApiError("Corpo da requisição excede o limite de 15 MB.", 413));
        chunks.length = 0;
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (size <= MAX_REQUEST_BYTES) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function readBinaryBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes && !exceeded) {
        exceeded = true;
        chunks.length = 0;
        reject(new ApiError(`Arquivo excede o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`, 413));
        return;
      }
      if (!exceeded) chunks.push(buffer);
    });
    req.on("end", () => {
      if (!exceeded) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = await readBody(req);
  if (!raw.trim()) {
    throw new ApiError("Corpo JSON obrigatório.", 400);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError("JSON inválido.", 400);
  }
}

function pathnameOf(req: IncomingMessage): string {
  const url = req.url || "/";
  return url.split("?")[0];
}

export function whiteVisionApiMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
): void {
  const pathname = pathnameOf(req);
  if (req.method === "GET" && pathname === "/white-vision-logo.png") {
    const logoPath = path.resolve(process.cwd(), "public", "white-vision-logo.png");
    if (!fs.existsSync(logoPath)) {
      res.statusCode = 404;
      res.end("Logo não encontrada.");
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache");
    res.end(fs.readFileSync(logoPath));
    return;
  }
  const clientLogoMatch = pathname.match(/^\/client-logos\/([a-f0-9-]{36}\.png)$/i);
  if (req.method === "GET" && clientLogoMatch) {
    const logoPath = path.resolve(process.cwd(), "public", "client-logos", clientLogoMatch[1]);
    if (!fs.existsSync(logoPath)) {
      res.statusCode = 404;
      res.end("Logo do cliente não encontrada.");
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(fs.readFileSync(logoPath));
    return;
  }
  if (!pathname.startsWith("/api/")) {
    next();
    return;
  }

  void handleApi(req, res)
    .then((handled) => {
      if (!handled) next();
    })
    .catch((error: unknown) => {
      const status = error instanceof ApiError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (status === 500) console.error("Erro na API local:", error);
      sendJson(res, status, { error: message });
    });
}

function validateCount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(`${label} deve ser um número inteiro igual ou maior que zero.`, 400);
  }
  return value;
}

function isReportStatus(value: unknown): value is RelatorioDiarioTela["statusRelatorio"] {
  return (
    value === "normal" ||
    value === "alerta" ||
    value === "zerado" ||
    value === "desconhecido"
  );
}

function validateCampanhaPatch(
  body: Record<string, unknown>
): Partial<WhiteVisionDb["campanhas"][number]> {
  const patch: Partial<WhiteVisionDb["campanhas"][number]> = {};
  if ("clienteNome" in body) {
    if (typeof body.clienteNome !== "string" || !body.clienteNome.trim() || body.clienteNome.length > 120) {
      throw new ApiError("O nome do cliente é obrigatório e deve ter até 120 caracteres.", 400);
    }
    patch.clienteNome = body.clienteNome.trim();
  }
  if ("campanhaNome" in body) {
    if (typeof body.campanhaNome !== "string" || !body.campanhaNome.trim() || body.campanhaNome.length > 120) {
      throw new ApiError("O nome da campanha é obrigatório e deve ter até 120 caracteres.", 400);
    }
    patch.campanhaNome = body.campanhaNome.trim();
  }
  if ("status" in body) {
    const status = body.status;
    if (status !== "ativa" && status !== "pausada" && status !== "encerrada") {
      throw new ApiError("Status de campanha inválido.", 400);
    }
    patch.status = status;
  }
  if ("diasAcumulados" in body) {
    patch.diasAcumulados = validateCount(body.diasAcumulados, "Dias acumulados");
  }
  if ("totalExibicoesAcumuladas" in body) {
    patch.totalExibicoesAcumuladas = validateCount(
      body.totalExibicoesAcumuladas,
      "Total de exibições"
    );
  }
  if ("periodo" in body) {
    if (typeof body.periodo !== "string" || !body.periodo.trim() || body.periodo.length > 200) {
      throw new ApiError("O período é obrigatório e deve ter até 200 caracteres.", 400);
    }
    patch.periodo = body.periodo.trim();
  }
  if ("clientTheme" in body) {
    const theme = body.clientTheme;
    if (!theme || typeof theme !== "object" || Array.isArray(theme)) {
      throw new ApiError("Configuração de tema do cliente inválida.", 400);
    }
    const value = theme as Record<string, unknown>;
    const isHexColor = (color: unknown): color is string =>
      typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color);
    const logoUrl = value.logoUrl;
    const logoSize = value.logoSize;
    const logoBgColor = value.logoBgColor;
    const safeLogoUrl =
      typeof logoUrl === "string" &&
      logoUrl.length <= 500 &&
      (!logoUrl ||
        (logoUrl.startsWith("/") && !logoUrl.startsWith("//") ||
          /^https:\/\//i.test(logoUrl)));
    if (
      !isHexColor(value.frameColor) ||
      !isHexColor(value.primaryColor) ||
      !isHexColor(logoBgColor) ||
      typeof logoSize !== "number" ||
      !Number.isInteger(logoSize) ||
      logoSize < 20 ||
      logoSize > 150 ||
      typeof value.topBannerText !== "string" ||
      value.topBannerText.length > 500 ||
      !safeLogoUrl
    ) {
      throw new ApiError("Informe cores hexadecimais, tamanho de logo entre 20 e 150 px, texto de até 500 caracteres e uma URL segura para a logo.", 400);
    }
    patch.clientTheme = {
      frameColor: value.frameColor,
      topBannerText: value.topBannerText,
      logoUrl,
      primaryColor: value.primaryColor,
      logoSize,
      logoBgColor,
    };
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiError("Informe ao menos um campo válido para atualizar.", 400);
  }
  return patch;
}

function validateTelaPatch(body: Record<string, unknown>): Partial<TelaPonto> {
  const patch: Partial<TelaPonto> = {};
  if ("metaDiaria" in body) {
    patch.metaDiaria = validateCount(body.metaDiaria, "Meta diária");
  }
  if ("status" in body) {
    const status = body.status;
    if (status !== "online" && status !== "offline" && status !== "desconhecido") {
      throw new ApiError("Status da tela inválido.", 400);
    }
    patch.status = status;
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiError("Informe ao menos um campo válido para atualizar.", 400);
  }
  return patch;
}

function validateRelatorios(value: unknown, db: WhiteVisionDb): RelatorioDiarioTela[] {
  if (!Array.isArray(value)) throw new ApiError("A lista de relatórios é obrigatória.", 400);
  const telaIds = new Set(db.telas.map((tela) => tela.id));
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ApiError(`Relatório ${index + 1} inválido.`, 400);
    }
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : "";
    const data = typeof item.data === "string" ? item.data : "";
    const telaId = typeof item.telaId === "string" ? item.telaId : "";
    const validDate =
      /^\d{4}-\d{2}-\d{2}$/.test(data) &&
      !Number.isNaN(Date.parse(`${data}T00:00:00Z`)) &&
      new Date(`${data}T00:00:00Z`).toISOString().slice(0, 10) === data;
    if (
      !id.trim() ||
      id.length > 200 ||
      !validDate ||
      !telaIds.has(telaId) ||
      typeof item.falhaNominal !== "boolean"
    ) {
      throw new ApiError(`Dados inválidos no relatório ${index + 1}.`, 400);
    }
    if (
      item.observacaoFalha !== undefined &&
      (typeof item.observacaoFalha !== "string" || item.observacaoFalha.length > 500)
    ) {
      throw new ApiError(`Observação inválida no relatório ${index + 1}.`, 400);
    }
    if (item.statusRelatorio !== undefined && !isReportStatus(item.statusRelatorio)) {
      throw new ApiError(`Status inválido no relatório ${index + 1}.`, 400);
    }
    return {
      id,
      data,
      telaId,
      exibicoesEntregues: validateCount(item.exibicoesEntregues, "Exibições entregues"),
      metaDiaria:
        item.metaDiaria === null
          ? null
          : validateCount(item.metaDiaria, "Meta diária"),
      falhaNominal: item.falhaNominal,
      ...(isReportStatus(item.statusRelatorio)
        ? { statusRelatorio: item.statusRelatorio }
        : {}),
      ...(typeof item.observacaoFalha === "string"
        ? { observacaoFalha: item.observacaoFalha }
        : {}),
    };
  });
}

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const method = (req.method || "GET").toUpperCase();
  const pathname = pathnameOf(req);

  if (!pathname.startsWith("/api/")) {
    return false;
  }

  const publicMediaMatch = pathname.match(
    /^\/api\/public\/clientes\/([^/]+)\/midias\/([a-f0-9-]{36})$/i
  );
  if (method === "GET" && publicMediaMatch) {
    let slug: string;
    try {
      slug = decodeURIComponent(publicMediaMatch[1]);
    } catch {
      throw new ApiError("Link de cliente inválido.", 404);
    }
    const db = readDb();
    const campaign = db.campanhas.find((item) => item.slug === slug);
    const media = db.videos.find(
      (item) =>
        item.arquivoId === publicMediaMatch[2] &&
        item.campanhaId === campaign?.id
    );
    if (!campaign || !media) throw new ApiError("Arquivo não encontrado para este cliente.", 404);
    const buffer = readStoredMedia(media.arquivoId);
    if (!buffer) throw new ApiError("Arquivo de mídia indisponível.", 404);
    const download = new URL(req.url || "/", "http://localhost").searchParams.get("download") === "1";
    sendMedia(req, res, buffer, media.mimeType, media.nomeArquivo, !download);
    return true;
  }

  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (method === "GET" && pathname === "/api/auth/session") {
    sendJson(res, 200, { authenticated: hasValidSession(req) });
    return true;
  }

  const publicClientMatch = pathname.match(/^\/api\/public\/clientes\/([^/]+)$/);
  if (method === "GET" && publicClientMatch) {
    let slug: string;
    try {
      slug = decodeURIComponent(publicClientMatch[1]);
    } catch {
      throw new ApiError("Link de cliente inválido.", 404);
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new ApiError("Cliente não encontrado.", 404);
    }
    const db = readDb();
    const campaign = db.campanhas.find((item) => item.slug === slug);
    if (!campaign) {
      throw new ApiError("Cliente não encontrado.", 404);
    }
    const report = buildRelatorioData(db, campaign.id);
    sendJson(res, 200, { report: { ...report, token: "" } });
    return true;
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await parseJsonBody<{ username?: unknown; password?: unknown }>(req);
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      throw new ApiError("Usuário e senha são obrigatórios.", 400);
    }
    const result = login(req, res, body.username, body.password);
    if (result === "unconfigured") {
      throw new ApiError("Configure ADMIN_USERNAME, ADMIN_PASSWORD e SESSION_SECRET no .env.", 503);
    }
    if (result === "invalid") {
      throw new ApiError("Usuário ou senha inválidos.", 401);
    }
    sendJson(res, 200, { authenticated: true });
    return true;
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    logout(res);
    sendJson(res, 200, { authenticated: false });
    return true;
  }

  if (!hasValidSession(req)) {
    sendJson(res, 401, { error: "Autenticação obrigatória." });
    return true;
  }

  const adminMediaMatch = pathname.match(/^\/api\/admin\/midias\/([a-f0-9-]{36})$/i);
  if (method === "GET" && adminMediaMatch) {
    const media = readDb().videos.find((item) => item.arquivoId === adminMediaMatch[1]);
    if (!media) throw new ApiError("Arquivo não encontrado.", 404);
    const buffer = readStoredMedia(media.arquivoId);
    if (!buffer) throw new ApiError("Arquivo de mídia indisponível.", 404);
    const download = new URL(req.url || "/", "http://localhost").searchParams.get("download") === "1";
    sendMedia(req, res, buffer, media.mimeType, media.nomeArquivo, !download);
    return true;
  }

  if (method === "PUT" && pathname === "/api/admin/logo") {
    if (req.headers["content-type"]?.toLowerCase() !== "image/png") {
      throw new ApiError("Envie a logo em formato PNG.", 400);
    }
    if (req.headers["content-length"] && Number(req.headers["content-length"]) > MAX_LOGO_BYTES) {
      throw new ApiError("A logo deve ter no máximo 5 MB.", 413);
    }
    const buffer = await readBinaryBody(req, MAX_LOGO_BYTES);
    const validPng =
      buffer.length >= 45 &&
      buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      buffer.toString("ascii", 12, 16) === "IHDR" &&
      buffer.readUInt32BE(16) > 0 &&
      buffer.readUInt32BE(20) > 0 &&
      buffer.readUInt32BE(16) <= 8192 &&
      buffer.readUInt32BE(20) <= 8192 &&
      buffer.includes(Buffer.from("IDAT")) &&
      buffer.subarray(-8, -4).toString("ascii") === "IEND";
    if (!validPng) {
      throw new ApiError("O conteúdo enviado não é um PNG válido.", 400);
    }
    const logoPath = path.resolve(process.cwd(), "public", "white-vision-logo.png");
    const temporaryPath = `${logoPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, buffer, { flag: "wx" });
      fs.renameSync(temporaryPath, logoPath);
    } catch (error) {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      throw error;
    }
    sendJson(res, 200, { updated: true });
    return true;
  }

  if (method === "POST" && pathname === "/api/admin/client-logos") {
    if (req.headers["content-type"]?.toLowerCase() !== "image/png") {
      throw new ApiError("A logo convertida deve estar em formato PNG.", 400);
    }
    if (req.headers["content-length"] && Number(req.headers["content-length"]) > MAX_LOGO_BYTES) {
      throw new ApiError("A logo deve ter no máximo 5 MB.", 413);
    }
    const buffer = await readBinaryBody(req, MAX_LOGO_BYTES);
    const validPng =
      buffer.length >= 45 &&
      buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      buffer.toString("ascii", 12, 16) === "IHDR" &&
      buffer.readUInt32BE(16) > 0 &&
      buffer.readUInt32BE(20) > 0 &&
      buffer.readUInt32BE(16) <= 8192 &&
      buffer.readUInt32BE(20) <= 8192 &&
      buffer.includes(Buffer.from("IDAT")) &&
      buffer.subarray(-8, -4).toString("ascii") === "IEND";
    if (!validPng) {
      throw new ApiError("O conteúdo enviado não é uma imagem PNG válida.", 400);
    }
    const directory = path.resolve(process.cwd(), "public", "client-logos");
    fs.mkdirSync(directory, { recursive: true });
    const fileName = `${randomUUID()}.png`;
    fs.writeFileSync(path.join(directory, fileName), buffer, { flag: "wx" });
    sendJson(res, 201, { logoUrl: `/client-logos/${fileName}` });
    return true;
  }

  if (pathname === "/api/admin/gemini-key" && method === "GET") {
    sendJson(res, 200, { status: geminiApiKeyStatus() });
    return true;
  }

  if (pathname === "/api/admin/gemini-key" && method === "PUT") {
    const body = await parseJsonBody<{ apiKey?: unknown }>(req);
    if (typeof body.apiKey !== "string") {
      throw new ApiError("Informe uma chave de API válida.", 400);
    }
    const apiKey = body.apiKey.trim();
    if (
      apiKey.length < 20 ||
      apiKey.length > 512 ||
      /[\r\n]/.test(apiKey)
    ) {
      throw new ApiError("A chave informada não tem um formato válido.", 400);
    }
    setGeminiApiKey(apiKey);
    sendJson(res, 200, { status: "memoria" });
    return true;
  }

  if (pathname === "/api/admin/gemini-key/test" && method === "POST") {
    try {
      await testarConexaoGemini();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha ao testar a conexão Gemini.";
      throw new ApiError(message, 502);
    }
    sendJson(res, 200, { connected: true });
    return true;
  }

  if (method === "GET" && pathname === "/api/estado") {
    sendJson(res, 200, { db: readDb() });
    return true;
  }

  if (method === "POST" && pathname === "/api/clientes") {
    const body = await parseJsonBody<{ clienteNome?: unknown; campanhaNome?: unknown }>(req);
    if (
      typeof body.clienteNome !== "string" ||
      !body.clienteNome.trim() ||
      body.clienteNome.trim().length > 120 ||
      typeof body.campanhaNome !== "string" ||
      !body.campanhaNome.trim() ||
      body.campanhaNome.trim().length > 120
    ) {
      throw new ApiError("Informe nome do cliente e da campanha (até 120 caracteres cada).", 400);
    }
    const db = createClient({
      clienteNome: body.clienteNome.trim(),
      campanhaNome: body.campanhaNome.trim(),
    });
    const client = db.campanhas[db.campanhas.length - 1];
    sendJson(res, 201, {
      db,
      clientPath: `/cliente/${encodeURIComponent(client.slug)}`,
    });
    return true;
  }

  const clientMatch = pathname.match(/^\/api\/clientes\/([^/]+)$/);
  if (clientMatch && method === "DELETE") {
    let clientId: string;
    try {
      clientId = decodeURIComponent(clientMatch[1]);
    } catch {
      throw new ApiError("Identificador de cliente inválido.", 400);
    }
    if (!readDb().campanhas.some((item) => item.id === clientId)) {
      throw new ApiError("Cliente não encontrado.", 404);
    }
    sendJson(res, 200, { db: deleteClient(clientId) });
    return true;
  }

  if (method === "GET" && pathname === "/api/relatorio") {
    const db = readDb();
    sendJson(res, 200, buildRelatorioData(db));
    return true;
  }

  const pdfUploadMatch = pathname.match(/^\/api\/admin\/clientes\/([^/]+)\/relatorios-pdf$/);
  if (method === "POST" && pdfUploadMatch) {
    let campaignId: string;
    try {
      campaignId = decodeURIComponent(pdfUploadMatch[1]);
    } catch {
      throw new ApiError("Identificador de cliente inválido.", 400);
    }
    if (!readDb().campanhas.some((item) => item.id === campaignId)) {
      throw new ApiError("Selecione o cliente que receberá este relatório.", 400);
    }
    if (req.headers["content-type"]?.toLowerCase() !== "application/pdf") {
      throw new ApiError("Envie o relatório no formato PDF.", 400);
    }
    if (req.headers["content-length"] && Number(req.headers["content-length"]) > MAX_PDF_BYTES) {
      throw new ApiError("O PDF deve ter no máximo 10 MB.", 413);
    }
    const encodedFileName = req.headers["x-file-name"];
    if (typeof encodedFileName !== "string") {
      throw new ApiError("O nome do arquivo PDF não foi informado.", 400);
    }
    let fileName: string;
    try {
      fileName = decodeURIComponent(encodedFileName);
    } catch {
      throw new ApiError("O nome do arquivo PDF é inválido.", 400);
    }
    const pdfBuffer = await readBinaryBody(req, MAX_PDF_BYTES);
    if (!pdfBuffer.length || pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new ApiError("Envie um arquivo PDF válido de até 10 MB.", 400);
    }

    let upload: PdfReportUpload;
    try {
      upload = storePdfReport(pdfBuffer, campaignId, fileName);
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? error.message : "Não foi possível salvar o PDF enviado.",
        500
      );
    }
    try {
      addPdfReportUpload(upload);
    } catch (error) {
      removeStoredPdf(upload.id);
      throw new ApiError(
        error instanceof Error ? error.message : "Não foi possível registrar o PDF salvo.",
        500
      );
    }

    try {
      if (!getGeminiApiKey()) {
        throw new ApiError("Configure a chave do Gemini no .env do servidor ou no painel administrativo.", 503);
      }
      const storedPdf = readStoredPdf(upload.id);
      const analysisStartedAt = Date.now();
      console.log(
        `[PDF ${upload.id}] Enviando PDF salvo ao Gemini (${storedPdf.length} bytes, cliente ${campaignId}).`
      );
      let extracted: RelatorioData;
      try {
        extracted = await extrairRelatorioWhiteVision(storedPdf);
        console.log(
          `[PDF ${upload.id}] Resposta do Gemini recebida em ${Date.now() - analysisStartedAt} ms.`
        );
      } catch (error) {
        console.error(`[PDF ${upload.id}] Erro exato retornado pelo Gemini:`, error);
        throw error;
      }
      const selectedCampaign = readDb().campanhas.find((item) => item.id === campaignId);
      const report = normalizeExtractedReport(extracted, {
        campaignName: selectedCampaign?.campanhaNome,
      });
      const { db, campaign: client } = persistExtractedReport(report, campaignId, undefined, upload.id);
      console.log(`[PDF ${upload.id}] Relatório salvo no histórico e perfil de ${client.clienteNome}.`);
      sendJson(res, 201, {
        db,
        uploadId: upload.id,
        campaignId,
        clientName: client?.clienteNome || "",
        clientPath: `/cliente/${encodeURIComponent(client?.slug || "")}`,
        report,
        totals: {
          totalExibicoesPeriodo: report.totalExibicoesPeriodo,
          mediaDiariaPeriodo: report.mediaDiariaPeriodo,
          diasEmExibicaoTotal: report.diasEmExibicaoTotal,
          totalExibicoesHistorico: report.totalExibicoesHistorico,
        },
      });
    } catch (error) {
      let status = 502;
      let message = "O Gemini não conseguiu analisar o PDF. O arquivo permanece salvo no histórico de PDFs enviados.";
      if (error instanceof ApiError) {
        status = error.status;
        message = `${error.message} O PDF enviado foi salvo.`;
      } else if (error instanceof PdfEvidenceError) {
        status = 422;
        message = `${error.message} O PDF enviado foi salvo.`;
      } else if (error instanceof Error && /timeout|timed out|abort|deadline|DEADLINE_EXCEEDED/i.test(error.message)) {
        status = 504;
        message = "A chamada ao Gemini foi interrompida antes de concluir. O arquivo permanece salvo no histórico de PDFs enviados.";
      } else if (
        error instanceof Error &&
        ("status" in error ? Number(error.status) === 503 : false)
      ) {
        status = 503;
        message = "Os modelos Gemini estão temporariamente indisponíveis ou sobrecarregados. O PDF permanece salvo; tente novamente em alguns minutos.";
      } else if (
        error instanceof Error &&
        ("status" in error ? Number(error.status) === 429 : false)
      ) {
        status = 429;
        message = "A cota de solicitações do Gemini foi atingida. O PDF permanece salvo; verifique a cota da chave ou tente mais tarde.";
      } else if (
        error instanceof Error &&
        ("status" in error ? [400, 401, 403, 404].includes(Number(error.status)) : false)
      ) {
        status = 502;
        let details = error.message;
        try {
          const parsed = JSON.parse(error.message) as { error?: { message?: unknown } };
          if (typeof parsed.error?.message === "string") details = parsed.error.message;
        } catch {
          // Keep the SDK message when it is not a JSON API error.
        }
        message = `A API do Gemini recusou a solicitação: ${details.slice(0, 400)} O PDF permanece salvo.`;
      } else if (error instanceof Error) {
        status = 422;
        message = `${error.message.slice(0, 500)} O PDF enviado foi salvo.`;
      }
      console.error(
        "Falha detalhada ao analisar PDF:",
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined
      );

      try {
        const db = updatePdfReportUpload(upload.id, {
          status: "falhou",
          erro: message,
        });
        sendJson(res, status, {
          error: message,
          pdfSaved: true,
          uploadId: upload.id,
          db,
        });
      } catch (persistError) {
        console.error("Falha ao registrar o estado do processamento do PDF:", persistError);
        sendJson(res, 500, {
          error: `${message} O arquivo PDF foi preservado, mas o estado do processamento não pôde ser atualizado.`,
          pdfSaved: true,
          uploadId: upload.id,
        });
      }
    }
    return true;
  }

  const pdfActionMatch = pathname.match(
    /^\/api\/admin\/relatorios-pdf\/([a-f0-9-]{36})(?:\/(salvar|resumo|salvar-perfil))?$/i
  );
  if (pdfActionMatch && method === "DELETE" && !pdfActionMatch[2]) {
    sendJson(res, 200, { db: deletePdfReportUpload(pdfActionMatch[1]) });
    return true;
  }
  if (pdfActionMatch && method === "POST" && pdfActionMatch[2]) {
    const upload = readDb().relatoriosPdf.find((item) => item.id === pdfActionMatch[1]);
    if (!upload) throw new ApiError("PDF salvo não encontrado.", 404);
    const action = pdfActionMatch[2];

    if (action === "salvar") {
      if (upload.status !== "analisado") {
        throw new ApiError("Analise o PDF antes de salvá-lo no histórico.", 409);
      }
      sendJson(res, 200, { db: updatePdfReportUpload(upload.id, { status: "salvo" }) });
      return true;
    }

    if (!upload.relatorio || !["salvo", "perfil_salvo"].includes(upload.status)) {
      throw new ApiError("Salve o PDF no histórico antes de continuar.", 409);
    }

    if (action === "resumo") {
      try {
        const resumoIA = await gerarResumoRelatorioWhiteVision(upload.relatorio);
        sendJson(res, 200, {
          db: updatePdfReportUpload(upload.id, { resumoIA, erro: undefined }),
          resumoIA,
        });
      } catch (error) {
        console.error(
          "Erro detalhado do Gemini:",
          (error instanceof Error && error.message) || error
        );
        const message = error instanceof Error ? error.message : "Falha ao gerar o resumo da IA.";
        updatePdfReportUpload(upload.id, { erro: `Resumo IA não gerado: ${message}` });
        throw new ApiError(`Não foi possível gerar o resumo pela IA: ${message}`, 502);
      }
      return true;
    }

    if (!upload.resumoIA?.trim()) {
      throw new ApiError("Gere o resumo da IA antes de salvar as informações no perfil do cliente.", 409);
    }
    const result = persistExtractedReport(upload.relatorio, upload.campanhaId, upload.resumoIA);
    const db = updatePdfReportUpload(upload.id, { status: "perfil_salvo", erro: undefined });
    sendJson(res, 200, {
      db,
      campaignId: result.campaign.id,
      clientName: result.campaign.clienteNome,
      clientPath: `/cliente/${encodeURIComponent(result.campaign.slug)}`,
    });
    return true;
  }

  if (method === "POST" && pathname === "/api/assistente/resumo") {
    try {
      const body = await parseJsonBody<{ campaignId?: unknown }>(req);
      const db = readDb();
      const campaignId = typeof body.campaignId === "string" ? body.campaignId : undefined;
      if (campaignId && !db.campanhas.some((item) => item.id === campaignId)) {
        throw new ApiError("Cliente não encontrado.", 404);
      }
      const resumo = await gerarResumoRelatorioWhiteVision(
        buildRelatorioData(db, campaignId)
      );
      sendJson(res, 200, { resumo });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error("Falha ao gerar resumo do Gemini:", error);
      if (error instanceof Error && error.message.includes("GEMINI_API_KEY")) {
        throw new ApiError(error.message, 503);
      }
      throw new ApiError("Não foi possível gerar o resumo com o Gemini. Tente novamente.", 502);
    }
    return true;
  }

  if (method === "GET" && pathname === "/api/videos") {
    sendJson(res, 200, { videos: readDb().videos });
    return true;
  }

  const clientMediaMatch = pathname.match(/^\/api\/clientes\/([^/]+)\/midias$/);
  if (method === "POST" && clientMediaMatch) {
    let campaignId: string;
    try {
      campaignId = decodeURIComponent(clientMediaMatch[1]);
    } catch {
      throw new ApiError("Identificador de cliente inválido.", 400);
    }
    const db = readDb();
    if (!db.campanhas.some((item) => item.id === campaignId)) {
      throw new ApiError("Selecione um cliente válido para o arquivo.", 404);
    }
    if ((req.headers["content-length"] && Number(req.headers["content-length"]) > getMediaMaxBytes()) ||
        typeof req.headers["x-file-name"] !== "string") {
      throw new ApiError("Envie um arquivo MP4, PNG ou JPG de até 100 MB.", 400);
    }
    let fileName: string;
    try {
      fileName = decodeURIComponent(req.headers["x-file-name"]);
    } catch {
      throw new ApiError("Nome do arquivo inválido.", 400);
    }
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const title = requestUrl.searchParams.get("titulo") || fileName;
    const description = requestUrl.searchParams.get("descricao") || "";
    const buffer = await readBinaryBody(req, MAX_MEDIA_REQUEST_BYTES);
    let uploaded;
    try {
      uploaded = validateUploadedMedia(
        buffer,
        fileName,
        String(req.headers["content-type"] || ""),
        title,
        description
      );
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : "Arquivo inválido.", 400);
    }
    const media = storeUploadedMedia(uploaded, campaignId);
    try {
      const updatedDb = createVideo(media);
      sendJson(res, 201, { db: updatedDb });
    } catch (error) {
      removeStoredMedia(media.arquivoId);
      throw error;
    }
    return true;
  }

  const videoMatch = pathname.match(/^\/api\/videos\/([^/]+)$/);
  if (videoMatch && (method === "PUT" || method === "DELETE")) {
    let videoId: string;
    try {
      videoId = decodeURIComponent(videoMatch[1]);
    } catch {
      throw new ApiError("Identificador de vídeo inválido.", 400);
    }
    if (!readDb().videos.some((item) => item.id === videoId)) {
      throw new ApiError("Arquivo de mídia não encontrado.", 404);
    }
    if (method === "DELETE") {
      sendJson(res, 200, { db: deleteVideo(videoId) });
      return true;
    }
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const campaignId = typeof body.campanhaId === "string" ? body.campanhaId.trim() : "";
    const title = typeof body.titulo === "string" ? body.titulo.trim() : "";
    const description = typeof body.descricao === "string" ? body.descricao.trim() : "";
    if (!readDb().campanhas.some((item) => item.id === campaignId)) {
      throw new ApiError("Selecione um cliente válido para este arquivo.", 400);
    }
    if (!title || title.length > 120) {
      throw new ApiError("Informe um título de até 120 caracteres.", 400);
    }
    if (description.length > 2000) {
      throw new ApiError("A descrição deve ter no máximo 2.000 caracteres.", 400);
    }
    sendJson(res, 200, {
      db: updateVideoMetadata(videoId, {
        campanhaId: campaignId,
        titulo: title,
        descricao: description,
      }),
    });
    return true;
  }

  const campanhaMatch = pathname.match(/^\/api\/campanhas\/([^/]+)$/);
  if (method === "PUT" && campanhaMatch) {
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const db = patchCampanha(
      decodeURIComponent(campanhaMatch[1]),
      validateCampanhaPatch(body)
    );
    sendJson(res, 200, { db });
    return true;
  }

  const telaMatch = pathname.match(/^\/api\/telas\/([^/]+)$/);
  if (method === "PUT" && telaMatch) {
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const db = patchTela(decodeURIComponent(telaMatch[1]), validateTelaPatch(body));
    sendJson(res, 200, { db });
    return true;
  }

  if (method === "PUT" && pathname === "/api/relatorios-diarios") {
    const body = await parseJsonBody<{ items?: unknown }>(req);
    const db = upsertRelatorios(validateRelatorios(body.items, readDb()));
    sendJson(res, 200, { db });
    return true;
  }

  sendJson(res, 404, { error: "Rota de API não encontrada." });
  return true;
}

export function whiteVisionLocalApiPlugin(): Plugin {
  return {
    name: "whitevision-local-api",
    configureServer(server) {
      server.middlewares.use(whiteVisionApiMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(whiteVisionApiMiddleware);
    },
  };
}
