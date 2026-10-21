import { randomUUID } from "crypto";
import type { CampanhaCliente, PontoTela, TelaPonto, WhiteVisionDb } from "../src/types/adminDb.ts";
import type { RelatorioData } from "../src/types/whiteVision.ts";
import { readDb, writeDb } from "./dbStore.ts";

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function evidenceHasCount(evidence: string, value: number): boolean {
  const withoutDates = evidence.replace(
    /\b(?:\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)\b/g,
    " "
  );
  return [...withoutDates.matchAll(/\d[\d.,\s]*/g)].some(
    ([match]) => match.replace(/\D/g, "") === String(value)
  );
}

function evidenceHasText(evidence: string, value: string): boolean {
  return Boolean(value.trim()) && normalizeName(evidence).includes(normalizeName(value));
}

function evidenceHasDate(evidence: string, isoDate: string): boolean {
  const [, year, month, day] = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  if (!year || !month || !day) return false;
  const normalizedEvidence = evidence.replace(/\D/g, "");
  return [
    `${year}${month}${day}`,
    `${day}${month}${year}`,
    `${day}${month}${year.slice(-2)}`,
  ].some((date) => normalizedEvidence.includes(date));
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function getPeriodDayCount(period: string, historyDayCount: number): number {
  const dates = [...period.matchAll(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/g)];
  if (dates.length >= 2) {
    const parseDate = (match: RegExpMatchArray) =>
      Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    const start = parseDate(dates[0]);
    const end = parseDate(dates[1]);
    if (end >= start) {
      return Math.floor((end - start) / 86_400_000) + 1;
    }
  }
  return historyDayCount;
}

export function normalizeExtractedReport(
  value: Partial<RelatorioData>,
  defaults?: { campaignName?: string }
): RelatorioData {
  const input = value;
  const desempenhoPorTela = (Array.isArray(input.desempenhoPorTela)
    ? input.desempenhoPorTela
    : []
  ).filter(
    (item) =>
      typeof item.localNome === "string" &&
      item.localNome.trim() &&
      typeof item.telaNome === "string" &&
      item.telaNome.trim() &&
      isCount(item.insercoes)
  );
  const inputLocais = Array.isArray(input.locais) ? input.locais : [];
  const locaisComDesempenho = [...inputLocais];
  for (const item of desempenhoPorTela) {
    let local = locaisComDesempenho.find(
      (candidate) => normalizeName(candidate.nome) === normalizeName(item.localNome)
    );
    if (!local) {
      local = {
        id: "",
        nome: item.localNome,
        horarioFuncionamento: "",
        totalExibicoes: 0,
        frequenciaLocal: "",
        telas: [],
      };
      locaisComDesempenho.push(local);
    }
    if (!local.telas.some((screen) => normalizeName(screen.nome) === normalizeName(item.telaNome))) {
      local.telas.push({
        id: "",
        nome: item.telaNome,
        exibicoes: item.insercoes,
        metaDiariaEsperada: null,
        status: "desconhecido",
      });
    }
  }
  const report = {
    ...input,
    token: typeof input.token === "string" ? input.token : "",
    clienteNome: typeof input.clienteNome === "string" ? input.clienteNome : "",
    campanhaNome:
      typeof input.campanhaNome === "string" && input.campanhaNome.trim()
        ? input.campanhaNome
        : defaults?.campaignName || "Não informado",
    periodo:
      typeof input.periodo === "string" && input.periodo.trim()
        ? input.periodo
        : "Não informado",
    diasEmExibicaoTotal: isCount(input.diasEmExibicaoTotal)
      ? input.diasEmExibicaoTotal
      : 0,
    totalExibicoesHistorico: isCount(input.totalExibicoesHistorico)
      ? input.totalExibicoesHistorico
      : 0,
    totalExibicoesPeriodo: isCount(input.insercoesPeriodo)
      ? input.insercoesPeriodo
      : isCount(input.totalExibicoesPeriodo)
        ? input.totalExibicoesPeriodo
        : 0,
    mediaDiariaPeriodo: isCount(input.metaDiaria)
      ? input.metaDiaria
      : isCount(input.mediaDiariaPeriodo)
        ? input.mediaDiariaPeriodo
        : 0,
    frequenciaGeral:
      typeof input.frequenciaLoop === "string" && input.frequenciaLoop.trim()
        ? input.frequenciaLoop
        : typeof input.frequenciaGeral === "string" && input.frequenciaGeral.trim()
          ? input.frequenciaGeral
        : "Não informado",
    telasAtivas: isCount(input.telasAtivas)
      ? input.telasAtivas
      : undefined,
    desempenhoPorTela,
    resumoRelatorio:
      typeof input.resumoRelatorio === "string" ? input.resumoRelatorio : "",
    evidencias: {
      clienteNome: input.evidencias?.clienteNome || "",
      campanhaNome: input.evidencias?.campanhaNome || "",
      token: input.evidencias?.token || "",
      periodo: input.evidencias?.periodo || "",
      diasEmExibicaoTotal: input.evidencias?.diasEmExibicaoTotal || "",
      totalExibicoesHistorico: input.evidencias?.totalExibicoesHistorico || "",
      frequenciaGeral: input.evidencias?.frequenciaGeral || "",
    },
    locais: locaisComDesempenho
      .filter((local) => typeof local?.nome === "string" && local.nome.trim())
      .map((local) => ({
        ...local,
        endereco: typeof local.endereco === "string" ? local.endereco : "",
        horarioFuncionamento:
          typeof local.horarioFuncionamento === "string"
            ? local.horarioFuncionamento
            : "",
        frequenciaLocal:
          typeof local.frequenciaLocal === "string" ? local.frequenciaLocal : "",
        evidenciaEndereco:
          typeof local.evidenciaEndereco === "string" ? local.evidenciaEndereco : "",
        evidenciaHorarioFuncionamento:
          typeof local.evidenciaHorarioFuncionamento === "string"
            ? local.evidenciaHorarioFuncionamento
            : "",
        evidenciaFrequenciaLocal:
          typeof local.evidenciaFrequenciaLocal === "string"
            ? local.evidenciaFrequenciaLocal
            : "",
        telas: (Array.isArray(local.telas) ? local.telas : [])
          .filter((screen) => typeof screen?.nome === "string" && screen.nome.trim())
          .map((screen) => ({
            ...screen,
            metaDiariaEsperada: isCount(screen.metaDiariaEsperada)
              ? screen.metaDiariaEsperada
              : null,
            status: ["online", "offline", "desconhecido"].includes(screen.status)
              ? screen.status
              : "desconhecido",
            evidenciaMetaDiaria:
              typeof screen.evidenciaMetaDiaria === "string"
                ? screen.evidenciaMetaDiaria
                : "",
            evidenciaStatus:
              typeof screen.evidenciaStatus === "string" ? screen.evidenciaStatus : "",
          })),
      })),
    historicoDiario: (Array.isArray(input.historicoDiario) ? input.historicoDiario : [])
      .filter((day) => isIsoDate(day?.dia))
      .map((day) => ({
        ...day,
        insercoes: isCount(day.insercoes) ? day.insercoes : 0,
        status: ["normal", "alerta", "zerado", "desconhecido"].includes(day.status)
          ? day.status
          : "desconhecido",
        telas: (Array.isArray(day.telas) ? day.telas : [])
          .filter(
            (screen) =>
              typeof screen?.localNome === "string" &&
              screen.localNome.trim() &&
              typeof screen.telaNome === "string" &&
              screen.telaNome.trim() &&
              isCount(screen.insercoes)
          )
          .map((screen) => ({
            ...screen,
            pagina: Number.isSafeInteger(screen.pagina) && screen.pagina >= 1
              ? screen.pagina
              : 1,
            evidencia: typeof screen.evidencia === "string" ? screen.evidencia : "",
            evidenciaStatus:
              typeof screen.evidenciaStatus === "string"
                ? screen.evidenciaStatus
                : "",
          })),
      })),
  } as RelatorioData;
  if (
    !report.clienteNome.trim() ||
    report.clienteNome.length > 120 ||
    report.campanhaNome.length > 120 ||
    report.token.length > 200 ||
    report.frequenciaGeral.length > 200 ||
    !report.resumoRelatorio?.trim() ||
    (report.resumoRelatorio?.length || 0) > 2000 ||
    report.periodo.length > 200 ||
    report.historicoDiario.length > 366
  ) {
    throw new Error("O Gemini precisa retornar um nome de cliente e resumo válidos.");
  }
  const screenTotals = new Map<string, number>();
  const screenKeys = new Set<string>();
  const localNames = new Set<string>();
  for (const local of report.locais) {
    if (
      typeof local.nome !== "string" ||
      !local.nome.trim() ||
      local.nome.length > 120 ||
      typeof local.horarioFuncionamento !== "string" ||
      typeof local.frequenciaLocal !== "string" ||
      (local.endereco !== undefined && typeof local.endereco !== "string") ||
      typeof local.evidenciaEndereco !== "string" ||
      typeof local.evidenciaHorarioFuncionamento !== "string" ||
      typeof local.evidenciaFrequenciaLocal !== "string" ||
      (local.endereco?.trim() &&
        (local.evidenciaEndereco.trim() &&
          !evidenceHasText(local.evidenciaEndereco, local.endereco))) ||
      (local.horarioFuncionamento.trim() &&
        local.evidenciaHorarioFuncionamento.trim() &&
        !evidenceHasText(local.evidenciaHorarioFuncionamento, local.horarioFuncionamento)) ||
      (local.frequenciaLocal.trim() &&
        local.evidenciaFrequenciaLocal.trim() &&
        !evidenceHasText(local.evidenciaFrequenciaLocal, local.frequenciaLocal)) ||
      !Array.isArray(local.telas) ||
      local.telas.length > 500
    ) {
      throw new Error("O relatório extraído precisa conter ao menos uma tela por local.");
    }
    const localKey = normalizeName(local.nome);
    if (localNames.has(localKey)) {
      throw new Error("O relatório contém nomes de locais duplicados.");
    }
    localNames.add(localKey);
    for (const tela of local.telas) {
      if (
        typeof tela.nome !== "string" ||
        !tela.nome.trim() ||
        tela.nome.length > 120 ||
        (tela.metaDiariaEsperada !== null && !isCount(tela.metaDiariaEsperada)) ||
        !["online", "offline", "desconhecido"].includes(tela.status) ||
        typeof tela.evidenciaMetaDiaria !== "string" ||
        (tela.metaDiariaEsperada !== null &&
          tela.evidenciaMetaDiaria.trim() &&
            !evidenceHasCount(tela.evidenciaMetaDiaria, tela.metaDiariaEsperada)) ||
        typeof tela.evidenciaStatus !== "string" ||
        (tela.status !== "desconhecido" &&
          tela.evidenciaStatus.trim() &&
          !evidenceHasText(tela.evidenciaStatus, tela.status))
      ) {
        throw new Error("O relatório contém uma tela sem nome ou meta diária válida.");
      }
      const key = `${normalizeName(local.nome)}::${normalizeName(tela.nome)}`;
      if (screenKeys.has(key)) {
        throw new Error("O relatório contém nomes de telas duplicados no mesmo local.");
      }
      screenKeys.add(key);
      screenTotals.set(key, 0);
    }
  }

  const dates = new Set<string>();
  const historicoDiario = report.historicoDiario.map((day) => {
    if (
      !isIsoDate(day.dia) ||
      dates.has(day.dia) ||
      !Array.isArray(day.telas) ||
      (day.telaAfetada !== undefined &&
        (typeof day.telaAfetada !== "string" || day.telaAfetada.length > 500))
    ) {
      throw new Error("O histórico extraído tem datas inválidas ou não contém dados por tela.");
    }
    dates.add(day.dia);
    const dailyScreenKeys = new Set<string>();
    let detailedInsertions = 0;
    const telas = day.telas
      .filter((dailyScreen) =>
        screenKeys.has(
          `${normalizeName(dailyScreen.localNome)}::${normalizeName(dailyScreen.telaNome)}`
        )
      )
      .map((dailyScreen) => {
      if (
        typeof dailyScreen.localNome !== "string" ||
        typeof dailyScreen.telaNome !== "string" ||
        dailyScreen.localNome.length > 120 ||
        dailyScreen.telaNome.length > 120 ||
        !Number.isSafeInteger(dailyScreen.pagina) ||
        dailyScreen.pagina < 1 ||
        typeof dailyScreen.evidencia !== "string" ||
        (dailyScreen.evidencia.trim() &&
          (!evidenceHasCount(dailyScreen.evidencia, dailyScreen.insercoes) ||
            !evidenceHasDate(dailyScreen.evidencia, day.dia) ||
            !evidenceHasText(dailyScreen.evidencia, dailyScreen.localNome) ||
            !evidenceHasText(dailyScreen.evidencia, dailyScreen.telaNome))) ||
        (dailyScreen.status !== undefined &&
          !["normal", "alerta", "zerado", "desconhecido"].includes(dailyScreen.status)) ||
        (dailyScreen.status === "zerado" && dailyScreen.insercoes !== 0) ||
        (dailyScreen.status !== undefined &&
          dailyScreen.status !== "desconhecido" &&
          dailyScreen.status !== "zerado" &&
          dailyScreen.evidenciaStatus?.trim() &&
          !evidenceHasText(dailyScreen.evidenciaStatus, dailyScreen.status)) ||
        (dailyScreen.observacaoFalha !== undefined &&
          (typeof dailyScreen.observacaoFalha !== "string" ||
            dailyScreen.observacaoFalha.length > 500))
      ) {
        throw new Error(`Dados diários inválidos em ${day.dia}.`);
      }
      const key = `${normalizeName(dailyScreen.localNome)}::${normalizeName(dailyScreen.telaNome)}`;
      if (
        !screenKeys.has(key) ||
        dailyScreenKeys.has(key) ||
        !isCount(dailyScreen.insercoes)
      ) {
        throw new Error(`Dados diários inválidos ou duplicados em ${day.dia}.`);
      }
      dailyScreenKeys.add(key);
      detailedInsertions += dailyScreen.insercoes;
      if (!Number.isSafeInteger(detailedInsertions)) {
        throw new Error(`O total de inserções excede o limite válido em ${day.dia}.`);
      }
      const screenTotal = (screenTotals.get(key) || 0) + dailyScreen.insercoes;
      if (!Number.isSafeInteger(screenTotal)) {
        throw new Error(`O total acumulado da tela excede o limite válido: ${dailyScreen.telaNome}.`);
      }
      screenTotals.set(key, screenTotal);
      return {
        ...dailyScreen,
        status:
          dailyScreen.insercoes === 0
            ? "zerado"
            : dailyScreen.status || "desconhecido",
      };
      });
    return {
      ...day,
      insercoes: isCount(day.insercoes) ? day.insercoes : detailedInsertions,
      status:
        (isCount(day.insercoes) ? day.insercoes : detailedInsertions) === 0
          ? "zerado" as const
          : telas.some((screen) => screen.status === "alerta")
            ? "alerta" as const
            : telas.every((screen) => screen.status === "normal")
              ? "normal" as const
              : "desconhecido" as const,
      telas,
    };
  });

  for (const item of desempenhoPorTela) {
    screenTotals.set(
      `${normalizeName(item.localNome)}::${normalizeName(item.telaNome)}`,
      item.insercoes
    );
  }

  const locais = report.locais.map((local) => ({
    ...local,
    telas: local.telas.map((tela) => ({
      ...tela,
      exibicoes:
        screenTotals.get(`${normalizeName(local.nome)}::${normalizeName(tela.nome)}`) || 0,
    })),
    totalExibicoes: local.telas.reduce(
      (total, tela) =>
        total +
        (screenTotals.get(`${normalizeName(local.nome)}::${normalizeName(tela.nome)}`) || 0),
      0
    ),
  }));
  const historicoTotal = historicoDiario.reduce((total, day) => total + day.insercoes, 0);
  const totalExibicoesPeriodo =
    (isCount(input.insercoesPeriodo) && input.insercoesPeriodo > 0) ||
    historicoTotal === 0
      ? input.insercoesPeriodo || 0
      : historicoTotal;
  if (!Number.isSafeInteger(totalExibicoesPeriodo)) {
    throw new Error("O total de inserções do período excede o limite válido.");
  }
  const explicitDailyTarget =
    isCount(input.metaDiaria) && input.metaDiaria > 0
      ? input.metaDiaria
      : undefined;
  const periodDays = getPeriodDayCount(report.periodo, historicoDiario.length);
  const metaDiaria =
    explicitDailyTarget ??
    (periodDays > 0 ? Math.round(totalExibicoesPeriodo / periodDays) : 0);

  return {
    ...report,
    clienteNome: report.clienteNome.trim(),
    campanhaNome: report.campanhaNome.trim(),
    totalExibicoesPeriodo,
    mediaDiariaPeriodo: metaDiaria,
    insercoesPeriodo: totalExibicoesPeriodo,
    metaDiaria,
    frequenciaLoop: report.frequenciaGeral,
    telasAtivas: isCount(report.telasAtivas)
      ? report.telasAtivas
      : locais.reduce((total, local) => total + local.telas.length, 0),
    desempenhoPorTela: desempenhoPorTela.length
      ? desempenhoPorTela
      : locais.flatMap((local) =>
          local.telas.map((screen) => ({
            localNome: local.nome,
            telaNome: screen.nome,
            insercoes: screen.exibicoes,
          }))
        ),
    locais,
    historicoDiario,
  };
}

export function persistExtractedReport(
  report: RelatorioData,
  selectedCampaignId: string,
  summary?: string,
  pdfUploadId?: string
): {
  db: WhiteVisionDb;
  campaign: CampanhaCliente;
} {
  const db = readDb();
  const normalizedToken = report.token.trim();
  const campaign = db.campanhas.find((item) => item.id === selectedCampaignId);
  if (!campaign) throw new Error("Selecione um cliente existente para salvar o relatório.");
  const pdfUploadIndex = pdfUploadId
    ? db.relatoriosPdf.findIndex(
        (upload) => upload.id === pdfUploadId && upload.campanhaId === selectedCampaignId
      )
    : -1;
  if (pdfUploadId && pdfUploadIndex === -1) {
    throw new Error("O PDF enviado não foi encontrado no histórico do cliente.");
  }
  const campaignId = campaign.id;
  const reportFrequency =
    report.frequenciaGeral.trim() &&
    report.frequenciaGeral.trim().toLowerCase() !== "não informado"
      ? report.frequenciaGeral
      : campaign.frequenciaGeral;
  const extractedMetrics = {
    insercoesPeriodo:
      report.totalExibicoesPeriodo > 0
        ? report.totalExibicoesPeriodo
        : campaign.metricasDashboard?.insercoesPeriodo ?? 0,
    metaDiaria:
      report.mediaDiariaPeriodo > 0
        ? report.mediaDiariaPeriodo
        : campaign.metricasDashboard?.metaDiaria ?? 0,
    telasAtivas:
      report.telasAtivas !== undefined
        ? report.telasAtivas
        : campaign.metricasDashboard?.telasAtivas ?? 0,
    desempenhoPorTela:
      report.desempenhoPorTela?.length
        ? report.desempenhoPorTela
        : campaign.metricasDashboard?.desempenhoPorTela ?? [],
    historicoDiario:
      report.historicoDiario.some((day) => day.insercoes > 0 || day.telas?.length)
        ? report.historicoDiario.map((day) => ({
            data: day.dia,
            insercoes: day.insercoes,
            status: day.status,
          }))
        : campaign.metricasDashboard?.historicoDiario ?? [],
  };
  const campaignData: CampanhaCliente = {
    id: campaignId,
    slug: campaign.slug,
    clienteNome: report.clienteNome,
    campanhaNome: report.campanhaNome,
    token: normalizedToken || campaign.token,
    diasAcumulados: report.diasEmExibicaoTotal,
    totalExibicoesAcumuladas: report.totalExibicoesHistorico,
    status: campaign.status,
    periodo: report.periodo,
    mesAno: report.mesAno,
    frequenciaGeral: reportFrequency,
    resumoRelatorio: summary?.trim() || report.resumoRelatorio?.trim() ||
      `No período ${report.periodo}, foram registradas ${report.totalExibicoesPeriodo.toLocaleString("pt-BR")} inserções, ` +
      `com média diária de ${report.mediaDiariaPeriodo.toLocaleString("pt-BR")}. ` +
      `O histórico acumulado é de ${report.totalExibicoesHistorico.toLocaleString("pt-BR")} inserções em ` +
      `${report.diasEmExibicaoTotal.toLocaleString("pt-BR")} dias.`,
    clientTheme: campaign.clientTheme,
    metricasDashboard: extractedMetrics,
  };
  if (campaign) {
    db.campanhas = db.campanhas.map((item) =>
      item.id === campaignId ? campaignData : item
    );
  } else {
    db.campanhas.push(campaignData);
  }

  const oldPoints = db.pontos.filter((point) => point.campanhaId === campaignId);
  const oldPointIds = new Set(oldPoints.map((point) => point.id));
  const oldScreens = db.telas.filter((screen) => oldPointIds.has(screen.pontoId));
  const oldScreenIds = new Set(oldScreens.map((screen) => screen.id));
  const pointByName = new Map(oldPoints.map((point) => [normalizeName(point.nome), point]));
  const screenByPointAndName = new Map(
    oldScreens.map((screen) => [
      `${screen.pontoId}::${normalizeName(screen.nome)}`,
      screen,
    ])
  );
  const points: PontoTela[] = [];
  const screens: TelaPonto[] = [];
  const screenIdByName = new Map<string, string>();

  for (const local of report.locais) {
    const previousPoint = pointByName.get(normalizeName(local.nome));
    const pointId = previousPoint?.id || randomUUID();
    points.push({
      id: pointId,
      campanhaId: campaignId,
      nome: local.nome,
      endereco: local.endereco || "",
      horarioFuncionamento: local.horarioFuncionamento,
      frequenciaLocal: local.frequenciaLocal,
    });
    for (const extractedScreen of local.telas) {
      const compositeName = `${normalizeName(local.nome)}::${normalizeName(extractedScreen.nome)}`;
      const previousScreen = screenByPointAndName.get(
        `${pointId}::${normalizeName(extractedScreen.nome)}`
      );
      const screenId = previousScreen?.id || randomUUID();
      screenIdByName.set(compositeName, screenId);
      screens.push({
        id: screenId,
        pontoId: pointId,
        nome: extractedScreen.nome,
        metaDiaria: extractedScreen.metaDiariaEsperada,
        status: extractedScreen.status,
      });
    }
  }

  const relatoriosById = new Map(
    db.relatoriosDiarios
      .filter((item) => !oldScreenIds.has(item.telaId))
      .map((item) => [item.id, item])
  );
  for (const day of report.historicoDiario) {
    for (const dailyScreen of day.telas || []) {
      const compositeName = `${normalizeName(dailyScreen.localNome)}::${normalizeName(dailyScreen.telaNome)}`;
      const telaId = screenIdByName.get(compositeName);
      if (!telaId) throw new Error("Não foi possível associar uma tela do relatório ao cliente.");
      const screen = screens.find((item) => item.id === telaId);
      if (!screen) throw new Error("Tela do relatório não encontrada.");
      const failureMentionsScreen =
        Boolean(day.telaAfetada) &&
        normalizeName(day.telaAfetada || "").includes(normalizeName(screen.nome));
      const observation =
        dailyScreen.observacaoFalha || (failureMentionsScreen ? day.telaAfetada : "") || "";
      const failed =
        dailyScreen.status === "alerta" ||
        dailyScreen.insercoes === 0 ||
        day.status === "zerado" ||
        failureMentionsScreen;
      const id = `rel-${telaId}-${day.dia}`;
      relatoriosById.set(id, {
        id,
        data: day.dia,
        telaId,
        exibicoesEntregues: dailyScreen.insercoes,
        metaDiaria: screen.metaDiaria,
        falhaNominal: failed,
        statusRelatorio: dailyScreen.status,
        observacaoFalha: observation,
      });
    }
  }

  if (report.locais.length > 0) {
    db.pontos = [...db.pontos.filter((point) => point.campanhaId !== campaignId), ...points];
    db.telas = [...db.telas.filter((screen) => !oldPointIds.has(screen.pontoId)), ...screens];
  }
  if (report.historicoDiario.some((day) => day.telas?.length)) {
    db.relatoriosDiarios = [...relatoriosById.values()].sort(
      (a, b) => a.data.localeCompare(b.data) || a.telaId.localeCompare(b.telaId)
    );
  }
  if (pdfUploadIndex !== -1) {
    db.relatoriosPdf[pdfUploadIndex] = {
      ...db.relatoriosPdf[pdfUploadIndex],
      status: "perfil_salvo",
      relatorio: report,
      erro: undefined,
    };
  }
  writeDb(db);
  return { db, campaign: campaignData };
}
