import type {
  CampanhaCliente,
  PdfReportUpload,
  PontoTela,
  RelatorioDiarioTela,
  TelaPonto,
  VideoPortal,
  WhiteVisionDb,
} from "../types/adminDb";
import type { ClientTheme, RelatorioData } from "../types/whiteVision";
import { DEFAULT_CLIENT_THEME } from "../types/whiteVision";
import { getPublicMediaUrl, getSupabase } from "./supabase";

type Row = Record<string, unknown>;

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("Supabase não retornou dados.");
  return result.data;
}

function campaignFromRow(row: Row): CampanhaCliente {
  return {
    id: String(row.id),
    slug: String(row.slug),
    clienteNome: String(row.client_name),
    campanhaNome: String(row.campaign_name),
    token: String(row.token),
    diasAcumulados: Number(row.days_accumulated || 0),
    totalExibicoesAcumuladas: Number(row.total_impressions_accumulated || 0),
    status: row.status as CampanhaCliente["status"],
    periodo: String(row.period || ""),
    ...(typeof row.month_year === "string" ? { mesAno: row.month_year } : {}),
    frequenciaGeral: String(row.general_frequency || ""),
    ...(typeof row.report_summary === "string" ? { resumoRelatorio: row.report_summary } : {}),
    clientTheme: (row.client_theme || {}) as ClientTheme,
    metricasDashboard: (row.dashboard_metrics || {}) as CampanhaCliente["metricasDashboard"],
  };
}

function pointFromRow(row: Row): PontoTela {
  return {
    id: String(row.id),
    campanhaId: String(row.campaign_id),
    nome: String(row.name),
    endereco: typeof row.address === "string" ? row.address : "",
    horarioFuncionamento: String(row.operating_hours || ""),
    frequenciaLocal: String(row.local_frequency || ""),
  };
}

function screenFromRow(row: Row): TelaPonto {
  return {
    id: String(row.id),
    pontoId: String(row.point_id),
    nome: String(row.name),
    metaDiaria: typeof row.daily_target === "number" ? row.daily_target : null,
    status: row.status as TelaPonto["status"],
  };
}

function dailyFromRow(row: Row): RelatorioDiarioTela {
  return {
    id: String(row.id),
    data: String(row.report_date),
    telaId: String(row.screen_id),
    exibicoesEntregues: Number(row.impressions_delivered || 0),
    metaDiaria: typeof row.daily_target === "number" ? row.daily_target : null,
    falhaNominal: Boolean(row.nominal_failure),
    ...(typeof row.report_status === "string"
      ? { statusRelatorio: row.report_status as RelatorioDiarioTela["statusRelatorio"] }
      : {}),
    ...(typeof row.failure_note === "string" ? { observacaoFalha: row.failure_note } : {}),
  };
}

function videoFromRow(row: Row): VideoPortal {
  return {
    id: String(row.id),
    campanhaId: String(row.campaign_id),
    titulo: String(row.title),
    descricao: String(row.description || ""),
    arquivoId: String(row.storage_path),
    nomeArquivo: String(row.original_file_name),
    mimeType: row.mime_type as VideoPortal["mimeType"],
    tamanhoBytes: Number(row.size_bytes || 0),
  };
}

function pdfFromRow(row: Row): PdfReportUpload {
  return {
    id: String(row.id),
    campanhaId: String(row.campaign_id),
    nomeArquivo: String(row.original_file_name),
    criadoEm: String(row.created_at),
    status: row.status as PdfReportUpload["status"],
    ...(row.report ? { relatorio: row.report as RelatorioData } : {}),
    ...(typeof row.ai_summary === "string" ? { resumoIA: row.ai_summary } : {}),
    ...(typeof row.error_message === "string" ? { erro: row.error_message } : {}),
  };
}

async function snapshot(): Promise<WhiteVisionDb> {
  const supabase = getSupabase();
  const [campaigns, points, screens, daily, videos, pdfs] = await Promise.all([
    supabase.from("campaigns").select("*").order("created_at"),
    supabase.from("points").select("*"),
    supabase.from("screens").select("*"),
    supabase.from("daily_screen_reports").select("*").order("report_date"),
    supabase.from("videos").select("*").order("created_at", { ascending: false }),
    supabase.from("pdf_reports").select("*").order("created_at", { ascending: false }),
  ]);
  return {
    campanhas: unwrap(campaigns).map((row) => campaignFromRow(row as Row)),
    pontos: unwrap(points).map((row) => pointFromRow(row as Row)),
    telas: unwrap(screens).map((row) => screenFromRow(row as Row)),
    relatoriosDiarios: unwrap(daily).map((row) => dailyFromRow(row as Row)),
    videos: unwrap(videos).map((row) => videoFromRow(row as Row)),
    relatoriosPdf: unwrap(pdfs).map((row) => pdfFromRow(row as Row)),
  };
}

function asDb(db: WhiteVisionDb) {
  return { db };
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function fetchAuthSession(): Promise<{ authenticated: boolean }> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  if (!data.session) return { authenticated: false };
  const admin = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", data.session.user.id)
    .eq("enabled", true)
    .maybeSingle();
  if (admin.error) throw new Error(admin.error.message);
  return { authenticated: Boolean(admin.data) };
}

export async function login(email: string, password: string): Promise<{ authenticated: boolean }> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const admin = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", data.user.id)
    .eq("enabled", true)
    .maybeSingle();
  if (admin.error || !admin.data) {
    await supabase.auth.signOut();
    throw new Error("Esta conta não tem acesso administrativo habilitado.");
  }
  return { authenticated: true };
}

export async function logout(): Promise<{ authenticated: boolean }> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw new Error(error.message);
  return { authenticated: false };
}

export async function fetchEstado(): Promise<{ db: WhiteVisionDb }> {
  return asDb(await snapshot());
}

export type GeminiKeyStatus = "ambiente" | "memoria" | "ausente";

async function invokeGeminiAdmin<T>(body: Row): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke("gemini-admin", { body });
  if (error) throw new Error(error.message);
  return data as T;
}

export function fetchGeminiKeyStatus(): Promise<{ status: GeminiKeyStatus }> {
  return invokeGeminiAdmin({ action: "status" });
}

export function updateGeminiApiKey(apiKey: string): Promise<{ status: GeminiKeyStatus }> {
  return invokeGeminiAdmin({ action: "set-key", apiKey });
}

export function testGeminiConnection(): Promise<{ connected: boolean }> {
  return invokeGeminiAdmin({ action: "test" });
}

async function convertImageToPng(file: File): Promise<Blob> {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth > 8192 ||
      image.naturalHeight > 8192
    ) {
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
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export async function uploadWhiteVisionLogo(file: File): Promise<void> {
  const png = await convertImageToPng(file);
  const { error } = await getSupabase()
    .storage.from("client-media")
    .upload("branding/white-vision-logo.png", png, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "3600",
    });
  if (error) throw new Error(error.message);
}

export async function uploadClientThemeLogo(file: File): Promise<{ logoUrl: string }> {
  const png = await convertImageToPng(file);
  const path = `logos/${crypto.randomUUID()}.png`;
  const { error } = await getSupabase()
    .storage.from("client-media")
    .upload(path, png, { contentType: "image/png", upsert: false });
  if (error) throw new Error(error.message);
  return { logoUrl: getPublicMediaUrl(path) };
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

type PdfResult = {
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
};

export async function importPdfReport(file: File, clientId: string): Promise<{
  db: WhiteVisionDb;
} & PdfResult> {
  const supabase = getSupabase();
  const uploadId = crypto.randomUUID();
  const storagePath = `${clientId}/${uploadId}.pdf`;
  const upload = await supabase.storage.from("report-pdfs").upload(storagePath, file, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upload.error) throw new PdfImportError(upload.error.message, false);
  const record = await supabase.from("pdf_reports").insert({
    id: uploadId,
    campaign_id: clientId,
    original_file_name: file.name,
    storage_path: storagePath,
    status: "analisando",
  });
  if (record.error) {
    await supabase.storage.from("report-pdfs").remove([storagePath]);
    throw new PdfImportError(record.error.message, false);
  }

  const { data, error } = await supabase.functions.invoke<PdfResult>("analyze-pdf", {
    body: { uploadId, campaignId: clientId, storagePath, action: "analyze" },
  });
  if (error || !data) {
    const message = error?.message || "A Edge Function não retornou o resultado da análise.";
    await supabase.from("pdf_reports").update({ status: "falhou", error_message: message }).eq("id", uploadId);
    throw new PdfImportError(message, true, uploadId);
  }
  return { db: await snapshot(), ...data };
}

export async function savePdfReport(uploadId: string): Promise<{ db: WhiteVisionDb }> {
  const result = await getSupabase().from("pdf_reports").update({ status: "salvo" }).eq("id", uploadId);
  if (result.error) throw new Error(result.error.message);
  return asDb(await snapshot());
}

export async function generatePdfReportSummary(
  uploadId: string
): Promise<{ db: WhiteVisionDb; resumoIA: string }> {
  const { data, error } = await getSupabase().functions.invoke<{ resumoIA: string }>("analyze-pdf", {
    body: { action: "summarize", uploadId },
  });
  if (error || !data?.resumoIA) throw new Error(error?.message || "Resumo indisponível.");
  return { db: await snapshot(), resumoIA: data.resumoIA };
}

export async function savePdfReportToClient(
  uploadId: string
): Promise<{ db: WhiteVisionDb; clientName: string; clientPath: string }> {
  const supabase = getSupabase();
  const reportResult = await supabase.from("pdf_reports").select("campaign_id").eq("id", uploadId).single();
  const report = unwrap(reportResult) as Row;
  const update = await supabase.from("pdf_reports").update({ status: "perfil_salvo" }).eq("id", uploadId);
  if (update.error) throw new Error(update.error.message);
  const campaignResult = await supabase.from("campaigns").select("client_name,slug").eq("id", report.campaign_id).single();
  const campaign = unwrap(campaignResult) as Row;
  return {
    db: await snapshot(),
    clientName: String(campaign.client_name),
    clientPath: `/c/${campaign.slug}`,
  };
}

export async function deletePdfReport(uploadId: string): Promise<{ db: WhiteVisionDb }> {
  const supabase = getSupabase();
  const result = await supabase.from("pdf_reports").select("storage_path").eq("id", uploadId).single();
  const row = unwrap(result) as Row;
  const remove = await supabase.storage.from("report-pdfs").remove([String(row.storage_path)]);
  if (remove.error) throw new Error(remove.error.message);
  const deleted = await supabase.from("pdf_reports").delete().eq("id", uploadId);
  if (deleted.error) throw new Error(deleted.error.message);
  return asDb(await snapshot());
}

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export async function fetchPublicClientReport(slug: string): Promise<{ report: RelatorioData }> {
  const result = await getSupabase().rpc("get_public_client_report", { p_slug: slug });
  const payload = unwrap(result) as {
    campaign: Row;
    points: Row[];
    screens: Row[];
    dailyReports: Row[];
    videos: Row[];
  };
  if (!payload.campaign) throw new Error("Cliente não encontrado.");
  const campaign = campaignFromRow(payload.campaign);
  const points = payload.points.map(pointFromRow);
  const screens = payload.screens.map(screenFromRow);
  const daily = payload.dailyReports.map(dailyFromRow);
  const metrics = campaign.metricasDashboard || {};
  const dashboardPerformance = new Map(
    (metrics.desempenhoPorTela || []).map((item) => [
      `${normalizeName(item.localNome)}::${normalizeName(item.telaNome)}`,
      item.insercoes,
    ])
  );
  const dates = [
    ...new Set(
      metrics.historicoDiario?.map((item) => item.data) || daily.map((item) => item.data)
    ),
  ];
  const locais = points.map((point) => {
    const pointScreens = screens.filter((screen) => screen.pontoId === point.id);
    const mappedScreens = pointScreens.map((screen) => {
      const total =
        dashboardPerformance.get(`${normalizeName(point.nome)}::${normalizeName(screen.nome)}`) ??
        daily
          .filter((item) => item.telaId === screen.id)
          .reduce((sum, item) => sum + item.exibicoesEntregues, 0);
      const screenReports = daily.filter((item) => item.telaId === screen.id);
      const failed = [...screenReports].reverse().find((item) => item.falhaNominal);
      return {
        id: screen.id,
        nome: screen.nome,
        exibicoes: total,
        mediaDiaria: dates.length ? Math.round(total / dates.length) : 0,
        metaDiariaEsperada: screen.metaDiaria,
        status: screen.status,
        statusOscilacao: failed?.observacaoFalha,
      };
    });
    return {
      id: point.id,
      nome: point.nome,
      endereco: point.endereco,
      horarioFuncionamento: point.horarioFuncionamento,
      totalExibicoes: mappedScreens.reduce((sum, item) => sum + item.exibicoes, 0),
      frequenciaLocal: point.frequenciaLocal,
      telas: mappedScreens,
    };
  });
  const dailyByDate = new Map<string, RelatorioDiarioTela[]>();
  daily.forEach((item) => dailyByDate.set(item.data, [...(dailyByDate.get(item.data) || []), item]));
  const historicoDiario = metrics.historicoDiario?.length
    ? metrics.historicoDiario.map((item) => ({
        dia: `${item.data.slice(8, 10)}/${item.data.slice(5, 7)}`,
        insercoes: item.insercoes,
        status: item.status,
      }))
    : [...dailyByDate.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, items]) => ({
          dia: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
          insercoes: items.reduce((sum, item) => sum + item.exibicoesEntregues, 0),
          status: items.some((item) => item.falhaNominal) ? "alerta" as const : "normal" as const,
        }));
  const totalPeriodo =
    metrics.insercoesPeriodo ?? historicoDiario.reduce((sum, item) => sum + item.insercoes, 0);
  const metaDiaria = metrics.metaDiaria ?? (historicoDiario.length
    ? Math.round(totalPeriodo / historicoDiario.length)
    : 0);

  return {
    report: {
      token: "",
      clienteNome: campaign.clienteNome,
      campanhaNome: campaign.campanhaNome,
      periodo: campaign.periodo,
      mesAno: campaign.mesAno,
      diasEmExibicaoTotal: campaign.diasAcumulados,
      totalExibicoesHistorico: campaign.totalExibicoesAcumuladas,
      totalExibicoesPeriodo: totalPeriodo,
      insercoesPeriodo: totalPeriodo,
      mediaDiariaPeriodo: metaDiaria,
      metaDiaria,
      frequenciaGeral: campaign.frequenciaGeral || "Não informado",
      frequenciaLoop: campaign.frequenciaGeral,
      clientTheme: { ...DEFAULT_CLIENT_THEME, ...campaign.clientTheme },
      resumoRelatorio: campaign.resumoRelatorio,
      telasAtivas: metrics.telasAtivas ?? screens.filter((screen) => screen.status === "online").length,
      desempenhoPorTela: metrics.desempenhoPorTela || locais.flatMap((local) =>
        local.telas.map((screen) => ({
          localNome: local.nome,
          telaNome: screen.nome,
          insercoes: screen.exibicoes,
        }))
      ),
      locais,
      historicoDiario,
      conteudos: payload.videos.map((row) => {
        const video = videoFromRow(row);
        return {
          id: video.id,
          titulo: video.titulo,
          descricao: video.descricao,
          nomeArquivo: video.nomeArquivo,
          mimeType: video.mimeType,
          src: getPublicMediaUrl(video.arquivoId),
        };
      }),
    },
  };
}

export async function createClient(body: {
  clienteNome: string;
  campanhaNome: string;
}): Promise<{ db: WhiteVisionDb; clientPath: string }> {
  const base = slugify(body.clienteNome) || "cliente";
  const slug = `${base}-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const insert = await getSupabase().from("campaigns").insert({
    slug,
    client_name: body.clienteNome.trim(),
    campaign_name: body.campanhaNome.trim(),
    token: crypto.randomUUID(),
    period: "Ainda não há relatório importado",
  });
  if (insert.error) throw new Error(insert.error.message);
  return { db: await snapshot(), clientPath: `/c/${slug}` };
}

export async function removeClient(clientId: string): Promise<{ db: WhiteVisionDb }> {
  const supabase = getSupabase();
  const [videos, pdfs] = await Promise.all([
    supabase.from("videos").select("storage_path").eq("campaign_id", clientId),
    supabase.from("pdf_reports").select("storage_path").eq("campaign_id", clientId),
  ]);
  const videoRows = unwrap(videos) as Row[];
  const pdfRows = unwrap(pdfs) as Row[];
  const mediaPaths = videoRows.map((row) => String(row.storage_path));
  const pdfPaths = pdfRows.map((row) => String(row.storage_path));
  if (mediaPaths.length) {
    const result = await supabase.storage.from("client-media").remove(mediaPaths);
    if (result.error) throw new Error(result.error.message);
  }
  if (pdfPaths.length) {
    const result = await supabase.storage.from("report-pdfs").remove(pdfPaths);
    if (result.error) throw new Error(result.error.message);
  }
  const removed = await supabase.from("campaigns").delete().eq("id", clientId);
  if (removed.error) throw new Error(removed.error.message);
  return asDb(await snapshot());
}

export async function saveCampanha(
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
  const update: Row = {};
  if (body.status !== undefined) update.status = body.status;
  if (body.diasAcumulados !== undefined) update.days_accumulated = body.diasAcumulados;
  if (body.totalExibicoesAcumuladas !== undefined) update.total_impressions_accumulated = body.totalExibicoesAcumuladas;
  if (body.clienteNome !== undefined) update.client_name = body.clienteNome;
  if (body.campanhaNome !== undefined) update.campaign_name = body.campanhaNome;
  if (body.periodo !== undefined) update.period = body.periodo;
  if (body.clientTheme !== undefined) update.client_theme = body.clientTheme;
  const result = await getSupabase().from("campaigns").update(update).eq("id", campanhaId);
  if (result.error) throw new Error(result.error.message);
  return asDb(await snapshot());
}

export async function saveTela(
  telaId: string,
  body: Partial<TelaPonto>
): Promise<{ db: WhiteVisionDb }> {
  const update: Row = {};
  if (body.metaDiaria !== undefined) update.daily_target = body.metaDiaria;
  if (body.status !== undefined) update.status = body.status;
  const result = await getSupabase().from("screens").update(update).eq("id", telaId);
  if (result.error) throw new Error(result.error.message);
  return asDb(await snapshot());
}

export async function saveRelatorios(
  items: RelatorioDiarioTela[]
): Promise<{ db: WhiteVisionDb }> {
  const rows = items.map((item) => ({
    report_date: item.data,
    screen_id: item.telaId,
    impressions_delivered: item.exibicoesEntregues,
    daily_target: item.metaDiaria,
    nominal_failure: item.falhaNominal,
    report_status: item.statusRelatorio,
    failure_note: item.observacaoFalha,
  }));
  if (rows.length) {
    const result = await getSupabase().from("daily_screen_reports").upsert(rows, {
      onConflict: "report_date,screen_id",
    });
    if (result.error) throw new Error(result.error.message);
  }
  return asDb(await snapshot());
}

export async function uploadClientMedia(
  campaignId: string,
  file: File,
  title: string,
  description: string
): Promise<{ db: WhiteVisionDb }> {
  const supabase = getSupabase();
  const extension = file.name.split(".").pop()?.toLowerCase() || "bin";
  const storagePath = `${campaignId}/${crypto.randomUUID()}.${extension}`;
  const upload = await supabase.storage.from("client-media").upload(storagePath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (upload.error) throw new Error(upload.error.message);
  const insert = await supabase.from("videos").insert({
    campaign_id: campaignId,
    title,
    description,
    storage_path: storagePath,
    original_file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
  });
  if (insert.error) {
    await supabase.storage.from("client-media").remove([storagePath]);
    throw new Error(insert.error.message);
  }
  return asDb(await snapshot());
}

export function adminMediaPath(fileId: string): string {
  return getPublicMediaUrl(fileId);
}

export async function updateClientMedia(
  mediaId: string,
  body: { campanhaId: string; titulo: string; descricao: string }
): Promise<{ db: WhiteVisionDb }> {
  const result = await getSupabase().from("videos").update({
    campaign_id: body.campanhaId,
    title: body.titulo,
    description: body.descricao,
  }).eq("id", mediaId);
  if (result.error) throw new Error(result.error.message);
  return asDb(await snapshot());
}

export async function removeVideo(videoId: string): Promise<{ db: WhiteVisionDb }> {
  const supabase = getSupabase();
  const result = await supabase.from("videos").select("storage_path").eq("id", videoId).single();
  const row = unwrap(result) as Row;
  const removed = await supabase.storage.from("client-media").remove([String(row.storage_path)]);
  if (removed.error) throw new Error(removed.error.message);
  const deleted = await supabase.from("videos").delete().eq("id", videoId);
  if (deleted.error) throw new Error(deleted.error.message);
  return asDb(await snapshot());
}

export async function generateReportSummary(campaignId: string): Promise<{ resumo: string }> {
  const campaign = await getSupabase().from("campaigns").select("*").eq("id", campaignId).single();
  const row = unwrap(campaign) as Row;
  const metrics = (row.dashboard_metrics || {}) as CampanhaCliente["metricasDashboard"];
  const summary = `No período ${String(row.period || "auditado")}, a campanha ${String(row.campaign_name)} registrou ${Number(metrics?.insercoesPeriodo || 0).toLocaleString("pt-BR")} inserções em ${Number(metrics?.telasAtivas || 0)} telas. Frequência do loop: ${String(row.general_frequency || "não informada")}.`;
  return { resumo: summary };
}
