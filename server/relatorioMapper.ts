import type { WhiteVisionDb } from "../src/types/adminDb.ts";
import type {
  HistoricoDiarioItem,
  LocalPontoItem,
  RelatorioData,
  SubTelaItem,
} from "../src/types/whiteVision.ts";
import { DEFAULT_CLIENT_THEME } from "../src/types/whiteVision.ts";
function formatDia(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildRelatorioData(
  db: WhiteVisionDb,
  campanhaId?: string
): RelatorioData {
  const campanha =
    db.campanhas.find((item) => item.id === campanhaId) || db.campanhas[0];

  if (!campanha) {
    throw new Error("Nenhuma campanha cadastrada no banco local.");
  }

  const conteudos = db.videos
    .filter((video) => video.campanhaId === campanha.id)
    .map(({ id, titulo, descricao, arquivoId, nomeArquivo, mimeType }) => ({
      id,
      titulo,
      descricao,
      nomeArquivo,
      mimeType,
      src: `/api/public/clientes/${encodeURIComponent(campanha.slug)}/midias/${encodeURIComponent(arquivoId)}`,
    }));
  const pontos = db.pontos.filter((ponto) => ponto.campanhaId === campanha.id);
  const pontoIds = new Set(pontos.map((ponto) => ponto.id));
  const telas = db.telas.filter((tela) => pontoIds.has(tela.pontoId));
  const telaIds = new Set(telas.map((tela) => tela.id));
  const relatorios = db.relatoriosDiarios
    .filter((item) => telaIds.has(item.telaId))
    .sort((a, b) => a.data.localeCompare(b.data) || a.telaId.localeCompare(b.telaId));

  const exibicoesPorTela = new Map<string, number>();
  for (const relatorio of relatorios) {
    exibicoesPorTela.set(
      relatorio.telaId,
      (exibicoesPorTela.get(relatorio.telaId) || 0) + relatorio.exibicoesEntregues
    );
  }
  const desempenhoPorTela = new Map(
    (campanha.metricasDashboard?.desempenhoPorTela || []).map((item) => [
      `${normalizeName(item.localNome)}::${normalizeName(item.telaNome)}`,
      item.insercoes,
    ])
  );
  const dashboardDates = campanha.metricasDashboard?.historicoDiario?.map(
    (item) => item.data
  );
  const periodoDias = new Set(
    dashboardDates?.length ? dashboardDates : relatorios.map((item) => item.data)
  ).size;

  const locais: LocalPontoItem[] = pontos.map((ponto) => {
    const telasDoPonto = telas.filter((tela) => tela.pontoId === ponto.id);
    const telasMapeadas: SubTelaItem[] = telasDoPonto.map((tela) => {
      const falhasDaTela = relatorios.filter(
        (item) =>
          item.telaId === tela.id &&
          item.falhaNominal &&
          item.observacaoFalha &&
          item.observacaoFalha.toLowerCase().includes(tela.nome.toLowerCase())
      );
      const falhaEspecifica = [...falhasDaTela].reverse().find((item) => {
        const doMesmoDia = relatorios.filter(
          (other) => other.data === item.data && other.observacaoFalha === item.observacaoFalha
        );
        return doMesmoDia.length === 1;
      });

      return {
        id: tela.id,
        nome: tela.nome,
        exibicoes:
          desempenhoPorTela.get(
            `${normalizeName(ponto.nome)}::${normalizeName(tela.nome)}`
          ) ?? exibicoesPorTela.get(tela.id) ?? 0,
        mediaDiaria: periodoDias
          ? Math.round(
              (desempenhoPorTela.get(
                `${normalizeName(ponto.nome)}::${normalizeName(tela.nome)}`
              ) ?? exibicoesPorTela.get(tela.id) ?? 0) / periodoDias
            )
          : 0,
        metaDiariaEsperada: tela.metaDiaria,
        status: tela.status,
        statusOscilacao: falhaEspecifica?.observacaoFalha,
      };
    });

    return {
      id: ponto.id,
      nome: ponto.nome,
      endereco: ponto.endereco,
      horarioFuncionamento: ponto.horarioFuncionamento,
      totalExibicoes: telasMapeadas.reduce((acc, tela) => acc + tela.exibicoes, 0),
      frequenciaLocal: ponto.frequenciaLocal,
      telas: telasMapeadas,
    };
  });

  const datas = [...new Set(relatorios.map((item) => item.data))].sort();
  const historicoDiarioCalculado: HistoricoDiarioItem[] = datas.map((data) => {
    const doDia = relatorios.filter((item) => item.data === data);
    const insercoes = doDia.reduce((acc, item) => acc + item.exibicoesEntregues, 0);
    const falhas = doDia.filter((item) => item.falhaNominal);

    const statuses = doDia.map((item) => item.statusRelatorio);
    let status: HistoricoDiarioItem["status"] = "normal";
    if (insercoes === 0) status = "zerado";
    else if (statuses.some((item) => item === "alerta") || falhas.length > 0) status = "alerta";
    else if (statuses.some((item) => item === "desconhecido")) status = "desconhecido";

    const telaAfetada = falhas.find((item) => item.observacaoFalha)?.observacaoFalha;

    return {
      dia: formatDia(data),
      insercoes,
      status,
      telaAfetada,
    };
  });

  const snapshotHistory = campanha.metricasDashboard?.historicoDiario;
  const historicoDiario: HistoricoDiarioItem[] = snapshotHistory
    ? snapshotHistory.map((item) => ({
        dia: formatDia(item.data),
        insercoes: item.insercoes,
        status: item.status,
      }))
    : historicoDiarioCalculado;
  const totalExibicoesPeriodo = historicoDiario.reduce(
    (acc, item) => acc + item.insercoes,
    0
  );
  const mediaDiariaPeriodo = campanha.metricasDashboard?.metaDiaria ??
    (
    historicoDiario.length > 0
      ? Math.round(totalExibicoesPeriodo / historicoDiario.length)
      : 0
    );
  const insercoesPeriodo =
    campanha.metricasDashboard?.insercoesPeriodo ?? totalExibicoesPeriodo;
  const telasAtivas =
    campanha.metricasDashboard?.telasAtivas ??
    locais.reduce((total, local) => total + local.telas.length, 0);
  const desempenhoPorTelaMapeado =
    campanha.metricasDashboard?.desempenhoPorTela ||
    locais.flatMap((local) =>
      local.telas.map((tela) => ({
        localNome: local.nome,
        telaNome: tela.nome,
        insercoes: tela.exibicoes,
      }))
    );

  return {
    token: campanha.token,
    clienteNome: campanha.clienteNome,
    campanhaNome: campanha.campanhaNome,
    periodo: campanha.periodo,
    mesAno: campanha.mesAno,
    diasEmExibicaoTotal: campanha.diasAcumulados,
    totalExibicoesHistorico: campanha.totalExibicoesAcumuladas,
    totalExibicoesPeriodo: insercoesPeriodo,
    insercoesPeriodo,
    mediaDiariaPeriodo,
    metaDiaria: mediaDiariaPeriodo,
    frequenciaGeral: campanha.frequenciaGeral,
    frequenciaLoop: campanha.frequenciaGeral,
    clientTheme: { ...DEFAULT_CLIENT_THEME, ...campanha.clientTheme },
    resumoRelatorio: campanha.resumoRelatorio,
    telasAtivas,
    desempenhoPorTela: desempenhoPorTelaMapeado,
    locais,
    historicoDiario,
    conteudos,
  };
}
