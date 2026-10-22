import React, { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  fetchEstado,
  fetchClientAdminData,
  fetchGroqKeyStatus,
  generatePdfReportSummary,
  importPdfReport,
  savePdfReport,
  savePdfReportToClient,
  deletePdfReport,
  adminMediaPath,
  createClient,
  removeClient,
  removeVideo,
  deleteRelatorioDiario,
  saveCampanha,
  saveRelatorios,
  saveTela,
  testGroqConnection,
  uploadClientMedia,
  uploadWhiteVisionLogo,
  updateClientMedia,
  updateGroqApiKey,
  uploadClientThemeLogo,
  PdfImportError,
} from "../lib/supabaseAdminApi";
import type {
  CampanhaCliente,
  RelatorioDiarioTela,
  StatusCampanha,
  TelaPonto,
  VideoPortal,
  WhiteVisionDb,
} from "../types/adminDb";
import type { RelatorioData } from "../types/whiteVision";
import { DEFAULT_CLIENT_THEME } from "../types/whiteVision";
import { getPublicMediaUrl } from "../lib/supabase";

function formatDia(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export function AdminPage() {
  const [db, setDb] = useState<WhiteVisionDb | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [campanhaDraft, setCampanhaDraft] = useState<CampanhaCliente | null>(null);
  const [telasDraft, setTelasDraft] = useState<TelaPonto[]>([]);
  const [relatoriosDraft, setRelatoriosDraft] = useState<RelatorioDiarioTela[]>([]);
  const [videos, setVideos] = useState<VideoPortal[]>([]);
  const [clientNameDraft, setClientNameDraft] = useState("");
  const [clientCampaignDraft, setClientCampaignDraft] = useState("");
  const [pdfClientId, setPdfClientId] = useState("");
  const [pdfClientNameDraft, setPdfClientNameDraft] = useState("");
  const [pdfCampaignNameDraft, setPdfCampaignNameDraft] = useState("");
  const [showPdfClientForm, setShowPdfClientForm] = useState(false);
  const [mediaCampaignId, setMediaCampaignId] = useState("");
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  const [mediaTitle, setMediaTitle] = useState("");
  const [mediaDescription, setMediaDescription] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [reportPdf, setReportPdf] = useState<File | null>(null);
  const [importingPdf, setImportingPdf] = useState(false);
  const [deletingDailyReport, setDeletingDailyReport] = useState(false);
  const [loadingClientData, setLoadingClientData] = useState(false);
  const [newReportDate, setNewReportDate] = useState(() => {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  });
  const clientSelectionRequest = useRef(0);
  const [profileSavedLink, setProfileSavedLink] = useState<{
    clientName: string;
    clientPath: string;
  } | null>(null);
  const [groqApiKey, setGroqApiKey] = useState("");
  const [groqKeyStatus, setGroqKeyStatus] = useState<
    "ambiente" | "portal" | "ausente" | "indisponivel"
  >("ausente");
  const [groqStatusError, setGroqStatusError] = useState<string | null>(null);
  const [savingGroqKey, setSavingGroqKey] = useState(false);
  const [testingGroq, setTestingGroq] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [savingLogo, setSavingLogo] = useState(false);
  const [uploadingThemeLogo, setUploadingThemeLogo] = useState(false);
  const [logoRevision, setLogoRevision] = useState(0);
  const [importedReport, setImportedReport] = useState<{
    uploadId: string;
    clientPath: string;
    clientName: string;
    report: RelatorioData;
    totals: {
      totalExibicoesPeriodo: number;
      metaDiaria: number;
      diasEmExibicaoTotal: number;
      totalExibicoesHistorico: number;
    };
  } | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [payload, keyConfig] = await Promise.all([
        fetchEstado(),
        fetchGroqKeyStatus().then(
          (result) => ({ result, error: null }),
          (statusError: unknown) => ({
            result: null,
            error: statusError instanceof Error ? statusError.message : String(statusError),
          })
        ),
      ]);
      setDb(payload.db);
      setCampanhaDraft(payload.db.campanhas[0] || null);
      setTelasDraft(payload.db.telas);
      setRelatoriosDraft(payload.db.relatoriosDiarios);
      setVideos(payload.db.videos);
      setMediaCampaignId(payload.db.campanhas[0]?.id || "");
      setPdfClientId(payload.db.campanhas[0]?.id || "");
      if (keyConfig.result) {
        setGroqKeyStatus(keyConfig.result.status);
        setGroqStatusError(null);
      } else {
        setGroqKeyStatus("indisponivel");
        setGroqStatusError(
          `Não foi possível consultar a configuração Groq: ${keyConfig.error}. Implante a Edge Function "groq-admin" para habilitar essas operações.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const pontoIdsDaCampanha = useMemo(
    () =>
      new Set(
        db?.pontos
          .filter((ponto) => ponto.campanhaId === campanhaDraft?.id)
          .map((ponto) => ponto.id) || []
      ),
    [db, campanhaDraft?.id]
  );
  const telasDaCampanha = useMemo(
    () => telasDraft.filter((tela) => pontoIdsDaCampanha.has(tela.pontoId)),
    [telasDraft, pontoIdsDaCampanha]
  );
  const telaIdsDaCampanha = useMemo(
    () => new Set(telasDaCampanha.map((tela) => tela.id)),
    [telasDaCampanha]
  );
  const relatoriosDaCampanha = useMemo(
    () => relatoriosDraft.filter((item) => telaIdsDaCampanha.has(item.telaId)),
    [relatoriosDraft, telaIdsDaCampanha]
  );
  const datas = useMemo(
    () => [
      ...new Set([
        ...relatoriosDaCampanha.map((item) => item.data),
        ...(campanhaDraft?.metricasDashboard?.historicoDiario || []).map((item) => item.data),
      ]),
    ].sort(),
    [relatoriosDaCampanha, campanhaDraft?.metricasDashboard?.historicoDiario]
  );

  const applyDb = (next: WhiteVisionDb) => {
    setDb(next);
    setCampanhaDraft(
      next.campanhas.find((campaign) => campaign.id === campanhaDraft?.id) ||
        next.campanhas[0] ||
        null
    );
    setTelasDraft(next.telas);
    setRelatoriosDraft(next.relatoriosDiarios);
    setVideos(next.videos);
    if (!next.campanhas.some((campaign) => campaign.id === mediaCampaignId)) {
      setMediaCampaignId(next.campanhas[0]?.id || "");
    }
    if (!next.campanhas.some((campaign) => campaign.id === pdfClientId)) {
      setPdfClientId(next.campanhas[0]?.id || "");
    }
    if (editingMediaId && !next.videos.some((item) => item.id === editingMediaId)) {
      setEditingMediaId(null);
      setMediaTitle("");
      setMediaDescription("");
      setMediaFile(null);
    }
  };

  const selectClientForAdmin = async (campaignId: string) => {
    setPdfClientId(campaignId);
    if (!campaignId) {
      setCampanhaDraft(null);
      setTelasDraft([]);
      setRelatoriosDraft([]);
      return;
    }
    const requestId = ++clientSelectionRequest.current;
    setLoadingClientData(true);
    setError(null);
    try {
      const clientData = await fetchClientAdminData(campaignId);
      if (requestId !== clientSelectionRequest.current) return;
      setCampanhaDraft(clientData.campanha);
      setTelasDraft((previous) => [
        ...previous.filter((screen) =>
          !db?.pontos.some((point) => point.campanhaId === campaignId && point.id === screen.pontoId)
        ),
        ...clientData.telas,
      ]);
      const previousScreenIds = new Set(
        db?.telas
          .filter((screen) => db.pontos.some(
            (point) => point.campanhaId === campaignId && point.id === screen.pontoId
          ))
          .map((screen) => screen.id) || []
      );
      setRelatoriosDraft((previous) => [
        ...previous.filter((report) => !previousScreenIds.has(report.telaId)),
        ...clientData.relatoriosDiarios,
      ]);
      setDb((previous) => {
        if (!previous) return previous;
        const currentPointIds = new Set(
          previous.pontos
            .filter((point) => point.campanhaId === campaignId)
            .map((point) => point.id)
        );
        const currentScreenIds = new Set(
          previous.telas.filter((screen) => currentPointIds.has(screen.pontoId)).map((screen) => screen.id)
        );
        return {
          ...previous,
          campanhas: previous.campanhas.map((campaign) =>
            campaign.id === campaignId ? clientData.campanha : campaign
          ),
          pontos: [
            ...previous.pontos.filter((point) => point.campanhaId !== campaignId),
            ...clientData.pontos,
          ],
          telas: [
            ...previous.telas.filter((screen) => !currentPointIds.has(screen.pontoId)),
            ...clientData.telas,
          ],
          relatoriosDiarios: [
            ...previous.relatoriosDiarios.filter((report) => !currentScreenIds.has(report.telaId)),
            ...clientData.relatoriosDiarios,
          ],
          relatoriosPdf: [
            ...previous.relatoriosPdf.filter((report) => report.campanhaId !== campaignId),
            ...clientData.relatoriosPdf,
          ],
        };
      });
    } catch (err) {
      if (requestId === clientSelectionRequest.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (requestId === clientSelectionRequest.current) setLoadingClientData(false);
    }
  };

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 2500);
  };

  const handleCopyClientLink = async (slug: string) => {
    const link = `${window.location.origin}/c/${encodeURIComponent(slug)}`;
    try {
      await navigator.clipboard.writeText(link);
      flash("Link do cliente copiado.");
    } catch (err) {
      setError(
        `Não foi possível copiar o link automaticamente: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  };

  const handleSaveCampanha = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!campanhaDraft) return;
    setSaving(true);
    setError(null);
    try {
      const payload = await saveCampanha(campanhaDraft.id, {
        status: campanhaDraft.status,
        diasAcumulados: Number(campanhaDraft.diasAcumulados),
        totalExibicoesAcumuladas: Number(campanhaDraft.totalExibicoesAcumuladas),
        clienteNome: campanhaDraft.clienteNome,
        campanhaNome: campanhaDraft.campanhaNome,
        periodo: campanhaDraft.periodo,
        clientTheme: { ...DEFAULT_CLIENT_THEME, ...campanhaDraft.clientTheme },
      });
      applyDb(payload.db);
      flash("Status da campanha salvo.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMetas = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let nextDb: WhiteVisionDb | null = null;
      for (const tela of telasDaCampanha) {
        const payload = await saveTela(tela.id, {
          metaDiaria: tela.metaDiaria,
          status: tela.status,
        });
        nextDb = payload.db;
      }
      if (nextDb) applyDb(nextDb);
      flash("Metas diárias das telas salvas.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRelatorios = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!campanhaDraft) {
      setError("Selecione um cliente antes de salvar os relatórios diários.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = await saveRelatorios(
        campanhaDraft.id,
        relatoriosDaCampanha.map((item) => ({
          ...item,
          exibicoesEntregues: Number(item.exibicoesEntregues),
          falhaNominal: Boolean(item.falhaNominal),
        }))
      );
      applyDb(payload.db);
      flash("Relatórios diários salvos.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateRelatorio = (
    telaId: string,
    data: string,
    patch: Partial<RelatorioDiarioTela>
  ) => {
    setRelatoriosDraft((prev) =>
      prev.map((item) =>
        item.telaId === telaId && item.data === data ? { ...item, ...patch } : item
      )
    );
  };

  const handleAddReportDay = () => {
    if (!campanhaDraft || !newReportDate || telasDaCampanha.length === 0) {
      setError("Selecione um cliente com telas e informe a data do novo relatório.");
      return;
    }
    const existing = new Set(
      relatoriosDaCampanha
        .filter((item) => item.data === newReportDate)
        .map((item) => item.telaId)
    );
    const newRows = telasDaCampanha
      .filter((screen) => !existing.has(screen.id))
      .map((screen) => ({
        id: crypto.randomUUID(),
        data: newReportDate,
        telaId: screen.id,
        exibicoesEntregues: 0,
        metaDiaria: screen.metaDiaria,
        falhaNominal: false,
        statusRelatorio: "desconhecido" as const,
        observacaoFalha: "",
      }));
    if (!newRows.length) {
      setError("Já existem registros para todas as telas nesta data.");
      return;
    }
    setError(null);
    setRelatoriosDraft((previous) => [...previous, ...newRows]);
  };

  const handleDeleteDailyReport = async (report: RelatorioDiarioTela) => {
    if (!window.confirm(`Excluir o registro diário de ${formatDia(report.data)} desta tela?`)) return;
    if (!db?.relatoriosDiarios.some((item) => item.id === report.id)) {
      setRelatoriosDraft((previous) => previous.filter((item) => item.id !== report.id));
      return;
    }
    setDeletingDailyReport(true);
    setError(null);
    try {
      if (!campanhaDraft) return;
      const payload = await deleteRelatorioDiario(campanhaDraft.id, report.id);
      setDb(payload.db);
      setRelatoriosDraft((previous) => previous.filter((item) => item.id !== report.id));
      flash("Registro diário excluído.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingDailyReport(false);
    }
  };

  const handleCreateClient = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = await createClient({
        clienteNome: clientNameDraft,
        campanhaNome: clientCampaignDraft,
      });
      applyDb(payload.db);
      setClientNameDraft("");
      setClientCampaignDraft("");
      const createdClient = payload.db.campanhas[payload.db.campanhas.length - 1];
      if (createdClient) {
        setMediaCampaignId(createdClient.id);
        await selectClientForAdmin(createdClient.id);
        flash("Cliente cadastrado, selecionado e histórico carregado.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePdfClient = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = await createClient({
        clienteNome: pdfClientNameDraft,
        campanhaNome: pdfCampaignNameDraft,
      });
      const createdClient = payload.db.campanhas[payload.db.campanhas.length - 1];
      applyDb(payload.db);
      setMediaCampaignId(createdClient.id);
      await selectClientForAdmin(createdClient.id);
      setImportedReport(null);
      setPdfClientNameDraft("");
      setPdfCampaignNameDraft("");
      setShowPdfClientForm(false);
      flash(`Cliente ${createdClient.clienteNome} cadastrado e selecionado para o relatório.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUploadMedia = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mediaCampaignId || (!mediaFile && !editingMediaId)) {
      setError("Selecione o cliente e um arquivo MP4, PNG ou JPG.");
      return;
    }
    if (mediaFile && mediaFile.size > 100 * 1024 * 1024) {
      setError("O arquivo de mídia deve ter até 100 MB.");
      return;
    }
    setUploadingMedia(true);
    setError(null);
    try {
      let payload;
      if (editingMediaId) {
        payload = await updateClientMedia(editingMediaId, {
            campanhaId: mediaCampaignId,
            titulo: mediaTitle,
            descricao: mediaDescription,
        });
      } else {
        if (!mediaFile) throw new Error("Selecione o arquivo que deseja enviar.");
        payload = await uploadClientMedia(
            mediaCampaignId,
            mediaFile,
            mediaTitle.trim() || mediaFile.name,
            mediaDescription
          );
      }
      applyDb(payload.db);
      setEditingMediaId(null);
      setMediaTitle("");
      setMediaDescription("");
      setMediaFile(null);
      if (mediaInputRef.current) mediaInputRef.current.value = "";
      flash(
        editingMediaId
          ? "Dados do arquivo atualizados."
          : "Arquivo enviado e associado ao cliente selecionado."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleDeleteVideo = async (videoId: string) => {
    if (!window.confirm("Deseja remover este arquivo de mídia?")) return;
    setSaving(true);
    setError(null);
    try {
      const payload = await removeVideo(videoId);
      applyDb(payload.db);
      flash("Arquivo removido.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClient = async (campaign: CampanhaCliente) => {
    if (
      !window.confirm(
        `Remover ${campaign.clienteNome}, o link exclusivo e todos os arquivos/relatórios associados?`
      )
    ) return;
    setSaving(true);
    setError(null);
    try {
      const payload = await removeClient(campaign.id);
      applyDb(payload.db);
      flash("Cliente e dados associados removidos.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateSummary = () => {
    if (!campanhaDraft) return;
    setError(null);
    const metrics = campanhaDraft.metricasDashboard;
    const totalInsercoes =
      metrics?.insercoesPeriodo ??
      relatoriosDaCampanha.reduce((total, item) => total + item.exibicoesEntregues, 0);
    const metaDiaria = metrics?.metaDiaria ?? null;
    const telasAtivas =
      metrics?.telasAtivas ??
      telasDaCampanha.filter((tela) => tela.status === "online").length;
    const metaDiariaTexto =
      metaDiaria !== null && metaDiaria > 0
        ? `meta diária de ${metaDiaria.toLocaleString("pt-BR")} inserções`
        : "meta diária não informada no relatório";
    setSummary(
      `No período auditado, a campanha registrou um total de ${totalInsercoes.toLocaleString("pt-BR")} exibições distribuídas em ${telasAtivas} telas ativas. ${metaDiariaTexto}.`
    );
  };

  const handleImportPdf = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reportPdf || !pdfClientId) {
      setError("Selecione o cliente destinatário e um arquivo PDF de relatório.");
      return;
    }
    if (!/\.pdf$/i.test(reportPdf.name) || reportPdf.size > 10 * 1024 * 1024) {
      setError("Selecione um arquivo PDF válido de até 10 MB.");
      return;
    }

    setImportingPdf(true);
    setError(null);
    setImportedReport(null);
    setProfileSavedLink(null);
    try {
      const result = await importPdfReport(reportPdf, pdfClientId);
      applyDb(result.db);
      setCampanhaDraft(
        result.db.campanhas.find((campaign) => campaign.id === result.campaignId) || null
      );
      setPdfClientId(result.campaignId);
      setImportedReport({
        uploadId: result.uploadId,
        clientPath: result.clientPath,
        clientName: result.clientName,
        report: result.report,
        totals: result.totals,
      });
      setProfileSavedLink({
        clientName: result.clientName,
        clientPath: result.clientPath,
      });
      setReportPdf(null);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
      flash(`Relatório processado e dados salvos com sucesso para o cliente ${result.clientName}!`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof PdfImportError && err.pdfSaved) {
        try {
          const latest = await fetchEstado();
          applyDb(latest.db);
          setError(`${message} O arquivo permanece salvo e aparece na lista de PDFs enviados.`);
        } catch (refreshError) {
          const refreshMessage =
            refreshError instanceof Error ? refreshError.message : String(refreshError);
          setError(`${message} O PDF foi salvo, mas não foi possível atualizar a lista: ${refreshMessage}`);
        }
      } else {
        setError(message);
      }
    } finally {
      setImportingPdf(false);
    }
  };

  const handleSavePdf = async (uploadId: string) => {
    setSaving(true);
    setError(null);
    try {
      const result = await savePdfReport(uploadId);
      applyDb(result.db);
      flash("Relatório salvo no histórico do cliente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePdfSummary = async (uploadId: string) => {
    setGeneratingSummary(true);
    setError(null);
    try {
      const result = await generatePdfReportSummary(uploadId);
      applyDb(result.db);
      flash("Resumo da IA gerado e salvo no relatório.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleSavePdfToClient = async (uploadId: string) => {
    setSaving(true);
    setError(null);
    try {
      const result = await savePdfReportToClient(uploadId);
      applyDb(result.db);
      setProfileSavedLink({ clientName: result.clientName, clientPath: result.clientPath });
      flash(`Relatório processado e dados salvos com sucesso para o cliente ${result.clientName}!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePdf = async (uploadId: string, fileName: string) => {
    if (!window.confirm(`Excluir o PDF "${fileName}" e removê-lo do histórico?`)) return;
    setSaving(true);
    setError(null);
    try {
      const result = await deletePdfReport(uploadId);
      applyDb(result.db);
      if (importedReport?.uploadId === uploadId) setImportedReport(null);
      flash("PDF excluído do histórico.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveGroqKey = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingGroqKey(true);
    setError(null);
    try {
      const result = await updateGroqApiKey(groqApiKey);
      setGroqKeyStatus(result.status);
      setGroqApiKey("");
      flash("Chave Groq atualizada no armazenamento privado do servidor.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingGroqKey(false);
    }
  };

  const handleTestGroq = async () => {
    setTestingGroq(true);
    setError(null);
    try {
      await testGroqConnection();
      flash("Conexão com a API Groq verificada com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingGroq(false);
    }
  };

  const handleSaveLogo = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!logoFile) {
      setError("Selecione um arquivo de imagem para a logo.");
      return;
    }
    if (logoFile.size > 5 * 1024 * 1024) {
      setError("A logo deve ter no máximo 5 MB.");
      return;
    }
    setSavingLogo(true);
    setError(null);
    try {
      await uploadWhiteVisionLogo(logoFile);
      setLogoFile(null);
      setLogoRevision(Date.now());
      flash("Logo White Vision atualizada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingLogo(false);
    }
  };

  const handleUploadThemeLogo = async (file: File) => {
    if (!campanhaDraft) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("A logo deve ter no máximo 5 MB.");
      return;
    }
    setUploadingThemeLogo(true);
    setError(null);
    try {
      const { logoUrl } = await uploadClientThemeLogo(file);
      setCampanhaDraft({
        ...campanhaDraft,
        clientTheme: {
          ...DEFAULT_CLIENT_THEME,
          ...campanhaDraft.clientTheme,
          logoUrl,
        },
      });
      flash("Logo do totem carregada. Salve o perfil do cliente para publicar a alteração.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingThemeLogo(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">
        Carregando painel administrativo...
      </div>
    );
  }

  if (!db) {
    return (
      <div className="min-h-screen bg-slate-950 text-rose-300 flex items-center justify-center p-6">
        {error || "Não foi possível carregar o banco local."}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-12">
      <header className="border-b border-slate-800 bg-slate-900/80">
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-4">
            <img
              src={`${getPublicMediaUrl("branding/white-vision-logo.png")}?v=${logoRevision}`}
              alt="White Vision"
              translate="no"
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = "/white-vision-logo.png";
              }}
              className="h-12 w-auto object-contain"
            />
            <div>
              <p translate="no" className="text-xs uppercase tracking-wider text-emerald-400 font-bold">
                White Vision
              </p>
            <h1 className="text-2xl font-extrabold text-white">Painel Administrativo</h1>
            </div>
          </div>
          <a
            href="#client-links"
            className="self-start text-sm text-sky-400 hover:text-sky-300 underline underline-offset-4"
          >
            Ver links dos clientes
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {message && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-emerald-300 text-sm">
            {message}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-rose-300 text-sm">
            {error}
          </div>
        )}

        <section id="client-links" className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-white">Gestão de clientes e links exclusivos</h2>
            <p className="text-sm text-slate-400">
              Cada cliente recebe um endereço aleatório que permite acessar somente os seus dados e arquivos.
            </p>
          </div>
          <form onSubmit={handleCreateClient} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm space-y-1">
              <span className="text-slate-300">Nome do cliente</span>
              <input
                required
                maxLength={120}
                value={clientNameDraft}
                onChange={(event) => setClientNameDraft(event.target.value)}
                className="w-full resize-y rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-300">Campanha inicial</span>
              <input
                required
                maxLength={120}
                value={clientCampaignDraft}
                onChange={(event) => setClientCampaignDraft(event.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="sm:col-span-2 justify-self-start rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2.5 disabled:opacity-60"
            >
              Cadastrar cliente e gerar link
            </button>
          </form>
          <ul className="divide-y divide-slate-800">
            {db.campanhas.length === 0 && (
              <li className="py-3 text-sm text-slate-400">
                Nenhum cliente cadastrado.
              </li>
            )}
            {db.campanhas.map((campaign) => (
              <li key={campaign.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-200">
                    {campaign.clienteNome} — {campaign.campanhaNome}
                  </p>
                  <a
                    href={`/c/${encodeURIComponent(campaign.slug)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-sm text-sky-400 underline underline-offset-4"
                  >
                    {window.location.origin}/c/{campaign.slug}
                  </a>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyClientLink(campaign.slug)}
                    className="self-start rounded-lg border border-sky-500/40 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/10"
                  >
                    Copiar Link do Cliente
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleDeleteClient(campaign)}
                    className="self-start rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-300 disabled:opacity-60"
                  >
                    Remover cliente
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-white">Logo White Vision</h2>
            <p className="text-sm text-slate-400">
              Envie PNG, JPEG/JPG, WEBP ou SVG de até 5 MB. A imagem é processada como PNG para compatibilidade.
            </p>
          </div>
          <div className="inline-flex rounded-lg bg-slate-950 p-3">
            <img
              src={`${getPublicMediaUrl("branding/white-vision-logo.png")}?v=${logoRevision}`}
              alt="Pré-visualização da logo White Vision"
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = "/white-vision-logo.png";
              }}
              className="h-14 max-w-64 object-contain"
            />
          </div>
          <form onSubmit={handleSaveLogo} className="flex flex-col sm:flex-row sm:items-end gap-3">
            <label className="text-sm space-y-1 flex-1">
              <span className="text-slate-300">Novo arquivo de imagem</span>
              <input
                required
                type="file"
                accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml, image/*"
                onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
                className="block w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1 file:text-white"
              />
            </label>
            <button
              type="submit"
              disabled={savingLogo || !logoFile}
              className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2.5 disabled:opacity-60"
            >
              {savingLogo ? "Atualizando logo..." : "Atualizar logo"}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-violet-500/30 bg-slate-900/80 p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-white">Configuração da chave Groq</h2>
            <p className="text-sm text-slate-400">
              Status:{" "}
              <span
                className={
                  groqKeyStatus === "ausente" || groqKeyStatus === "indisponivel"
                    ? "text-amber-300"
                    : "text-emerald-300"
                }
              >
                {groqKeyStatus === "ambiente"
                  ? "configurada como secret no Supabase"
                  : groqKeyStatus === "portal"
                    ? "configurada pelo portal administrativo"
                    : groqKeyStatus === "indisponivel"
                      ? "Edge Function groq-admin indisponível"
                      : "não configurada"}
              </span>
            </p>
            {groqStatusError && (
              <p role="status" className="mt-2 text-sm text-amber-200">
                {groqStatusError}
              </p>
            )}
          </div>
          <form onSubmit={handleSaveGroqKey} className="flex flex-col sm:flex-row sm:items-end gap-3">
            <label className="text-sm space-y-1 flex-1">
              <span className="text-slate-300">Colar ou substituir chave da API Groq</span>
              <input
                required
                type="password"
                autoComplete="new-password"
                value={groqApiKey}
                onChange={(event) => setGroqApiKey(event.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                placeholder="A chave é enviada ao backend administrativo"
              />
            </label>
            <button
              type="submit"
              disabled={savingGroqKey || groqApiKey.trim().length < 20}
              className="rounded-xl bg-violet-400 hover:bg-violet-300 text-slate-950 font-bold px-4 py-2.5 disabled:opacity-60"
            >
              {savingGroqKey ? "Configurando..." : "Configurar chave"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => void handleTestGroq()}
            disabled={
              testingGroq ||
              groqKeyStatus === "ausente" ||
              groqKeyStatus === "indisponivel"
            }
            className="rounded-xl border border-violet-400/50 px-4 py-2.5 text-sm font-semibold text-violet-200 disabled:opacity-60"
          >
            {testingGroq ? "Testando conexão..." : "Testar conexão com Groq"}
          </button>
          <p className="text-xs text-slate-500">
            A chave nunca é devolvida ao navegador. Ela é guardada em private_settings, tabela acessível
            somente pelo backend com service role. Também é possível configurar GROQ_API_KEY como secret
            da Edge Function no Supabase.
          </p>
        </section>

        <section className="rounded-2xl border border-emerald-500/30 bg-slate-900/80 p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-white">Importar relatório PDF com Groq</h2>
            <p className="text-sm text-slate-400">
              A análise salva os dados extraídos, as metas por tela e o histórico diário no perfil e no histórico do PDF. Confira os campos e edite-os antes de salvar alterações.
            </p>
          </div>
          <label className="block text-sm space-y-1">
            <span className="text-slate-300">Cliente destinatário (obrigatório)</span>
            <select
              required
              value={pdfClientId}
              onChange={(event) => {
                void selectClientForAdmin(event.target.value);
                setImportedReport(null);
              }}
              disabled={loadingClientData}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
            >
              <option value="" disabled>Selecione o cliente que receberá os dados</option>
              {db.campanhas.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.clienteNome} — {campaign.campanhaNome}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setShowPdfClientForm((open) => !open)}
            className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm font-semibold text-sky-300 hover:bg-sky-500/10"
          >
            {showPdfClientForm ? "Cancelar cadastro rápido" : "Cadastrar Novo Cliente"}
          </button>
          {showPdfClientForm && (
            <form
              onSubmit={handleCreatePdfClient}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-slate-700 bg-slate-950/60 p-4"
            >
              <label className="text-sm space-y-1">
                <span className="text-slate-300">Nome do cliente</span>
                <input
                  required
                  maxLength={120}
                  value={pdfClientNameDraft}
                  onChange={(event) => setPdfClientNameDraft(event.target.value)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                />
              </label>
              <label className="text-sm space-y-1">
                <span className="text-slate-300">Nome da campanha</span>
                <input
                  required
                  maxLength={120}
                  value={pdfCampaignNameDraft}
                  onChange={(event) => setPdfCampaignNameDraft(event.target.value)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                />
              </label>
              <button
                type="submit"
                disabled={saving}
                className="sm:col-span-2 justify-self-start rounded-lg bg-sky-500 px-4 py-2 font-bold text-slate-950 disabled:opacity-60"
              >
                {saving ? "Cadastrando..." : "Cadastrar e selecionar cliente"}
              </button>
            </form>
          )}
          <form onSubmit={handleImportPdf} className="flex flex-col sm:flex-row sm:items-end gap-3">
            <label className="text-sm space-y-1 flex-1">
              <span className="text-slate-300">Arquivo PDF (máximo 10 MB)</span>
              <input
                ref={pdfInputRef}
                required
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => setReportPdf(event.target.files?.[0] || null)}
                className="block w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1 file:text-white"
              />
            </label>
            <button
              type="submit"
              disabled={importingPdf || !reportPdf || !pdfClientId}
              className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2.5 disabled:opacity-60"
            >
              {importingPdf ? "Analisando PDF..." : "Analisar PDF"}
            </button>
          </form>
          {importedReport && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-sm">
              <p role="status" className="font-semibold text-emerald-200">
                PDF processado e salvo no histórico e no perfil de {importedReport.clientName}. Confira os dados extraídos.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-slate-300 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-slate-400">Inserções no período</dt>
                  <dd className="font-semibold">{importedReport.totals.totalExibicoesPeriodo.toLocaleString("pt-BR")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Meta diária (relatório)</dt>
                  <dd className="font-semibold">{importedReport.totals.metaDiaria > 0
                    ? importedReport.totals.metaDiaria.toLocaleString("pt-BR")
                    : "Não informada"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Dias acumulados</dt>
                  <dd className="font-semibold">{importedReport.totals.diasEmExibicaoTotal.toLocaleString("pt-BR")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Total histórico</dt>
                  <dd className="font-semibold">{importedReport.totals.totalExibicoesHistorico.toLocaleString("pt-BR")}</dd>
                </div>
              </dl>
              <details className="mt-3">
                <summary className="cursor-pointer text-emerald-200">Conferir todos os dados extraídos</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-slate-300">
                  {JSON.stringify(importedReport.report, null, 2)}
                </pre>
              </details>
            </div>
          )}
          {profileSavedLink && (
            <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-sm">
              <p className="font-semibold text-emerald-200">
                Relatório processado e dados salvos com sucesso para o cliente {profileSavedLink.clientName}!
              </p>
              <a
                href={profileSavedLink.clientPath}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block break-all text-emerald-300 underline underline-offset-4"
              >
                {window.location.origin}{profileSavedLink.clientPath}
              </a>
            </div>
          )}
          {db.relatoriosPdf.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-200">
                Histórico de relatórios de {db.campanhas.find((campaign) => campaign.id === pdfClientId)?.clienteNome || "clientes"}
              </h3>
              <p className="text-xs text-slate-400">
                Selecione um cliente acima para navegar pelos PDFs e períodos já cadastrados.
              </p>
              <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
                {[...db.relatoriosPdf]
                  .filter((upload) => !pdfClientId || upload.campanhaId === pdfClientId)
                  .sort((left, right) => right.criadoEm.localeCompare(left.criadoEm))
                  .map((upload) => (
                    <li key={upload.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="break-all text-slate-200">{upload.nomeArquivo}</p>
                        <p className="text-xs text-slate-500">
                          {db.campanhas.find((campaign) => campaign.id === upload.campanhaId)?.clienteNome || "Cliente removido"}
                          {" · "}
                          {new Date(upload.criadoEm).toLocaleString("pt-BR")}
                          {upload.relatorio?.periodo ? ` · ${upload.relatorio.periodo}` : ""}
                        </p>
                        {upload.erro && <p className="mt-1 text-xs text-rose-300">{upload.erro}</p>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            upload.status === "perfil_salvo" || upload.status === "salvo"
                              ? "text-xs font-semibold text-emerald-300"
                              : upload.status === "falhou"
                                ? "text-xs font-semibold text-rose-300"
                                : "text-xs font-semibold text-amber-300"
                          }
                        >
                          {{
                            analisando: "Analisando",
                            analisado: "Analisado; aguardando salvar",
                            salvo: "Salvo no histórico",
                            perfil_salvo: "Dados salvos no perfil",
                            falhou: "Salvo; análise falhou",
                          }[upload.status]}
                        </span>
                        {upload.status === "analisado" && (
                          <button
                            type="button"
                            onClick={() => void handleSavePdf(upload.id)}
                            disabled={saving}
                            className="rounded-md border border-emerald-400/50 px-2 py-1 text-xs text-emerald-200 disabled:opacity-60"
                          >
                            Salvar Relatório no Histórico
                          </button>
                        )}
                        {upload.status === "salvo" && !upload.resumoIA && (
                          <button
                            type="button"
                            onClick={() => void handleGeneratePdfSummary(upload.id)}
                            disabled={generatingSummary || saving}
                            className="rounded-md border border-violet-400/50 px-2 py-1 text-xs text-violet-200 disabled:opacity-60"
                          >
                            {generatingSummary ? "Gerando..." : "Gerar Resumo pela IA"}
                          </button>
                        )}
                        {upload.resumoIA && (
                          <button
                            type="button"
                            onClick={() => void handleSavePdfToClient(upload.id)}
                            disabled={saving || upload.status === "perfil_salvo"}
                            className="rounded-md border border-emerald-400/50 px-2 py-1 text-xs text-emerald-200 disabled:opacity-60"
                          >
                            {upload.status === "perfil_salvo" ? "Perfil atualizado" : "Salvar Informações no Perfil"}
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Excluir ${upload.nomeArquivo}`}
                          title="Excluir PDF e arquivo físico"
                          onClick={() => void handleDeletePdf(upload.id, upload.nomeArquivo)}
                          disabled={saving}
                          className="rounded-md border border-rose-400/40 px-2 py-1 text-xs text-rose-300 disabled:opacity-60"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                      {upload.relatorio && (
                        <details className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:basis-full">
                          <summary className="cursor-pointer text-xs font-semibold text-sky-300">
                            Visualizar dados extraídos deste período
                          </summary>
                          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-slate-300">
                            {JSON.stringify(upload.relatorio, null, 2)}
                          </pre>
                        </details>
                      )}
                      {upload.resumoIA && (
                        <p className="mt-2 w-full whitespace-pre-wrap rounded-lg bg-slate-950/70 p-3 text-xs text-slate-300 sm:basis-full">
                          <strong className="text-violet-200">Resumo da IA: </strong>{upload.resumoIA}
                        </p>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">Assistente de relatórios Groq</h2>
              <p className="text-sm text-slate-400">Gera um resumo usando os dados atuais do relatório.</p>
            </div>
            <button
              type="button"
              disabled={!campanhaDraft}
              onClick={handleGenerateSummary}
              className="rounded-xl bg-violet-400 hover:bg-violet-300 text-slate-950 font-bold px-4 py-2.5 disabled:opacity-60"
            >
              Gerar resumo
            </button>
          </div>
          {summary && (
            <div aria-live="polite" className="whitespace-pre-wrap rounded-xl border border-violet-500/30 bg-slate-950 p-4 text-sm text-slate-200">
              {summary}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-white">Upload de mídia por cliente</h2>
            <p className="text-sm text-slate-400">
              Envie arquivos reais MP4, PNG ou JPG. Cada arquivo fica associado ao cliente selecionado.
            </p>
          </div>
          <form onSubmit={handleUploadMedia} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm space-y-1 md:col-span-2">
              <span className="text-slate-400">Cliente destinatário</span>
              <select
                required
                value={mediaCampaignId}
                onChange={(event) => setMediaCampaignId(event.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
              >
                <option value="" disabled>Selecione um cliente</option>
                {db.campanhas.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.clienteNome} — {campaign.campanhaNome}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">Título do conteúdo</span>
              <input
                required={Boolean(editingMediaId)}
                maxLength={120}
                value={mediaTitle}
                onChange={(event) => setMediaTitle(event.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                placeholder="Por padrão, usa o nome do arquivo"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">
                {editingMediaId ? "Arquivo atual (para trocar, remova e envie um novo)" : "Arquivo de mídia (máximo 100 MB)"}
              </span>
              <input
                required={!editingMediaId}
                disabled={Boolean(editingMediaId)}
                ref={mediaInputRef}
                type="file"
                accept="video/mp4,image/png,image/jpeg,.mp4,.png,.jpg,.jpeg"
                onChange={(event) => setMediaFile(event.target.files?.[0] || null)}
                className="block w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1 file:text-white"
              />
            </label>
            <label className="text-sm space-y-1 md:col-span-2">
              <span className="text-slate-400">Descrição</span>
              <textarea
                maxLength={2000}
                rows={3}
                value={mediaDescription}
                onChange={(event) => setMediaDescription(event.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
              />
            </label>
            <div className="md:col-span-2 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={uploadingMedia || !mediaCampaignId || (!editingMediaId && !mediaFile)}
                className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2.5 disabled:opacity-60"
              >
                {uploadingMedia
                  ? editingMediaId ? "Salvando..." : "Enviando arquivo..."
                  : editingMediaId ? "Salvar alterações" : "Enviar arquivo para o cliente"}
              </button>
              {editingMediaId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingMediaId(null);
                    setMediaTitle("");
                    setMediaDescription("");
                    setMediaFile(null);
                    if (mediaInputRef.current) mediaInputRef.current.value = "";
                  }}
                  className="rounded-xl border border-slate-700 px-4 py-2.5 text-slate-200"
                >
                  Cancelar edição
                </button>
              )}
            </div>
          </form>
          {videos.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhum arquivo enviado.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {videos.map((video) => (
                <li key={video.id} className="py-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-white">{video.titulo}</h3>
                    <p className="text-xs font-medium text-emerald-300">
                      Destinado a: {db.campanhas.find((campaign) => campaign.id === video.campanhaId)?.clienteNome || "Cliente não associado"}
                    </p>
                    <p className="text-sm text-slate-400 whitespace-pre-wrap">{video.descricao || "Sem descrição."}</p>
                    <p className="text-xs text-slate-500">
                      {video.nomeArquivo} · {(video.tamanhoBytes / 1024 / 1024).toFixed(2)} MB
                    </p>
                    {video.mimeType === "video/mp4" ? (
                      <video
                        src={adminMediaPath(video.arquivoId)}
                        controls
                        preload="metadata"
                        className="mt-2 max-h-64 max-w-full rounded-lg bg-black"
                      />
                    ) : (
                      <img
                        src={adminMediaPath(video.arquivoId)}
                        alt={video.titulo}
                        className="mt-2 max-h-64 max-w-full rounded-lg object-contain"
                      />
                    )}
                    <a
                      href={`${adminMediaPath(video.arquivoId)}?download=1`}
                      download={video.nomeArquivo}
                      className="mt-2 inline-flex text-sm text-sky-400 hover:underline"
                    >
                      Baixar arquivo original
                    </a>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMediaId(video.id);
                        setMediaCampaignId(video.campanhaId);
                        setMediaTitle(video.titulo);
                        setMediaDescription(video.descricao);
                        setMediaFile(null);
                        if (mediaInputRef.current) mediaInputRef.current.value = "";
                      }}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200"
                    >
                      Editar dados
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleDeleteVideo(video.id)}
                      className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-300 disabled:opacity-60"
                    >
                      Excluir arquivo
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {campanhaDraft && (
        <>
        <form
          onSubmit={handleSaveCampanha}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-4"
        >
          <h2 className="text-lg font-bold text-white">Configurações do perfil do cliente</h2>
          <label className="block max-w-xl space-y-1 text-sm">
            <span className="text-slate-400">Cliente / campanha</span>
            <select
              value={campanhaDraft.id}
              onChange={(event) => void selectClientForAdmin(event.target.value)}
              disabled={loadingClientData}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
            >
              {db.campanhas.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.clienteNome} — {campaign.campanhaNome}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-sm space-y-1">
              <span className="text-slate-400">Nome do cliente</span>
              <input
                required
                maxLength={120}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                value={campanhaDraft.clienteNome}
                onChange={(event) =>
                  setCampanhaDraft({ ...campanhaDraft, clienteNome: event.target.value })
                }
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">Campanha</span>
              <input
                required
                maxLength={120}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                value={campanhaDraft.campanhaNome}
                onChange={(event) =>
                  setCampanhaDraft({ ...campanhaDraft, campanhaNome: event.target.value })
                }
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">Status</span>
              <select
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                value={campanhaDraft.status}
                onChange={(event) =>
                  setCampanhaDraft({
                    ...campanhaDraft,
                    status: event.target.value as StatusCampanha,
                  })
                }
              >
                <option value="ativa">Ativa</option>
                <option value="pausada">Pausada</option>
                <option value="encerrada">Encerrada</option>
              </select>
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">Dias acumulados</span>
              <input
                type="number"
                min={0}
                step={1}
                required
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                value={campanhaDraft.diasAcumulados}
                onChange={(event) =>
                  setCampanhaDraft({
                    ...campanhaDraft,
                    diasAcumulados: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">Total de exibições acumuladas</span>
              <input
                type="number"
                min={0}
                step={1}
                required
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                value={campanhaDraft.totalExibicoesAcumuladas}
                onChange={(event) =>
                  setCampanhaDraft({
                    ...campanhaDraft,
                    totalExibicoesAcumuladas: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">Período do relatório</span>
              <input
                required
                maxLength={200}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                value={campanhaDraft.periodo}
                onChange={(event) =>
                  setCampanhaDraft({ ...campanhaDraft, periodo: event.target.value })
                }
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">Cor da moldura da tela</span>
              <input
                type="color"
                value={campanhaDraft.clientTheme?.frameColor || DEFAULT_CLIENT_THEME.frameColor}
                onChange={(event) =>
                  setCampanhaDraft({
                    ...campanhaDraft,
                    clientTheme: {
                      ...DEFAULT_CLIENT_THEME,
                      ...campanhaDraft.clientTheme,
                      frameColor: event.target.value,
                    },
                  })
                }
                className="h-10 w-full rounded-lg bg-slate-950 border border-slate-700 p-1"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">Cor primária dos botões</span>
              <input
                type="color"
                value={campanhaDraft.clientTheme?.primaryColor || DEFAULT_CLIENT_THEME.primaryColor}
                onChange={(event) =>
                  setCampanhaDraft({
                    ...campanhaDraft,
                    clientTheme: {
                      ...DEFAULT_CLIENT_THEME,
                      ...campanhaDraft.clientTheme,
                      primaryColor: event.target.value,
                    },
                  })
                }
                className="h-10 w-full rounded-lg bg-slate-950 border border-slate-700 p-1"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">Cor do fundo da logo no totem</span>
              <input
                type="color"
                value={campanhaDraft.clientTheme?.logoBgColor || DEFAULT_CLIENT_THEME.logoBgColor}
                onChange={(event) =>
                  setCampanhaDraft({
                    ...campanhaDraft,
                    clientTheme: {
                      ...DEFAULT_CLIENT_THEME,
                      ...campanhaDraft.clientTheme,
                      logoBgColor: event.target.value,
                    },
                  })
                }
                className="h-10 w-full rounded-lg bg-slate-950 border border-slate-700 p-1"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">
                Tamanho da logo no totem: {campanhaDraft.clientTheme?.logoSize || DEFAULT_CLIENT_THEME.logoSize}px
              </span>
              <input
                type="range"
                min={20}
                max={150}
                step={1}
                value={campanhaDraft.clientTheme?.logoSize || DEFAULT_CLIENT_THEME.logoSize}
                onChange={(event) =>
                  setCampanhaDraft({
                    ...campanhaDraft,
                    clientTheme: {
                      ...DEFAULT_CLIENT_THEME,
                      ...campanhaDraft.clientTheme,
                      logoSize: Number(event.target.value),
                    },
                  })
                }
                className="w-full accent-emerald-400"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">Texto do adesivo superior</span>
              <textarea
                rows={3}
                maxLength={500}
                value={campanhaDraft.clientTheme?.topBannerText ?? DEFAULT_CLIENT_THEME.topBannerText}
                onChange={(event) =>
                  setCampanhaDraft({
                    ...campanhaDraft,
                    clientTheme: {
                      ...DEFAULT_CLIENT_THEME,
                      ...campanhaDraft.clientTheme,
                      topBannerText: event.target.value,
                    },
                  })
                }
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">URL da logo do rodapé</span>
              <input
                maxLength={500}
                type="text"
                value={campanhaDraft.clientTheme?.logoUrl || DEFAULT_CLIENT_THEME.logoUrl}
                onChange={(event) =>
                  setCampanhaDraft({
                    ...campanhaDraft,
                    clientTheme: {
                      ...DEFAULT_CLIENT_THEME,
                      ...campanhaDraft.clientTheme,
                      logoUrl: event.target.value,
                    },
                  })
                }
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
              />
              <span className="block text-xs text-slate-500">Aceita URL HTTPS ou caminho local como /logo-cliente.png.</span>
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-400">Enviar logo para o totem e cabeçalho</span>
              <input
                type="file"
                accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml, image/*"
                disabled={uploadingThemeLogo}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleUploadThemeLogo(file);
                  event.currentTarget.value = "";
                }}
                className="block w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1 file:text-white"
              />
              <span className="block text-xs text-slate-500">
                {uploadingThemeLogo ? "Carregando logo..." : "JPG, JPEG, PNG, WEBP e SVG; até 5 MB."}
              </span>
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2.5 disabled:opacity-60"
          >
            Salvar campanha
          </button>
        </form>

        <form
          onSubmit={handleSaveMetas}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-4"
        >
          <h2 className="text-lg font-bold text-white">Metas diárias por tela</h2>
          <p className="text-xs text-slate-400">
            Pontos e telas vinculados no banco local (ex.: Facho Restaurante → Tela 1 e Tela 2).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {telasDaCampanha.map((tela) => {
              const index = telasDraft.findIndex((item) => item.id === tela.id);
              const ponto = db.pontos.find((item) => item.id === tela.pontoId);
              return (
                <div key={tela.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                  <p className="font-semibold text-white">
                    {ponto?.nome || "Ponto"} • {tela.nome}
                  </p>
                  <label className="text-sm space-y-1 block">
                    <span className="text-slate-400">Meta diária</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2"
                      value={tela.metaDiaria ?? ""}
                      onChange={(event) => {
                        const next = [...telasDraft];
                        next[index] = {
                          ...tela,
                          metaDiaria: event.target.value === "" ? null : Number(event.target.value),
                        };
                        setTelasDraft(next);
                      }}
                    />
                  </label>
                  <label className="text-sm space-y-1 block">
                    <span className="text-slate-400">Status da tela</span>
                    <select
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2"
                      value={tela.status}
                      onChange={(event) => {
                        const next = [...telasDraft];
                        next[index] = {
                          ...tela,
                          status: event.target.value as TelaPonto["status"],
                        };
                        setTelasDraft(next);
                      }}
                    >
                      <option value="online">Online</option>
                      <option value="offline">Offline</option>
                      <option value="desconhecido">Não informado</option>
                    </select>
                  </label>
                </div>
              );
            })}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold px-4 py-2.5 disabled:opacity-60"
          >
            Salvar metas
          </button>
        </form>

        <form
          onSubmit={handleSaveRelatorios}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-4"
        >
          <h2 className="text-lg font-bold text-white">Relatórios diários de 30 dias</h2>
          <p className="text-xs text-slate-400">
            Exibições por tela, meta diária, falha/queda e observações. As datas agregadas sem detalhe por tela ficam identificadas, sem valores inventados.
          </p>
          {loadingClientData && (
            <p role="status" className="text-sm text-sky-300">
              Carregando metas, relatórios e PDFs deste cliente...
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="space-y-1 text-sm">
              <span className="block text-slate-400">Adicionar dia ao histórico</span>
              <input
                type="date"
                value={newReportDate}
                onChange={(event) => setNewReportDate(event.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-200"
              />
            </label>
            <button
              type="button"
              disabled={loadingClientData || telasDaCampanha.length === 0}
              onClick={handleAddReportDay}
              className="rounded-lg border border-sky-500/40 px-4 py-2 text-sm font-semibold text-sky-200 disabled:opacity-60"
            >
              Adicionar dia para todas as telas
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-800">
                  <th className="py-2 pr-3">Data</th>
                  {telasDaCampanha.map((tela) => (
                    <th key={tela.id} className="py-2 pr-3" colSpan={5}>
                      {tela.nome}
                    </th>
                  ))}
                </tr>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-3" />
                  {telasDaCampanha.map((tela) => (
                    <React.Fragment key={`${tela.id}-sub`}>
                      <th className="py-2 pr-3 font-medium">Meta diária</th>
                      <th className="py-2 pr-3 font-medium">Exibições</th>
                      <th className="py-2 pr-3 font-medium">Falha</th>
                      <th className="py-2 pr-3 font-medium">Observação</th>
                      <th className="py-2 pr-3 font-medium">Ação</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {datas.length === 0 && (
                  <tr>
                    <td colSpan={1 + telasDaCampanha.length * 5} className="py-4 text-center text-sm text-slate-400">
                      Ainda não há histórico diário associado a esta campanha.
                    </td>
                  </tr>
                )}
                {datas.map((data) => (
                  <tr key={data} className="border-b border-slate-800/80 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap font-mono text-slate-300">
                      {formatDia(data)}
                    </td>
                    {telasDaCampanha.map((tela) => {
                      const relatorio = relatoriosDraft.find(
                        (item) => item.telaId === tela.id && item.data === data
                      );
                      if (!relatorio) {
                        return (
                          <td key={`${tela.id}-${data}-missing`} colSpan={5} className="py-2 pr-3 text-xs text-slate-500">
                            Sem dados extraídos para esta tela nesta data.
                          </td>
                        );
                      }
                      return (
                        <React.Fragment key={`${tela.id}-${data}`}>
                          <td className="py-2 pr-3">
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className="w-24 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5"
                              value={relatorio.metaDiaria ?? ""}
                              onChange={(event) =>
                                updateRelatorio(tela.id, data, {
                                  metaDiaria: event.target.value === "" ? null : Number(event.target.value),
                                })
                              }
                              aria-label={`Meta diária de ${tela.nome} em ${formatDia(data)}`}
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <input
                              type="number"
                              min={0}
                              step={1}
                              required
                              className="w-24 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5"
                              value={relatorio.exibicoesEntregues}
                              onChange={(event) =>
                                updateRelatorio(tela.id, data, {
                                  exibicoesEntregues: Number(event.target.value),
                                })
                              }
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <input
                              type="checkbox"
                              checked={relatorio.falhaNominal}
                              onChange={(event) =>
                                updateRelatorio(tela.id, data, {
                                  falhaNominal: event.target.checked,
                                })
                              }
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <input
                              className="w-52 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5"
                              value={relatorio.observacaoFalha || ""}
                              onChange={(event) =>
                                updateRelatorio(tela.id, data, {
                                  observacaoFalha: event.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <button
                              type="button"
                              disabled={deletingDailyReport || saving}
                              onClick={() => void handleDeleteDailyReport(relatorio)}
                              className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-300 disabled:opacity-60"
                              aria-label={`Excluir registro de ${tela.nome} em ${formatDia(data)}`}
                            >
                              Excluir
                            </button>
                          </td>
                        </React.Fragment>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="submit"
            disabled={saving || deletingDailyReport || loadingClientData || !campanhaDraft}
            className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2.5 disabled:opacity-60"
          >
            Salvar relatórios diários
          </button>
        </form>
        </>
        )}
      </main>
    </div>
  );
}

export default AdminPage;
