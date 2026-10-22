import type {
  CampanhaCliente,
  PdfReportUpload,
  PontoTela,
  RelatorioDiarioTela,
  TelaPonto,
  VideoPortal,
  WhiteVisionDb,
} from "../types/adminDb";
import type {
  ClientTheme,
  HistoricoDiarioSnapshotItem,
  LinkRelatorioItem,
  RelatorioData,
  SubTelaItem,
} from "../types/whiteVision";
import { DEFAULT_CLIENT_THEME } from "../types/whiteVision";
import { getPublicMediaUrl, getSupabase } from "./supabase";

type Row = Record<string, unknown>;
type DashboardMetrics = NonNullable<CampanhaCliente["metricasDashboard"]>;

function recordFrom(value: unknown): Row {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Row
    : {};
}

function numberFrom(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
  if (typeof value !== "string" || !value.trim()) return 0;
  const cleaned = value.trim().replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  const normalized = /^\d{1,3}(?:,\d{3})+$/.test(cleaned) && !cleaned.includes(".")
    ? cleaned.replace(/,/g, "")
    : cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(?:\.\d{3})+$/.test(cleaned)
    ? cleaned.replace(/\./g, "")
    : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function nullableNumberFrom(value: unknown): number | null {
  return value === null || value === undefined || value === "" ? null : numberFrom(value);
}

function historyStatusFrom(value: unknown): HistoricoDiarioSnapshotItem["status"] {
  return value === "normal" || value === "alerta" || value === "zerado"
    ? value
    : "desconhecido";
}

function themeFromValue(value: unknown): ClientTheme {
  const theme = recordFrom(value);
  return {
    ...DEFAULT_CLIENT_THEME,
    frameColor: typeof theme.frameColor === "string" ? theme.frameColor : DEFAULT_CLIENT_THEME.frameColor,
    topBannerText: typeof theme.topBannerText === "string" ? theme.topBannerText : DEFAULT_CLIENT_THEME.topBannerText,
    logoUrl: typeof theme.logoUrl === "string" ? theme.logoUrl : DEFAULT_CLIENT_THEME.logoUrl,
    primaryColor: typeof theme.primaryColor === "string" ? theme.primaryColor : DEFAULT_CLIENT_THEME.primaryColor,
    logoSize: numberFrom(theme.logoSize || DEFAULT_CLIENT_THEME.logoSize),
    logoBgColor: typeof theme.logoBgColor === "string" ? theme.logoBgColor : DEFAULT_CLIENT_THEME.logoBgColor,
  };
}

function metricsFromValue(value: unknown): DashboardMetrics {
  const metrics = recordFrom(value);
  const performance = Array.isArray(metrics.desempenhoPorTela)
    ? metrics.desempenhoPorTela.map((item) => {
        const screen = recordFrom(item);
        return {
          localNome: String(screen.localNome || ""),
          telaNome: String(screen.telaNome || ""),
          insercoes: numberFrom(screen.insercoes),
          detalhes: typeof screen.detalhes === "string" ? screen.detalhes : "",
        };
      })
    : [];
  const locais = Array.isArray(metrics.locais)
    ? metrics.locais.map((item) => {
        const local = recordFrom(item);
        return {
          nome: String(local.nome || ""),
          horarioFuncionamento: typeof local.horarioFuncionamento === "string"
            ? local.horarioFuncionamento
            : "",
          links: Array.isArray(local.links)
            ? local.links.flatMap((item) => {
                const link = recordFrom(item);
                if (typeof link.url !== "string" || typeof link.rotulo !== "string") return [];
                try {
                  const url = new URL(link.url);
                  return url.protocol === "http:" || url.protocol === "https:"
                    ? [{ rotulo: link.rotulo, url: url.href }]
                    : [];
                } catch {
                  return [];
                }
              })
            : [],
        };
      })
    : [];
  const historicoDiario = Array.isArray(metrics.historicoDiario)
    ? metrics.historicoDiario.map((item) => {
        const day = recordFrom(item);
        return {
          data: String(day.data || ""),
          insercoes: numberFrom(day.insercoes),
          status: historyStatusFrom(day.status),
        };
      }).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.data))
    : [];
  return {
    insercoesPeriodo: numberFrom(metrics.insercoesPeriodo),
    metaDiaria: numberFrom(metrics.metaDiaria),
    telasAtivas: numberFrom(metrics.telasAtivas),
    desempenhoPorTela: performance,
    locais,
    historicoDiario,
  };
}

function reportFromValue(value: unknown): RelatorioData | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const report = recordFrom(value);
  const locais = Array.isArray(report.locais)
    ? report.locais.map((item, localIndex) => {
        const local = recordFrom(item);
        const telas = Array.isArray(local.telas)
          ? local.telas.map((value, screenIndex) => {
              const screen = recordFrom(value);
              const status: SubTelaItem["status"] = screen.status === "online" || screen.status === "offline"
                ? screen.status
                : "desconhecido";
              return {
                id: String(screen.id || `${localIndex}-${screenIndex}`),
                nome: String(screen.nome || ""),
                exibicoes: numberFrom(screen.insercoes ?? screen.exibicoes),
                detalhes: typeof screen.detalhes === "string" ? screen.detalhes : "",
                metaDiariaEsperada: nullableNumberFrom(screen.metaDiariaEsperada),
                status,
              };
            })
          : [];
        const localLinks = Array.isArray(local.links)
          ? local.links.flatMap((value) => {
              const link = recordFrom(value);
              if (typeof link.url !== "string") return [];
              try {
                const url = new URL(link.url);
                if (url.protocol !== "http:" && url.protocol !== "https:") return [];
                return [{ rotulo: String(link.rotulo || url.href), url: url.href }];
              } catch {
                return [];
              }
            })
          : [];
        return {
          id: String(local.id || localIndex),
          nome: String(local.nome || ""),
          endereco: typeof local.endereco === "string" ? local.endereco : "",
          horarioFuncionamento: typeof local.horarioFuncionamento === "string"
            ? local.horarioFuncionamento
            : "",
          totalExibicoes: telas.reduce((sum, screen) => sum + screen.exibicoes, 0),
          links: localLinks,
          telas,
        };
      })
    : [];
  const historicoDiario = Array.isArray(report.historicoDiario)
    ? report.historicoDiario.map((value) => {
        const day = recordFrom(value);
        const date = String(day.dia || day.data || "");
        const screenDetails = Array.isArray(day.telas)
          ? day.telas.map((value) => {
              const screen = recordFrom(value);
              return {
                localNome: String(screen.localNome || ""),
                telaNome: String(screen.telaNome || ""),
                insercoes: numberFrom(screen.insercoes),
                pagina: numberFrom(screen.pagina),
                evidencia: String(screen.evidencia || ""),
                status: historyStatusFrom(screen.status),
                observacaoFalha: String(screen.observacaoFalha || ""),
              };
            })
          : [];
        return {
          dia: /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : date,
          insercoes: numberFrom(day.insercoes),
          status: historyStatusFrom(day.status),
          telas: screenDetails,
        };
      })
    : [];
  const metrics = metricsFromValue(report);
  const performance = metrics.desempenhoPorTela || [];
  return {
    token: String(report.token || ""),
    clienteNome: String(report.clienteNome || ""),
    campanhaNome: String(report.campanhaNome || ""),
    periodo: String(report.periodo || ""),
    diasEmExibicaoTotal: numberFrom(report.diasEmExibicaoTotal),
    totalExibicoesHistorico: numberFrom(report.totalExibicoesHistorico),
    totalExibicoesPeriodo: numberFrom(report.totalExibicoesPeriodo ?? report.insercoesPeriodo),
    telasAtivas: numberFrom(report.telasAtivas),
    desempenhoPorTela: performance,
    insercoesPeriodo: numberFrom(report.insercoesPeriodo ?? report.totalExibicoesPeriodo),
    metaDiaria: numberFrom(report.metaDiaria),
    resumoRelatorio: typeof report.resumoRelatorio === "string" ? report.resumoRelatorio : "",
    locais,
    historicoDiario,
  };
}

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
    diasAcumulados: numberFrom(row.days_accumulated),
    totalExibicoesAcumuladas: numberFrom(row.total_impressions_accumulated),
    status: row.status as CampanhaCliente["status"],
    periodo: String(row.period || ""),
    ...(typeof row.month_year === "string" ? { mesAno: row.month_year } : {}),
    frequenciaGeral: String(row.general_frequency || ""),
    ...(typeof row.report_summary === "string" ? { resumoRelatorio: row.report_summary } : {}),
    clientTheme: themeFromValue(row.client_theme),
    metricasDashboard: metricsFromValue(row.dashboard_metrics),
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
    metaDiaria: nullableNumberFrom(row.daily_target),
    status: row.status as TelaPonto["status"],
  };
}

function dailyFromRow(row: Row): RelatorioDiarioTela {
  return {
    id: String(row.id),
    data: String(row.report_date),
    telaId: String(row.screen_id),
    exibicoesEntregues: numberFrom(row.impressions_delivered),
    metaDiaria: nullableNumberFrom(row.daily_target),
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
    tamanhoBytes: numberFrom(row.size_bytes),
  };
}

function pdfFromRow(row: Row): PdfReportUpload {
  const report = reportFromValue(row.report);
  return {
    id: String(row.id),
    campanhaId: String(row.campaign_id),
    nomeArquivo: String(row.original_file_name),
    criadoEm: String(row.created_at),
    status: row.status as PdfReportUpload["status"],
    ...(report ? { relatorio: report } : {}),
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

export type GroqKeyStatus = "ambiente" | "portal" | "ausente" | "indisponivel";

async function invokeGroqAdmin<T>(body: Row): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke("groq-admin", { body });
  if (error) throw new Error(error.message);
  return data as T;
}

export function fetchGroqKeyStatus(): Promise<{ status: GroqKeyStatus }> {
  return invokeGroqAdmin({ action: "status" });
}

export function updateGroqApiKey(apiKey: string): Promise<{ status: GroqKeyStatus }> {
  return invokeGroqAdmin({ action: "set-key", apiKey });
}

export function testGroqConnection(): Promise<{ connected: boolean }> {
  return invokeGroqAdmin({ action: "test" });
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
    metaDiaria: number;
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
  const reportResult = await supabase
    .from("pdf_reports")
    .select("campaign_id,report,ai_summary")
    .eq("id", uploadId)
    .single();
  const report = unwrap(reportResult) as Row;
  const extracted = reportFromValue(report.report);
  if (!extracted) throw new Error("Este PDF ainda não possui dados analisados para salvar no perfil.");
  const campaignResult = await supabase
    .from("campaigns")
    .select("client_name,campaign_name,slug,period,days_accumulated,total_impressions_accumulated,report_summary")
    .eq("id", report.campaign_id)
    .single();
  const currentCampaign = unwrap(campaignResult) as Row;
  if (!extracted.clienteNome && !currentCampaign.client_name) {
    throw new Error("O PDF não contém um nome de cliente válido para atualizar o perfil.");
  }
  const original = recordFrom(report.report);
  const dailyMetrics = (Array.isArray(original.historicoDiario) ? original.historicoDiario : [])
    .flatMap((value) => {
      const day = recordFrom(value);
      const date = String(day.dia || day.data || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      return [{
        data: date,
        insercoes: numberFrom(day.insercoes),
        status: historyStatusFrom(day.status),
      }];
    })
    .sort((left, right) => left.data.localeCompare(right.data));
  const dashboardMetrics: DashboardMetrics = {
    insercoesPeriodo: extracted.totalExibicoesPeriodo,
    metaDiaria: extracted.metaDiaria || 0,
    telasAtivas: extracted.telasAtivas || 0,
    desempenhoPorTela: extracted.desempenhoPorTela || [],
    locais: extracted.locais.map((local) => ({
      nome: local.nome,
      horarioFuncionamento: local.horarioFuncionamento,
      links: local.links || [],
    })),
    historicoDiario: dailyMetrics,
  };
  const campaignUpdate = await supabase.from("campaigns").update({
    client_name: extracted.clienteNome || currentCampaign.client_name,
    campaign_name: extracted.campanhaNome || currentCampaign.campaign_name,
    period: extracted.periodo || currentCampaign.period,
    days_accumulated: original.diasEmExibicaoTotal === undefined
      ? numberFrom(currentCampaign.days_accumulated)
      : extracted.diasEmExibicaoTotal,
    total_impressions_accumulated: original.totalExibicoesHistorico === undefined
      ? numberFrom(currentCampaign.total_impressions_accumulated)
      : extracted.totalExibicoesHistorico,
    report_summary: typeof report.ai_summary === "string" && report.ai_summary.trim()
      ? report.ai_summary
      : extracted.resumoRelatorio || currentCampaign.report_summary,
    dashboard_metrics: dashboardMetrics,
  }).eq("id", report.campaign_id);
  if (campaignUpdate.error) throw new Error(campaignUpdate.error.message);
  const update = await supabase.from("pdf_reports").update({ status: "perfil_salvo" }).eq("id", uploadId);
  if (update.error) throw new Error(update.error.message);
  return {
    db: await snapshot(),
    clientName: String(extracted.clienteNome || currentCampaign.client_name),
    clientPath: `/c/${currentCampaign.slug}`,
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
  const daily = payload.dailyReports
    .map(dailyFromRow)
    .sort((left, right) => left.data.localeCompare(right.data));
  const metrics = campaign.metricasDashboard || {};
  const dashboardPerformance = new Map(
    (metrics.desempenhoPorTela || []).map((item) => [
      `${normalizeName(item.localNome)}::${normalizeName(item.telaNome)}`,
      item,
    ])
  );
  const localSnapshots = new Map(
    (metrics.locais || []).map((item) => [normalizeName(item.nome), item])
  );
  const reportPoints = localSnapshots.size
    ? points.filter((point) => localSnapshots.has(normalizeName(point.nome)))
    : points;
  const locais = reportPoints.map((point) => {
    const pointScreens = screens.filter((screen) =>
      screen.pontoId === point.id &&
      (!dashboardPerformance.size ||
        dashboardPerformance.has(`${normalizeName(point.nome)}::${normalizeName(screen.nome)}`))
    );
    const mappedScreens = pointScreens.map((screen) => {
      const screenPerformance = dashboardPerformance.get(
        `${normalizeName(point.nome)}::${normalizeName(screen.nome)}`
      );
      const total =
        screenPerformance?.insercoes ??
        daily
          .filter((item) => item.telaId === screen.id)
          .reduce((sum, item) => sum + item.exibicoesEntregues, 0);
      const screenReports = daily.filter((item) => item.telaId === screen.id);
      const failed = [...screenReports].reverse().find((item) => item.falhaNominal);
      return {
        id: screen.id,
        nome: screen.nome,
        exibicoes: total,
        detalhes: screenPerformance?.detalhes,
        metaDiariaEsperada: screen.metaDiaria,
        status: screen.status,
        statusOscilacao: failed?.observacaoFalha,
      };
    });
    const localSnapshot = localSnapshots.get(normalizeName(point.nome));
    return {
      id: point.id,
      nome: point.nome,
      endereco: point.endereco,
      horarioFuncionamento:
        localSnapshot?.horarioFuncionamento || point.horarioFuncionamento || "Horário não informado",
      totalExibicoes: mappedScreens.reduce((sum, item) => sum + item.exibicoes, 0),
      links: (localSnapshot?.links || []).filter((link): link is LinkRelatorioItem => {
        try {
          const parsed = new URL(link.url);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      }),
      telas: mappedScreens,
    };
  });
  const dailyByDate = new Map<string, RelatorioDiarioTela[]>();
  daily.forEach((item) => dailyByDate.set(item.data, [...(dailyByDate.get(item.data) || []), item]));
  const savedHistory = [...(metrics.historicoDiario || [])]
    .sort((left, right) => left.data.localeCompare(right.data));
  const historicoDiario = savedHistory.length
    ? savedHistory.map((item) => ({
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
  const metaDiaria = metrics.metaDiaria ?? 0;

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
      metaDiaria,
      clientTheme: { ...DEFAULT_CLIENT_THEME, ...campaign.clientTheme },
      resumoRelatorio: campaign.resumoRelatorio,
      telasAtivas: metrics.telasAtivas ?? screens.filter((screen) => screen.status === "online").length,
      desempenhoPorTela: metrics.desempenhoPorTela?.length ? metrics.desempenhoPorTela : locais.flatMap((local) =>
        local.telas.map((screen) => ({
          localNome: local.nome,
          telaNome: screen.nome,
          insercoes: screen.exibicoes,
          detalhes: screen.detalhes,
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
    await syncDashboardDailyHistory(items);
  }
  return asDb(await snapshot());
}

async function syncDashboardDailyHistory(items: RelatorioDiarioTela[]): Promise<void> {
  const screenIds = [...new Set(items.map((item) => item.telaId))];
  if (!screenIds.length) return;
  const supabase = getSupabase();
  const selectedScreens = unwrap(
    await supabase.from("screens").select("id,point_id").in("id", screenIds)
  ) as Row[];
  const pointIds = [...new Set(selectedScreens.map((row) => String(row.point_id)))];
  if (!pointIds.length) return;
  const selectedPoints = unwrap(
    await supabase.from("points").select("id,campaign_id").in("id", pointIds)
  ) as Row[];
  const campaignByScreen = new Map<string, string>();
  const screenIdsByCampaign = new Map<string, Set<string>>();
  const pointCampaign = new Map(
    selectedPoints.map((point) => [String(point.id), String(point.campaign_id)])
  );
  selectedScreens.forEach((screen) => {
    const campaignId = pointCampaign.get(String(screen.point_id));
    if (!campaignId) return;
    campaignByScreen.set(String(screen.id), campaignId);
  });
  const campaignIds = [...new Set(pointCampaign.values())];
  if (!campaignIds.length) return;
  const allPoints = unwrap(
    await supabase.from("points").select("id,campaign_id").in("campaign_id", campaignIds)
  ) as Row[];
  const allPointIds = allPoints.map((point) => String(point.id));
  const allScreens = allPointIds.length
    ? unwrap(await supabase.from("screens").select("id,point_id").in("point_id", allPointIds)) as Row[]
    : [];
  const allPointCampaign = new Map(
    allPoints.map((point) => [String(point.id), String(point.campaign_id)])
  );
  allScreens.forEach((screen) => {
    const campaignId = allPointCampaign.get(String(screen.point_id));
    if (!campaignId) return;
    const campaignScreens = screenIdsByCampaign.get(campaignId) || new Set<string>();
    campaignScreens.add(String(screen.id));
    screenIdsByCampaign.set(campaignId, campaignScreens);
  });
  const campaigns = unwrap(
    await supabase.from("campaigns").select("id,dashboard_metrics").in("id", campaignIds)
  ) as Row[];

  for (const campaign of campaigns) {
    const campaignId = String(campaign.id);
    const campaignItems = items.filter((item) => campaignByScreen.get(item.telaId) === campaignId);
    const itemsByDate = new Map<string, RelatorioDiarioTela[]>();
    campaignItems.forEach((item) =>
      itemsByDate.set(item.data, [...(itemsByDate.get(item.data) || []), item])
    );
    const metrics = metricsFromValue(campaign.dashboard_metrics);
    const existingHistory = metrics.historicoDiario || [];
    const historyByDate = new Map(existingHistory.map((day) => [day.data, day]));
    const datesToSync = existingHistory.length
      ? existingHistory.map((day) => day.data)
      : [...itemsByDate.keys()].sort();
    const expectedScreenCount = screenIdsByCampaign.get(campaignId)?.size || 0;
    for (const date of datesToSync) {
      const dayItems = itemsByDate.get(date);
      if (!dayItems || new Set(dayItems.map((item) => item.telaId)).size !== expectedScreenCount) continue;
      const insertions = dayItems.reduce((sum, item) => sum + numberFrom(item.exibicoesEntregues), 0);
      const hasFailure = dayItems.some((item) => item.falhaNominal);
      historyByDate.set(date, {
        data: date,
        insercoes: insertions,
        status: insertions === 0 ? "zerado" : hasFailure ? "alerta" : "normal",
      });
    }
    const historicoDiario = [...historyByDate.values()].sort((left, right) =>
      left.data.localeCompare(right.data)
    );
    const update = await supabase.from("campaigns").update({
      dashboard_metrics: {
        ...metrics,
        historicoDiario,
        insercoesPeriodo: historicoDiario.reduce((sum, day) => sum + numberFrom(day.insercoes), 0),
      },
    }).eq("id", campaignId);
    if (update.error) throw new Error(update.error.message);
  }
}

export async function deleteRelatorioDiario(reportId: string): Promise<{ db: WhiteVisionDb }> {
  const result = await getSupabase().from("daily_screen_reports").delete().eq("id", reportId);
  if (result.error) throw new Error(result.error.message);
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
  const summary = `No período ${String(row.period || "auditado")}, a campanha ${String(row.campaign_name)} registrou ${Number(metrics?.insercoesPeriodo || 0).toLocaleString("pt-BR")} inserções em ${Number(metrics?.telasAtivas || 0)} telas.`;
  return { resumo: summary };
}
