import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Trash2,
  Plus,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Save,
  Sparkles,
  ExternalLink,
} from "lucide-react";
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
  Ponto,
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
  if (!isoDate || !isoDate.includes("-")) return isoDate || "";
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export function AdminPage() {
  // Estado global do banco e carregamento
  const [db, setDb] = useState<WhiteVisionDb | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingClientData, setLoadingClientData] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dados dedicados do cliente selecionado (sem filtros frágeis)
  const [campanhaDraft, setCampanhaDraft] = useState<CampanhaCliente | null>(null);
  const [pontosDraft, setPontosDraft] = useState<Ponto[]>([]);
  const [telasDraft, setTelasDraft] = useState<TelaPonto[]>([]);
  const [relatoriosDraft, setRelatoriosDraft] = useState<RelatorioDiarioTela[]>([]);
  const [videos, setVideos] = useState<VideoPortal[]>([]);

  // Formulários de cadastro de novos clientes
  const [clientNameDraft, setClientNameDraft] = useState("");
  const [clientCampaignDraft, setClientCampaignDraft] = useState("");
  const [pdfClientId, setPdfClientId] = useState("");
  const [pdfClientNameDraft, setPdfClientNameDraft] = useState("");
  const [pdfCampaignNameDraft, setPdfCampaignNameDraft] = useState("");
  const [showPdfClientForm, setShowPdfClientForm] = useState(false);

  // Mídia e arquivos
  const [mediaCampaignId, setMediaCampaignId] = useState("");
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  const [mediaTitle, setMediaTitle] = useState("");
  const [mediaDescription, setMediaDescription] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);

  // Resumo IA e importação de PDF
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [reportPdf, setReportPdf] = useState<File | null>(null);
  const [importingPdf, setImportingPdf] = useState(false);
  const [deletingDailyReport, setDeletingDailyReport] = useState(false);
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

  // Configuração Groq
  const [groqApiKey, setGroqApiKey] = useState("");
  const [groqKeyStatus, setGroqKeyStatus] = useState<
    "ambiente" | "portal" | "ausente" | "indisponivel"
  >("ausente");
  const [groqStatusError, setGroqStatusError] = useState<string | null>(null);
  const [savingGroqKey, setSavingGroqKey] = useState(false);
  const [testingGroq, setTestingGroq] = useState(false);

  // Branding / Logos
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

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 3500);
  };

  const applyDb = (next: WhiteVisionDb) => {
    setDb(next);
    setVideos(next.videos);
  };

  /**
   * Puxa o histórico completo do cliente diretamente do Supabase:
   * Metas por tela, status, pontos, relatórios diários de 30 dias e relatórios PDF.
   */
  const selectClientForAdmin = async (campaignId: string) => {
    if (!campaignId) {
      setCampanhaDraft(null);
      setPontosDraft([]);
      setTelasDraft([]);
      setRelatoriosDraft([]);
      setPdfClientId("");
      setMediaCampaignId("");
      return;
    }

    setPdfClientId(campaignId);
    setMediaCampaignId(campaignId);
    const requestId = ++clientSelectionRequest.current;
    setLoadingClientData(true);
    setError(null);

    try {
      const clientData = await fetchClientAdminData(campaignId);
      if (requestId !== clientSelectionRequest.current) return;

      setCampanhaDraft(clientData.campanha);
      setPontosDraft(clientData.pontos || []);
      setTelasDraft(clientData.telas || []);
      setRelatoriosDraft(clientData.relatoriosDiarios || []);

      setDb((previous) => {
        if (!previous) return previous;
        const otherCampaigns = previous.campanhas.map((c) =>
          c.id === campaignId ? clientData.campanha : c
        );
        const otherPoints = previous.pontos.filter((p) => p.campanhaId !== campaignId);
        const clientPointIds = new Set(clientData.pontos.map((p) => p.id));
        const otherScreens = previous.telas.filter((s) => !clientPointIds.has(s.pontoId));
        const clientScreenIds = new Set(clientData.telas.map((s) => s.id));
        const otherDailyReports = previous.relatoriosDiarios.filter(
          (r) => !clientScreenIds.has(r.telaId)
        );
        const otherPdfs = previous.relatoriosPdf.filter((r) => r.campanhaId !== campaignId);

        return {
          ...previous,
          campanhas: otherCampaigns,
          pontos: [...otherPoints, ...clientData.pontos],
          telas: [...otherScreens, ...clientData.telas],
          relatoriosDiarios: [...otherDailyReports, ...clientData.relatoriosDiarios],
          relatoriosPdf: [...otherPdfs, ...clientData.relatoriosPdf],
        };
      });

      flash(`Dados e histórico de "${clientData.campanha.clienteNome}" carregados do Supabase.`);
    } catch (err) {
      if (requestId === clientSelectionRequest.current) {
        setError(
          `Erro ao carregar dados do cliente: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    } finally {
      if (requestId === clientSelectionRequest.current) {
        setLoadingClientData(false);
      }
    }
  };

  // Carga inicial
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
      setVideos(payload.db.videos || []);

      const initialCampaign = payload.db.campanhas[0] || null;
      if (initialCampaign) {
        await selectClientForAdmin(initialCampaign.id);
      }

      if (keyConfig.result) {
        setGroqKeyStatus(keyConfig.result.status);
        setGroqStatusError(null);
      } else {
        setGroqKeyStatus("indisponivel");
        setGroqStatusError(
          `Não foi possível consultar a configuração Groq: ${keyConfig.error}.`
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

  // Lista única e ordenada das datas com histórico para exibição na tabela
  const datasOrdenadas = useMemo(() => {
    const datesSet = new Set<string>();
    relatoriosDraft.forEach((item) => {
      if (item.data) datesSet.add(item.data);
    });
    (campanhaDraft?.metricasDashboard?.historicoDiario || []).forEach((item) => {
      if (item.data) datesSet.add(item.data);
    });
    // Ordena da mais recente para a mais antiga
    return Array.from(datesSet).sort().reverse();
  }, [relatoriosDraft, campanhaDraft?.metricasDashboard?.historicoDiario]);

  const handleCopyClientLink = async (slug: string) => {
    const link = `${window.location.origin}/c/${encodeURIComponent(slug)}`;
    try {
      await navigator.clipboard.writeText(link);
      flash("Link exclusivo do cliente copiado!");
    } catch {
      flash(`Link: ${link}`);
    }
  };

  // Salvar perfil da campanha (cores, tema, nome)
  const handleSaveCampanha = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!campanhaDraft) return;
    setSaving(true);
    setError(null);
    try {
      const payload = await saveCampanha(campanhaDraft.id, {
        status: campanhaDraft.status,
        diasAcumulados: Number(campanhaDraft.diasAcumulados) || 0,
        totalExibicoesAcumuladas: Number(campanhaDraft.totalExibicoesAcumuladas) || 0,
        clienteNome: campanhaDraft.clienteNome.trim(),
        campanhaNome: campanhaDraft.campanhaNome.trim(),
        periodo: campanhaDraft.periodo.trim(),
        clientTheme: { ...DEFAULT_CLIENT_THEME, ...campanhaDraft.clientTheme },
      });
      applyDb(payload.db);
      flash("Perfil e configurações do cliente salvos no Supabase!");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // Salvar metas individuais das telas
  const handleSaveMetas = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!campanhaDraft || telasDraft.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      let nextDb: WhiteVisionDb | null = null;
      for (const tela of telasDraft) {
        const payload = await saveTela(tela.id, {
          metaDiaria: tela.metaDiaria !== null && tela.metaDiaria !== undefined ? Number(tela.metaDiaria) : null,
          status: tela.status,
        });
        nextDb = payload.db;
      }
      if (nextDb) applyDb(nextDb);
      flash("Metas diárias das telas atualizadas no Supabase com sucesso!");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  /**
   * BOTÃO PRINCIPAL DE SALVAR HISTÓRICO DIÁRIO
   * Faz o upsert completo no Supabase de todas as linhas de exibição do cliente selecionado.
   */
  const handleSaveRelatorios = async () => {
    if (!campanhaDraft) {
      setError("Selecione um cliente antes de salvar os relatórios diários.");
      return;
    }
    if (telasDraft.length === 0) {
      setError("Este cliente não possui telas ativas. Adicione ou importe telas antes de salvar.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // 1. Atualiza também as metas de cada tela caso o usuário tenha alterado na tabela
      for (const tela of telasDraft) {
        await saveTela(tela.id, {
          metaDiaria: tela.metaDiaria !== null && tela.metaDiaria !== undefined ? Number(tela.metaDiaria) : null,
          status: tela.status,
        });
      }

      // 2. Prepara os registros para gravação/upsert
      const recordsToSave: RelatorioDiarioTela[] = relatoriosDraft.map((item) => ({
        id: item.id || crypto.randomUUID(),
        data: item.data,
        telaId: item.telaId,
        exibicoesEntregues: Math.max(0, Number(item.exibicoesEntregues) || 0),
        metaDiaria:
          item.metaDiaria !== null && item.metaDiaria !== undefined && String(item.metaDiaria) !== ""
            ? Math.max(0, Number(item.metaDiaria))
            : null,
        falhaNominal: Boolean(item.falhaNominal),
        statusRelatorio: item.statusRelatorio || "desconhecido",
        observacaoFalha: item.observacaoFalha ? String(item.observacaoFalha).trim() : "",
      }));

      const payload = await saveRelatorios(campanhaDraft.id, recordsToSave);
      if (payload?.db) {
        applyDb(payload.db);
      }

      // 3. Recarrega os dados diretamente do Supabase para sincronização 100% garantida
      const refreshedClient = await fetchClientAdminData(campanhaDraft.id);
      setCampanhaDraft(refreshedClient.campanha);
      setTelasDraft(refreshedClient.telas || []);
      setRelatoriosDraft(refreshedClient.relatoriosDiarios || []);

      flash("Salvo com sucesso! Todos os relatórios diários e metas foram gravados no Supabase.");
    } catch (err) {
      setError(
        `Erro ao salvar relatórios no Supabase: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
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

  // Adiciona uma nova data para todas as telas
  const handleAddReportDay = () => {
    if (!campanhaDraft || !newReportDate) {
      setError("Informe a data para adicionar ao histórico.");
      return;
    }
    if (telasDraft.length === 0) {
      setError("Cadastre ou importe telas antes de adicionar registros diários.");
      return;
    }

    const existingScreenIdsForDate = new Set(
      relatoriosDraft.filter((item) => item.data === newReportDate).map((item) => item.telaId)
    );

    const newRows: RelatorioDiarioTela[] = telasDraft
      .filter((screen) => !existingScreenIdsForDate.has(screen.id))
      .map((screen) => ({
        id: crypto.randomUUID(),
        data: newReportDate,
        telaId: screen.id,
        exibicoesEntregues: 0,
        metaDiaria: screen.metaDiaria,
        falhaNominal: false,
        statusRelatorio: "desconhecido",
        observacaoFalha: "",
      }));

    if (newRows.length === 0) {
      setError(`Já existem registros para todas as telas no dia ${formatDia(newReportDate)}.`);
      return;
    }

    setError(null);
    setRelatoriosDraft((prev) => [...prev, ...newRows]);
    flash(`Dia ${formatDia(newReportDate)} adicionado. Clique no botão verde 'Salvar Relatórios Diários' para gravar.`);
  };

  const handleDeleteDailyReport = async (report: RelatorioDiarioTela) => {
    if (!window.confirm(`Excluir o registro de ${formatDia(report.data)}?`)) return;
    if (!campanhaDraft) return;

    setDeletingDailyReport(true);
    setError(null);
    try {
      const payload = await deleteRelatorioDiario(campanhaDraft.id, report.id);
      applyDb(payload.db);
      setRelatoriosDraft((prev) => prev.filter((item) => item.id !== report.id));
      flash("Registro diário removido do Supabase.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingDailyReport(false);
    }
  };

  // Geração do resumo executivo da IA com dados reais do cliente
  const handleGenerateSummary = () => {
    if (!campanhaDraft) return;
    setError(null);

    const totalInsercoes = relatoriosDraft.reduce(
      (sum, item) => sum + (Number(item.exibicoesEntregues) || 0),
      0
    );

    const totalMetas = relatoriosDraft.reduce(
      (sum, item) => sum + (Number(item.metaDiaria) || 0),
      0
    );

    const diasUnicos = new Set(relatoriosDraft.map((item) => item.data)).size;
    const telasAtivas = telasDraft.filter((tela) => tela.status === "online").length;
    const falhasRegistradas = relatoriosDraft.filter((item) => item.falhaNominal).length;

    const percentualAtingimento =
      totalMetas > 0 ? ((totalInsercoes / totalMetas) * 100).toFixed(1) : null;

    const textoPercentual = percentualAtingimento
      ? `A conformidade acumulada da campanha é de ${percentualAtingimento}% em relação à meta prevista.`
      : "Metas nominais não definidas para todas as veiculações.";

    const textoFalha =
      falhasRegistradas > 0
        ? `Foram identificadas ${falhasRegistradas} ocorrências com queda ou falha pontual de exibição anotadas nas observações.`
        : "Nenhuma ocorrência crítica de queda ou interrupção de sinal foi reportada no período auditado.";

    setSummary(
      `📊 Resumo Executivo da Campanha — ${campanhaDraft.clienteNome} (${campanhaDraft.campanhaNome})\n\n` +
      `No período analisado (${campanhaDraft.periodo || "Auditoria Ativa"}), foram registradas ${totalInsercoes.toLocaleString("pt-BR")} inserções entregues ao longo de ${diasUnicos} dias de veiculação em ${telasDraft.length} telas monitoradas (${telasAtivas} online).\n\n` +
      `${textoPercentual}\n${textoFalha}`
    );
  };

  const handleCreateClient = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = await createClient({
        clienteNome: clientNameDraft.trim(),
        campanhaNome: clientCampaignDraft.trim(),
      });
      applyDb(payload.db);
      setClientNameDraft("");
      setClientCampaignDraft("");
      const created = payload.db.campanhas[payload.db.campanhas.length - 1];
      if (created) {
        await selectClientForAdmin(created.id);
        flash(`Cliente "${created.clienteNome}" criado e selecionado com sucesso!`);
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
        clienteNome: pdfClientNameDraft.trim(),
        campanhaNome: pdfCampaignNameDraft.trim(),
      });
      applyDb(payload.db);
      const created = payload.db.campanhas[payload.db.campanhas.length - 1];
      if (created) {
        await selectClientForAdmin(created.id);
      }
      setPdfClientNameDraft("");
      setPdfCampaignNameDraft("");
      setShowPdfClientForm(false);
      flash(`Cliente "${created?.clienteNome}" cadastrado e pronto para o PDF.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleImportPdf = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reportPdf || !pdfClientId) {
      setError("Selecione o cliente de destino e o arquivo PDF.");
      return;
    }
    setImportingPdf(true);
    setError(null);
    setImportedReport(null);
    try {
      const result = await importPdfReport(reportPdf, pdfClientId);
      applyDb(result.db);
      await selectClientForAdmin(result.campaignId);
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
      flash(`Relatório processado e salvo no perfil de ${result.clientName}!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof PdfImportError && err.pdfSaved) {
        void load();
        setError(`${msg} (O PDF foi salvo no histórico mesmo assim).`);
      } else {
        setError(msg);
      }
    } finally {
      setImportingPdf(false);
    }
  };

  const handleSavePdf = async (uploadId: string) => {
    setSaving(true);
    try {
      const result = await savePdfReport(uploadId);
      applyDb(result.db);
      flash("Relatório PDF salvo no histórico.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePdfSummary = async (uploadId: string) => {
    setGeneratingSummary(true);
    try {
      const result = await generatePdfReportSummary(uploadId);
      applyDb(result.db);
      flash("Resumo da IA gerado para o PDF.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleSavePdfToClient = async (uploadId: string) => {
    setSaving(true);
    try {
      const result = await savePdfReportToClient(uploadId);
      applyDb(result.db);
      if (campanhaDraft) await selectClientForAdmin(campanhaDraft.id);
      setProfileSavedLink({ clientName: result.clientName, clientPath: result.clientPath });
      flash(`Dados do PDF gravados com sucesso para ${result.clientName}!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePdf = async (uploadId: string, fileName: string) => {
    if (!window.confirm(`Excluir o PDF "${fileName}"?`)) return;
    setSaving(true);
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

  const handleUploadMedia = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mediaCampaignId || (!mediaFile && !editingMediaId)) {
      setError("Selecione o cliente e um arquivo de vídeo ou imagem.");
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
        if (!mediaFile) throw new Error("Selecione um arquivo para envio.");
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
      flash("Mídia enviada e vinculada ao cliente com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleDeleteVideo = async (videoId: string) => {
    if (!window.confirm("Deseja excluir este arquivo de mídia?")) return;
    setSaving(true);
    try {
      const payload = await removeVideo(videoId);
      applyDb(payload.db);
      flash("Arquivo de mídia excluído.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClient = async (campaign: CampanhaCliente) => {
    if (!window.confirm(`Remover ${campaign.clienteNome} e todos os seus relatórios e arquivos?`)) return;
    setSaving(true);
    try {
      const payload = await removeClient(campaign.id);
      applyDb(payload.db);
      if (campanhaDraft?.id === campaign.id) {
        const remaining = payload.db.campanhas[0] || null;
        if (remaining) await selectClientForAdmin(remaining.id);
        else {
          setCampanhaDraft(null);
          setTelasDraft([]);
          setRelatoriosDraft([]);
        }
      }
      flash("Cliente removido com sucesso.");
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
      flash("Chave Groq atualizada com segurança.");
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
      flash("Conexão com a API Groq verificada e funcionando!");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingGroq(false);
    }
  };

  const handleSaveLogo = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!logoFile) return;
    setSavingLogo(true);
    setError(null);
    try {
      await uploadWhiteVisionLogo(logoFile);
      setLogoFile(null);
      setLogoRevision(Date.now());
      flash("Logo da White Vision atualizada com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingLogo(false);
    }
  };

  const handleUploadThemeLogo = async (file: File) => {
    if (!campanhaDraft) return;
    setUploadingThemeLogo(true);
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
      flash("Logo do totem carregada. Salve o perfil para publicar.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingThemeLogo(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center gap-3">
        <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
        <p className="text-sm font-medium">Carregando painel e sincronizando com o Supabase...</p>
      </div>
    );
  }

  if (!db) {
    return (
      <div className="min-h-screen bg-slate-950 text-rose-300 flex items-center justify-center p-6">
        {error || "Erro ao conectar com o banco de dados."}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-16">
      {/* CABEÇALHO */}
      <header className="border-b border-slate-800 bg-slate-900/80 sticky top-0 z-30 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-4">
            <img
              src={`${getPublicMediaUrl("branding/white-vision-logo.png")}?v=${logoRevision}`}
              alt="White Vision"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = "/white-vision-logo.png";
              }}
              className="h-10 w-auto object-contain"
            />
            <div>
              <p className="text-xs uppercase tracking-wider text-emerald-400 font-bold">White Vision</p>
              <h1 className="text-xl font-extrabold text-white">Painel Administrativo</h1>
            </div>
          </div>

          {campanhaDraft && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Cliente ativo:</span>
              <span className="text-xs font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                {campanhaDraft.clienteNome}
              </span>
              <a
                href={`/c/${encodeURIComponent(campanhaDraft.slug)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 underline ml-2"
              >
                Abrir Portal <ExternalLink size={12} />
              </a>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* MENSAGENS E ALERTAS */}
        {message && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/60 px-4 py-3 text-emerald-300 text-sm flex items-center gap-3">
            <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />
            <span>{message}</span>
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/60 px-4 py-3 text-rose-300 text-sm flex items-center gap-3">
            <AlertCircle size={18} className="shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* 1. SELETOR RÁPIDO DO CLIENTE ATIVO */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-white">Cliente em Gerenciamento</h2>
              <p className="text-sm text-slate-400">
                Selecione o cliente para visualizar e gravar metas, relatórios de 30 dias e arquivos.
              </p>
            </div>
            {loadingClientData && (
              <span className="text-xs text-sky-300 flex items-center gap-1.5 font-medium animate-pulse">
                <RefreshCw size={13} className="animate-spin" /> Sincronizando com Supabase...
              </span>
            )}
          </div>

          <div className="max-w-xl">
            <select
              value={campanhaDraft?.id || ""}
              onChange={(e) => void selectClientForAdmin(e.target.value)}
              disabled={loadingClientData}
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-slate-100 font-medium focus:border-emerald-500 focus:outline-none"
            >
              {db.campanhas.length === 0 && <option value="">Nenhum cliente cadastrado</option>}
              {db.campanhas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.clienteNome} — {c.campanhaNome}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* 2. TABELA PRINCIPAL DE RELATÓRIOS DIÁRIOS DE 30 DIAS */}
        {campanhaDraft && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800/80 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  Relatórios Diários de 30 Dias — {campanhaDraft.clienteNome}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Edite as exibições entregues por tela, quedas de sinal e observações. Clique no botão verde para persistir tudo no Supabase.
                </p>
              </div>

              {/* BOTÃO DE SALVAR RELATÓRIOS (ONCLICK DIRETO AO SUPABASE) */}
              <button
                type="button"
                onClick={() => void handleSaveRelatorios()}
                disabled={saving || loadingClientData || telasDraft.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold px-5 py-2.5 shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition"
              >
                {saving ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" /> Salvando no Supabase...
                  </>
                ) : (
                  <>
                    <Save size={16} /> Salvar Relatórios Diários
                  </>
                )}
              </button>
            </div>

            {/* ADICIONAR NOVO DIA */}
            <div className="flex flex-col sm:flex-row sm:items-end gap-3 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
              <label className="text-xs space-y-1">
                <span className="block text-slate-400 font-semibold">Adicionar nova data ao histórico</span>
                <input
                  type="date"
                  value={newReportDate}
                  onChange={(e) => setNewReportDate(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
                />
              </label>
              <button
                type="button"
                onClick={handleAddReportDay}
                disabled={loadingClientData || telasDraft.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 px-3.5 py-2 text-xs font-semibold text-sky-200 disabled:opacity-50 transition"
              >
                <Plus size={14} /> Adicionar Dia para Todas as Telas
              </button>
            </div>

            {/* TABELA DE VEICULAÇÕES */}
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full min-w-[780px] text-sm">
                <thead>
                  <tr className="text-left text-slate-400 bg-slate-950/80 border-b border-slate-800">
                    <th className="py-2.5 px-3">Data</th>
                    {telasDraft.map((tela) => {
                      const ponto = pontosDraft.find((p) => p.id === tela.pontoId);
                      return (
                        <th key={tela.id} colSpan={5} className="py-2.5 px-3 text-center border-l border-slate-800 font-semibold text-emerald-300">
                          {ponto?.nome ? `${ponto.nome} • ` : ""}{tela.nome}
                        </th>
                      );
                    })}
                  </tr>
                  <tr className="text-left text-slate-500 bg-slate-950/40 border-b border-slate-800 text-xs">
                    <th className="py-2 px-3" />
                    {telasDraft.map((tela) => (
                      <React.Fragment key={`${tela.id}-sub`}>
                        <th className="py-2 px-2 border-l border-slate-800">Meta</th>
                        <th className="py-2 px-2">Exibições</th>
                        <th className="py-2 px-2 text-center">Falha</th>
                        <th className="py-2 px-2">Observação</th>
                        <th className="py-2 px-2 text-center">Ação</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-950/20">
                  {datasOrdenadas.length === 0 && (
                    <tr>
                      <td colSpan={1 + Math.max(1, telasDraft.length) * 5} className="py-8 text-center text-sm text-slate-400">
                        {telasDraft.length === 0
                          ? "Nenhuma tela vinculada a este cliente. Importe um relatório PDF para carregar as telas automaticamente."
                          : "Nenhum dia cadastrado no histórico ainda. Escolha uma data acima e clique em 'Adicionar Dia'."}
                      </td>
                    </tr>
                  )}
                  {datasOrdenadas.map((data) => (
                    <tr key={data} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-3 whitespace-nowrap font-mono text-xs font-bold text-slate-300">
                        {formatDia(data)}
                      </td>
                      {telasDraft.map((tela) => {
                        const relatorio = relatoriosDraft.find(
                          (item) => item.telaId === tela.id && item.data === data
                        );

                        if (!relatorio) {
                          return (
                            <td key={`${tela.id}-${data}-vazio`} colSpan={5} className="py-2 px-3 text-xs text-slate-500 border-l border-slate-800">
                              <div className="flex items-center gap-2">
                                <span>Sem dados</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRelatoriosDraft((prev) => [
                                      ...prev,
                                      {
                                        id: crypto.randomUUID(),
                                        data,
                                        telaId: tela.id,
                                        exibicoesEntregues: 0,
                                        metaDiaria: tela.metaDiaria,
                                        falhaNominal: false,
                                        statusRelatorio: "desconhecido",
                                        observacaoFalha: "",
                                      },
                                    ]);
                                  }}
                                  className="text-sky-400 hover:underline"
                                >
                                  + Inserir
                                </button>
                              </div>
                            </td>
                          );
                        }

                        return (
                          <React.Fragment key={`${tela.id}-${data}`}>
                            <td className="py-2 px-2 border-l border-slate-800">
                              <input
                                type="number"
                                min={0}
                                value={relatorio.metaDiaria ?? ""}
                                onChange={(e) =>
                                  updateRelatorio(tela.id, data, {
                                    metaDiaria: e.target.value === "" ? null : Number(e.target.value),
                                  })
                                }
                                className="w-20 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="number"
                                min={0}
                                value={relatorio.exibicoesEntregues}
                                onChange={(e) =>
                                  updateRelatorio(tela.id, data, {
                                    exibicoesEntregues: Math.max(0, Number(e.target.value) || 0),
                                  })
                                }
                                className="w-20 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-emerald-300 font-semibold"
                              />
                            </td>
                            <td className="py-2 px-2 text-center">
                              <input
                                type="checkbox"
                                checked={relatorio.falhaNominal}
                                onChange={(e) =>
                                  updateRelatorio(tela.id, data, {
                                    falhaNominal: e.target.checked,
                                  })
                                }
                                className="rounded border-slate-700 accent-rose-500"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                placeholder="Motivo da falha ou queda"
                                value={relatorio.observacaoFalha || ""}
                                onChange={(e) =>
                                  updateRelatorio(tela.id, data, {
                                    observacaoFalha: e.target.value,
                                  })
                                }
                                className="w-44 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-300 placeholder:text-slate-600"
                              />
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                type="button"
                                disabled={deletingDailyReport || saving}
                                onClick={() => void handleDeleteDailyReport(relatorio)}
                                className="text-rose-400 hover:text-rose-300 p-1"
                                title="Excluir este registro"
                              >
                                <Trash2 size={13} />
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

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => void handleSaveRelatorios()}
                disabled={saving || loadingClientData || telasDraft.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold px-6 py-2.5 shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition"
              >
                {saving ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" /> Salvando no Supabase...
                  </>
                ) : (
                  <>
                    <Save size={16} /> Salvar Relatórios Diários
                  </>
                )}
              </button>
            </div>
          </section>
        )}

        {/* 3. ASSISTENTE DE RESUMO IA COM DADOS REAIS */}
        {campanhaDraft && (
          <section className="rounded-2xl border border-violet-500/30 bg-slate-900/90 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Sparkles size={18} className="text-violet-400" />
                  Assistente de Relatórios Groq (Dados Reais)
                </h2>
                <p className="text-xs text-slate-400">
                  Sintetiza as veiculações salvas, conformidade das metas e integridade das telas em um relatório executivo.
                </p>
              </div>
              <button
                type="button"
                onClick={handleGenerateSummary}
                className="rounded-xl bg-violet-500 hover:bg-violet-400 text-slate-950 font-extrabold px-4 py-2 text-sm shadow-lg shadow-violet-500/20 transition"
              >
                Gerar Análise Executiva
              </button>
            </div>
            {summary && (
              <div className="whitespace-pre-wrap rounded-xl border border-violet-500/30 bg-slate-950 p-4 text-xs sm:text-sm text-slate-200 leading-relaxed font-sans">
                {summary}
              </div>
            )}
          </section>
        )}

        {/* 4. METAS INDIVIDUAIS POR TELA */}
        {campanhaDraft && (
          <form
            onSubmit={handleSaveMetas}
            className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-white">Metas e Status por Tela</h2>
                <p className="text-xs text-slate-400">
                  Configurações nominais das telas físicas vinculadas a {campanhaDraft.clienteNome}.
                </p>
              </div>
              {telasDraft.length > 0 && (
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold px-4 py-2 text-xs shadow-md transition"
                >
                  Salvar Metas das Telas
                </button>
              )}
            </div>

            {telasDraft.length === 0 ? (
              <p className="text-xs text-slate-400 italic">
                Nenhuma tela cadastrada ainda. Elas são criadas automaticamente ao importar o relatório PDF da campanha.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {telasDraft.map((tela, idx) => {
                  const ponto = pontosDraft.find((p) => p.id === tela.pontoId);
                  return (
                    <div key={tela.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
                      <p className="font-semibold text-xs text-emerald-300">
                        {ponto?.nome || "Ponto"} • {tela.nome}
                      </p>
                      <label className="text-xs space-y-1 block">
                        <span className="text-slate-400">Meta diária padrão:</span>
                        <input
                          type="number"
                          value={tela.metaDiaria ?? ""}
                          onChange={(e) => {
                            const next = [...telasDraft];
                            next[idx] = {
                              ...tela,
                              metaDiaria: e.target.value === "" ? null : Number(e.target.value),
                            };
                            setTelasDraft(next);
                          }}
                          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100"
                        />
                      </label>
                      <label className="text-xs space-y-1 block">
                        <span className="text-slate-400">Status de conexão:</span>
                        <select
                          value={tela.status}
                          onChange={(e) => {
                            const next = [...telasDraft];
                            next[idx] = {
                              ...tela,
                              status: e.target.value as TelaPonto["status"],
                            };
                            setTelasDraft(next);
                          }}
                          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-slate-100"
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
            )}
          </form>
        )}

        {/* 5. PERFIL E TEMA DO CLIENTE */}
        {campanhaDraft && (
          <form
            onSubmit={handleSaveCampanha}
            className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-4"
          >
            <h2 className="text-lg font-bold text-white">Configurações de Identidade do Cliente</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
              <label className="space-y-1">
                <span className="text-slate-400">Nome do cliente</span>
                <input
                  required
                  value={campanhaDraft.clienteNome}
                  onChange={(e) => setCampanhaDraft({ ...campanhaDraft, clienteNome: e.target.value })}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-400">Nome da campanha</span>
                <input
                  required
                  value={campanhaDraft.campanhaNome}
                  onChange={(e) => setCampanhaDraft({ ...campanhaDraft, campanhaNome: e.target.value })}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-400">Período de auditoria</span>
                <input
                  value={campanhaDraft.periodo}
                  onChange={(e) => setCampanhaDraft({ ...campanhaDraft, periodo: e.target.value })}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-400">Status geral da campanha</span>
                <select
                  value={campanhaDraft.status}
                  onChange={(e) =>
                    setCampanhaDraft({ ...campanhaDraft, status: e.target.value as StatusCampanha })
                  }
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="ativa">Ativa</option>
                  <option value="pausada">Pausada</option>
                  <option value="encerrada">Encerrada</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-slate-400">Dias acumulados</span>
                <input
                  type="number"
                  min={0}
                  value={campanhaDraft.diasAcumulados}
                  onChange={(e) =>
                    setCampanhaDraft({ ...campanhaDraft, diasAcumulados: Number(e.target.value) })
                  }
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-400">Total histórico de exibições</span>
                <input
                  type="number"
                  min={0}
                  value={campanhaDraft.totalExibicoesAcumuladas}
                  onChange={(e) =>
                    setCampanhaDraft({
                      ...campanhaDraft,
                      totalExibicoesAcumuladas: Number(e.target.value),
                    })
                  }
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-400">Cor da moldura do totem</span>
                <input
                  type="color"
                  value={campanhaDraft.clientTheme?.frameColor || DEFAULT_CLIENT_THEME.frameColor}
                  onChange={(e) =>
                    setCampanhaDraft({
                      ...campanhaDraft,
                      clientTheme: {
                        ...DEFAULT_CLIENT_THEME,
                        ...campanhaDraft.clientTheme,
                        frameColor: e.target.value,
                      },
                    })
                  }
                  className="h-9 w-full rounded-lg bg-slate-950 border border-slate-700 p-1"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-400">Cor primária dos botões</span>
                <input
                  type="color"
                  value={campanhaDraft.clientTheme?.primaryColor || DEFAULT_CLIENT_THEME.primaryColor}
                  onChange={(e) =>
                    setCampanhaDraft({
                      ...campanhaDraft,
                      clientTheme: {
                        ...DEFAULT_CLIENT_THEME,
                        ...campanhaDraft.clientTheme,
                        primaryColor: e.target.value,
                      },
                    })
                  }
                  className="h-9 w-full rounded-lg bg-slate-950 border border-slate-700 p-1"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-400">Logo do totem (upload)</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingThemeLogo}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUploadThemeLogo(file);
                    e.currentTarget.value = "";
                  }}
                  className="block w-full text-xs text-slate-400 file:mr-2 file:rounded-md file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-200"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-5 py-2 text-sm shadow-md transition"
            >
              Salvar Perfil do Cliente
            </button>
          </form>
        )}

        {/* 6. IMPORTAÇÃO DE RELATÓRIO PDF VIA GROQ */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-white">Importar Relatório PDF via Groq</h2>
              <p className="text-xs text-slate-400">
                Extrai automaticamente telas, metas e histórico diário gravando diretamente no Supabase.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPdfClientForm((open) => !open)}
              className="text-xs text-sky-400 hover:underline"
            >
              {showPdfClientForm ? "Cancelar novo cliente" : "+ Cadastrar Novo Cliente para o PDF"}
            </button>
          </div>

          {showPdfClientForm && (
            <form
              onSubmit={handleCreatePdfClient}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-slate-950/80 rounded-xl border border-slate-800"
            >
              <input
                required
                placeholder="Nome do Cliente"
                value={pdfClientNameDraft}
                onChange={(e) => setPdfClientNameDraft(e.target.value)}
                className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-200"
              />
              <input
                required
                placeholder="Nome da Campanha"
                value={pdfCampaignNameDraft}
                onChange={(e) => setPdfCampaignNameDraft(e.target.value)}
                className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-200"
              />
              <button
                type="submit"
                disabled={saving}
                className="sm:col-span-2 rounded-lg bg-sky-500 text-slate-950 font-bold py-1.5 text-xs"
              >
                Cadastrar e Selecionar
              </button>
            </form>
          )}

          <form onSubmit={handleImportPdf} className="flex flex-col sm:flex-row sm:items-end gap-3">
            <label className="text-xs space-y-1 flex-1">
              <span className="text-slate-300">Cliente Destinatário</span>
              <select
                required
                value={pdfClientId}
                onChange={(e) => void selectClientForAdmin(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-200"
              >
                <option value="" disabled>Selecione o cliente</option>
                {db.campanhas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.clienteNome} — {c.campanhaNome}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs space-y-1 flex-1">
              <span className="text-slate-300">Arquivo PDF (máx. 10 MB)</span>
              <input
                ref={pdfInputRef}
                required
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setReportPdf(e.target.files?.[0] || null)}
                className="block w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-300 file:mr-2 file:rounded-md file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-200"
              />
            </label>
            <button
              type="submit"
              disabled={importingPdf || !reportPdf || !pdfClientId}
              className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 text-xs disabled:opacity-50 transition"
            >
              {importingPdf ? "Analisando..." : "Analisar e Gravar PDF"}
            </button>
          </form>

          {/* Histórico de relatórios enviados */}
          {db.relatoriosPdf.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                PDFs Processados
              </h3>
              <ul className="divide-y divide-slate-800 text-xs">
                {db.relatoriosPdf
                  .filter((item) => !pdfClientId || item.campanhaId === pdfClientId)
                  .map((item) => (
                    <li key={item.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-200">{item.nomeArquivo}</p>
                        <p className="text-slate-500 text-[11px]">
                          {new Date(item.criadoEm).toLocaleString("pt-BR")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.status === "analisado" && (
                          <button
                            type="button"
                            onClick={() => void handleSavePdf(item.id)}
                            className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300"
                          >
                            Salvar Histórico
                          </button>
                        )}
                        {item.status === "salvo" && !item.resumoIA && (
                          <button
                            type="button"
                            onClick={() => void handleGeneratePdfSummary(item.id)}
                            className="rounded border border-violet-500/40 px-2 py-1 text-violet-300"
                          >
                            Gerar Resumo IA
                          </button>
                        )}
                        {item.resumoIA && (
                          <button
                            type="button"
                            onClick={() => void handleSavePdfToClient(item.id)}
                            className="rounded border border-sky-500/40 px-2 py-1 text-sky-300"
                          >
                            Aplicar ao Perfil
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDeletePdf(item.id, item.nomeArquivo)}
                          className="text-rose-400 p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>

        {/* 7. UPLOAD DE MÍDIA POR CLIENTE */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-white">Upload de Mídia e Vídeos</h2>
            <p className="text-xs text-slate-400">
              Envie arquivos MP4, PNG ou JPG associados à campanha do cliente ativo.
            </p>
          </div>
          <form onSubmit={handleUploadMedia} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-slate-400">Cliente de destino</span>
              <select
                required
                value={mediaCampaignId}
                onChange={(e) => {
                  setMediaCampaignId(e.target.value);
                  void selectClientForAdmin(e.target.value);
                }}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100"
              >
                {db.campanhas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.clienteNome}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Título da mídia</span>
              <input
                value={mediaTitle}
                onChange={(e) => setMediaTitle(e.target.value)}
                placeholder="Ex: Comercial 30s Institucional"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100"
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-slate-400">Arquivo de vídeo ou imagem (máx. 100 MB)</span>
              <input
                ref={mediaInputRef}
                type="file"
                accept="video/mp4,image/*"
                onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
                className="block w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-400 file:mr-2 file:rounded-md file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-200"
              />
            </label>
            <button
              type="submit"
              disabled={uploadingMedia || (!mediaFile && !editingMediaId)}
              className="sm:col-span-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2 text-xs disabled:opacity-50 transition"
            >
              {uploadingMedia ? "Enviando arquivo..." : "Enviar Mídia para o Cliente"}
            </button>
          </form>

          {videos.length > 0 && (
            <ul className="divide-y divide-slate-800 pt-3">
              {videos.map((v) => (
                <li key={v.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                  <div>
                    <p className="font-semibold text-white">{v.titulo}</p>
                    <p className="text-slate-500">
                      {v.nomeArquivo} • {(v.tamanhoBytes / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={adminMediaPath(v.arquivoId)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-400 hover:underline"
                    >
                      Visualizar
                    </a>
                    <button
                      type="button"
                      onClick={() => void handleDeleteVideo(v.id)}
                      className="text-rose-400 hover:text-rose-300 ml-2"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 8. GESTÃO GERAL DE CLIENTES E LINKS EXCLUSIVOS */}
        <section id="client-links" className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-4">
          <h2 className="text-lg font-bold text-white">Cadastrar Novo Cliente</h2>
          <form onSubmit={handleCreateClient} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <input
              required
              placeholder="Nome da Empresa / Cliente"
              value={clientNameDraft}
              onChange={(e) => setClientNameDraft(e.target.value)}
              className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100"
            />
            <input
              required
              placeholder="Nome da Campanha Inicial"
              value={clientCampaignDraft}
              onChange={(e) => setClientCampaignDraft(e.target.value)}
              className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100"
            />
            <button
              type="submit"
              disabled={saving}
              className="sm:col-span-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2 text-xs transition"
            >
              Criar Cliente e Gerar Link Exclusivo
            </button>
          </form>

          <div className="pt-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Clientes Cadastrados no Sistema
            </h3>
            <ul className="divide-y divide-slate-800 text-xs">
              {db.campanhas.map((c) => (
                <li key={c.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <span className="font-semibold text-slate-200">{c.clienteNome}</span>
                    <span className="text-slate-500"> — {c.campanhaNome}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void selectClientForAdmin(c.id)}
                      className="rounded border border-slate-700 px-2.5 py-1 text-slate-200 hover:bg-slate-800"
                    >
                      Selecionar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyClientLink(c.slug)}
                      className="rounded border border-sky-500/40 text-sky-300 px-2.5 py-1 hover:bg-sky-500/10"
                    >
                      Copiar Link
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteClient(c)}
                      className="text-rose-400 hover:text-rose-300 p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 9. CONFIGURAÇÃO DA CHAVE GROQ E BRANDING */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-3 text-xs">
            <h2 className="text-base font-bold text-white">Chave Groq API</h2>
            <p className="text-slate-400">
              Status: <span className="font-semibold text-emerald-300">{groqKeyStatus}</span>
            </p>
            <form onSubmit={handleSaveGroqKey} className="space-y-2">
              <input
                type="password"
                placeholder="Insira a nova chave da Groq"
                value={groqApiKey}
                onChange={(e) => setGroqApiKey(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-200"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={savingGroqKey || groqApiKey.length < 15}
                  className="rounded-lg bg-violet-500 hover:bg-violet-400 text-slate-950 font-bold px-3 py-1.5"
                >
                  Salvar Chave
                </button>
                <button
                  type="button"
                  onClick={() => void handleTestGroq()}
                  disabled={testingGroq}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300"
                >
                  Testar Conexão
                </button>
              </div>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-3 text-xs">
            <h2 className="text-base font-bold text-white">Logo da White Vision</h2>
            <form onSubmit={handleSaveLogo} className="space-y-2">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                className="block w-full text-slate-400 file:mr-2 file:rounded-md file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-200"
              />
              <button
                type="submit"
                disabled={savingLogo || !logoFile}
                className="rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3 py-1.5"
              >
                {savingLogo ? "Atualizando..." : "Atualizar Logo Oficial"}
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}

export default AdminPage;