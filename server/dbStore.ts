import fs from "fs";
import path from "path";
import { randomBytes, randomUUID } from "crypto";
import type {
  RelatorioDiarioTela,
  PdfReportUpload,
  TelaPonto,
  VideoPortal,
  WhiteVisionDb,
} from "../src/types/adminDb.ts";
import { removeStoredMedia } from "./mediaStore.ts";
import { removeStoredPdf } from "./pdfUploadStore.ts";

const DB_PATH = path.resolve(process.cwd(), "data", "whitevision-db.json");

function emptyDb(): WhiteVisionDb {
  return {
    campanhas: [],
    pontos: [],
    telas: [],
    relatoriosDiarios: [],
    videos: [],
    relatoriosPdf: [],
  };
}

function normalizePdfStatus(status: string): PdfReportUpload["status"] | null {
  switch (status) {
    case "analisando":
    case "analisado":
    case "salvo":
    case "perfil_salvo":
    case "falhou":
      return status;
    case "processado":
      return "perfil_salvo";
    case "processando":
      return "falhou";
    default:
      return null;
  }
}

function makeSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createUniqueSlug(db: WhiteVisionDb, clientName: string): string {
  const base = makeSlug(clientName) || "cliente";
  const existing = new Set(db.campanhas.map((campaign) => campaign.slug));
  let slug: string;
  do {
    slug = `${base}-${randomBytes(16).toString("hex")}`;
  } while (existing.has(slug));
  return slug;
}

export function readDb(): WhiteVisionDb {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const initial = emptyDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }

  const raw = fs.readFileSync(DB_PATH, "utf8");
  const parsed = JSON.parse(raw) as WhiteVisionDb;
  const usedSlugs = new Set<string>();
  const campanhas = (parsed.campanhas || []).map((storedCampaign) => {
    const campaign: WhiteVisionDb["campanhas"][number] = {
      id: storedCampaign.id,
      slug: storedCampaign.slug,
      clienteNome: storedCampaign.clienteNome,
      campanhaNome: storedCampaign.campanhaNome,
      token: storedCampaign.token,
      diasAcumulados: storedCampaign.diasAcumulados,
      totalExibicoesAcumuladas: storedCampaign.totalExibicoesAcumuladas,
      status: storedCampaign.status,
      periodo: storedCampaign.periodo,
      ...(typeof storedCampaign.mesAno === "string" ? { mesAno: storedCampaign.mesAno } : {}),
      frequenciaGeral: storedCampaign.frequenciaGeral,
      ...(typeof storedCampaign.resumoRelatorio === "string"
        ? { resumoRelatorio: storedCampaign.resumoRelatorio }
        : {}),
      ...(storedCampaign.clientTheme &&
      typeof storedCampaign.clientTheme === "object"
        ? { clientTheme: storedCampaign.clientTheme }
        : {}),
      ...(storedCampaign.metricasDashboard
        ? { metricasDashboard: storedCampaign.metricasDashboard }
        : {}),
    };
    const storedSlug =
      typeof campaign.slug === "string" && /^[a-z0-9-]+$/.test(campaign.slug)
        ? campaign.slug
        : "";
    let slug = storedSlug || makeSlug(campaign.id) || "cliente";
    if (usedSlugs.has(slug)) slug = createUniqueSlug({ ...emptyDb(), campanhas }, campaign.clienteNome);
    usedSlugs.add(slug);
    return { ...campaign, slug };
  });
  const campaignIds = new Set(campanhas.map((campaign) => campaign.id));
  const relatoriosPdf = (parsed.relatoriosPdf || []).flatMap((upload) => {
    const status = normalizePdfStatus(String(upload.status));
    if (
      !status ||
      typeof upload.id !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(upload.id) ||
      !campaignIds.has(upload.campanhaId) ||
      typeof upload.nomeArquivo !== "string"
    ) {
      return [];
    }
    return [{ ...upload, status }];
  });
  return {
    campanhas,
    pontos: parsed.pontos || [],
    telas: parsed.telas || [],
    relatoriosDiarios: parsed.relatoriosDiarios || [],
    relatoriosPdf,
    videos: (parsed.videos || [])
      .filter(
        (video) =>
          typeof video.arquivoId === "string" &&
          /^[a-f0-9-]{36}$/i.test(video.arquivoId) &&
          typeof video.nomeArquivo === "string" &&
          ["video/mp4", "image/png", "image/jpeg"].includes(video.mimeType)
      )
      .map((video) => ({ ...video, campanhaId: campaignIds.has(video.campanhaId) ? video.campanhaId : "" })),
  };
}

export function createClient(input: { clienteNome: string; campanhaNome: string }): WhiteVisionDb {
  const db = readDb();
  const clientName = input.clienteNome.trim();
  const campaignName = input.campanhaNome.trim();
  const campaign: WhiteVisionDb["campanhas"][number] = {
    id: randomUUID(),
    slug: createUniqueSlug(db, clientName),
    clienteNome: clientName,
    campanhaNome: campaignName,
    token: randomBytes(16).toString("hex"),
    diasAcumulados: 0,
    totalExibicoesAcumuladas: 0,
    status: "ativa",
    periodo: "Ainda não há relatório importado",
    frequenciaGeral: "",
  };
  db.campanhas.push(campaign);
  return writeDb(db);
}

export function deleteClient(campaignId: string): WhiteVisionDb {
  const db = readDb();
  const campaign = db.campanhas.find((item) => item.id === campaignId);
  if (!campaign) throw new Error("Cliente não encontrado.");

  const points = db.pontos.filter((point) => point.campanhaId === campaignId);
  const pointIds = new Set(points.map((point) => point.id));
  const screenIds = new Set(
    db.telas.filter((screen) => pointIds.has(screen.pontoId)).map((screen) => screen.id)
  );
  const clientMedia = db.videos.filter((item) => item.campanhaId === campaignId);

  db.campanhas = db.campanhas.filter((item) => item.id !== campaignId);
  db.pontos = db.pontos.filter((item) => item.campanhaId !== campaignId);
  db.telas = db.telas.filter((item) => !pointIds.has(item.pontoId));
  db.relatoriosDiarios = db.relatoriosDiarios.filter((item) => !screenIds.has(item.telaId));
  db.videos = db.videos.filter((item) => item.campanhaId !== campaignId);
  const clientPdfUploads = db.relatoriosPdf.filter((item) => item.campanhaId === campaignId);
  db.relatoriosPdf = db.relatoriosPdf.filter((item) => item.campanhaId !== campaignId);
  writeDb(db);
  for (const media of clientMedia) removeStoredMedia(media.arquivoId);
  for (const upload of clientPdfUploads) removeStoredPdf(upload.id);
  return db;
}

export function writeDb(db: WhiteVisionDb): WhiteVisionDb {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  return db;
}

export function addPdfReportUpload(upload: PdfReportUpload): WhiteVisionDb {
  const db = readDb();
  if (!db.campanhas.some((campaign) => campaign.id === upload.campanhaId)) {
    throw new Error("Cliente do relatório PDF não encontrado.");
  }
  db.relatoriosPdf.push(upload);
  return writeDb(db);
}

export function updatePdfReportUpload(
  uploadId: string,
  patch: Partial<Pick<PdfReportUpload, "status" | "erro" | "relatorio" | "resumoIA">>
): WhiteVisionDb {
  const db = readDb();
  const index = db.relatoriosPdf.findIndex((upload) => upload.id === uploadId);
  if (index === -1) throw new Error("Registro do PDF enviado não encontrado.");
  db.relatoriosPdf[index] = {
    ...db.relatoriosPdf[index],
    ...patch,
    ...(patch.status === "falhou"
      ? { erro: patch.erro || "Falha no processamento do PDF." }
      : patch.erro === undefined
        ? { erro: undefined }
        : { erro: patch.erro }),
  };
  return writeDb(db);
}

export function deletePdfReportUpload(uploadId: string): WhiteVisionDb {
  const db = readDb();
  const index = db.relatoriosPdf.findIndex((upload) => upload.id === uploadId);
  if (index === -1) throw new Error("PDF salvo não encontrado.");
  const [upload] = db.relatoriosPdf.splice(index, 1);
  removeStoredPdf(upload.id);
  return writeDb(db);
}

export function patchCampanha(
  campanhaId: string,
  patch: Partial<WhiteVisionDb["campanhas"][number]>
): WhiteVisionDb {
  const db = readDb();
  const index = db.campanhas.findIndex((item) => item.id === campanhaId);
  if (index === -1) {
    throw new Error(`Campanha ${campanhaId} não encontrada.`);
  }
  db.campanhas[index] = { ...db.campanhas[index], ...patch, id: campanhaId };
  return writeDb(db);
}

export function patchTela(telaId: string, patch: Partial<TelaPonto>): WhiteVisionDb {
  const db = readDb();
  const index = db.telas.findIndex((item) => item.id === telaId);
  if (index === -1) {
    throw new Error(`Tela ${telaId} não encontrada.`);
  }
  db.telas[index] = { ...db.telas[index], ...patch, id: telaId };

  if (typeof patch.metaDiaria === "number") {
    db.relatoriosDiarios = db.relatoriosDiarios.map((item) =>
      item.telaId === telaId ? { ...item, metaDiaria: patch.metaDiaria as number } : item
    );
  }

  return writeDb(db);
}

export function upsertRelatorios(items: RelatorioDiarioTela[]): WhiteVisionDb {
  const db = readDb();
  const byId = new Map(db.relatoriosDiarios.map((item) => [item.id, item]));

  for (const item of items) {
    const current = byId.get(item.id);
    byId.set(item.id, { ...current, ...item });
  }

  db.relatoriosDiarios = [...byId.values()].sort(
    (a, b) => a.data.localeCompare(b.data) || a.telaId.localeCompare(b.telaId)
  );
  return writeDb(db);
}

export function createVideo(video: VideoPortal): WhiteVisionDb {
  const db = readDb();
  db.videos.push(video);
  return writeDb(db);
}

export function updateVideoMetadata(
  videoId: string,
  patch: Pick<VideoPortal, "campanhaId" | "titulo" | "descricao">
): WhiteVisionDb {
  const db = readDb();
  const index = db.videos.findIndex((item) => item.id === videoId);
  if (index === -1) throw new Error("Arquivo de mídia não encontrado.");
  db.videos[index] = { ...db.videos[index], ...patch };
  return writeDb(db);
}

export function deleteVideo(videoId: string): WhiteVisionDb {
  const db = readDb();
  const index = db.videos.findIndex((item) => item.id === videoId);
  if (index === -1) {
    throw new Error(`Vídeo ${videoId} não encontrado.`);
  }
  const [removed] = db.videos.splice(index, 1);
  writeDb(db);
  removeStoredMedia(removed.arquivoId);
  return db;
}
