import { RelatorioData } from "../types/whiteVision.ts";

export const MOCK_RELATORIO_FACHO: RelatorioData = {
  token: "WV-2026-FR4393",
  clienteNome: "Facho Restaurante",
  campanhaNome: "Campanha Institucional",
  periodo: "Últimos 30 dias (21/09/2026 a 20/10/2026)",
  mesAno: "Outubro/2026",

  // 1. MÉTRICAS DO TOPO (HISTÓRICO ACUMULADO VS RELATÓRIO)
  diasEmExibicaoTotal: 64, // "64 dias em exibição" (acumulado histórico)
  totalExibicoesHistorico: 4393, // "4.393 exibições" (acumulado histórico total)
  totalExibicoesPeriodo: 2136, // Total no período do relatório dos últimos 30 dias


  // 2. LISTA DE PONTOS E TELAS INDIVIDUAIS (COM META DIÁRIA ESPERADA POR TELA)
  locais: [
    {
      id: "local-01",
      nome: "Facho Restaurante",
      horarioFuncionamento: "11:00 às 23:00 - 12h/dia",
      totalExibicoes: 2136,
      telas: [
        {
          id: "tela-01",
          nome: "Tela 1",
          exibicoes: 1108,
          metaDiariaEsperada: 38,
          status: "online",
        },
        {
          id: "tela-02",
          nome: "Tela 2",
          exibicoes: 1028,
          metaDiariaEsperada: 38,
          status: "online",
          statusOscilacao:
            "Tela 2 do Facho Restaurante apresentou oscilação/queda no dia 14/10",
        },
      ],
    },
  ],

  // 3. DADOS BRUTOS REAIS COM AUDITORIA NOMINAL QUANDO HOUVER QUEDA
  historicoDiario: [
    { dia: "21/09", insercoes: 76, status: "normal" },
    { dia: "22/09", insercoes: 78, status: "normal" },
    { dia: "23/09", insercoes: 80, status: "normal" },
    { dia: "24/09", insercoes: 74, status: "normal" },
    { dia: "25/09", insercoes: 82, status: "normal" },
    { dia: "26/09", insercoes: 85, status: "normal" },
    {
      dia: "27/09",
      insercoes: 0,
      status: "zerado",
      telaAfetada: "Telas 1 e 2 do Facho Restaurante sem transmissão no dia 27/09",
    },
    { dia: "28/09", insercoes: 71, status: "normal" },
    { dia: "29/09", insercoes: 75, status: "normal" },
    { dia: "30/09", insercoes: 79, status: "normal" },
    { dia: "01/10", insercoes: 73, status: "normal" },
    { dia: "02/10", insercoes: 81, status: "normal" },
    { dia: "03/10", insercoes: 84, status: "normal" },
    {
      dia: "04/10",
      insercoes: 0,
      status: "zerado",
      telaAfetada: "Telas 1 e 2 do Facho Restaurante sem transmissão no dia 04/10",
    },
    { dia: "05/10", insercoes: 70, status: "normal" },
    { dia: "06/10", insercoes: 77, status: "normal" },
    { dia: "07/10", insercoes: 75, status: "normal" },
    { dia: "08/10", insercoes: 76, status: "normal" },
    { dia: "09/10", insercoes: 83, status: "normal" },
    { dia: "10/10", insercoes: 86, status: "normal" },
    {
      dia: "11/10",
      insercoes: 0,
      status: "zerado",
      telaAfetada: "Telas 1 e 2 do Facho Restaurante sem transmissão no dia 11/10",
    },
    {
      dia: "12/10",
      insercoes: 42,
      status: "alerta",
      telaAfetada: "Tela 1 e Tela 2 do Facho Restaurante operaram abaixo da meta no dia 12/10",
    },
    { dia: "13/10", insercoes: 74, status: "normal" },
    {
      dia: "14/10",
      insercoes: 68,
      status: "alerta",
      telaAfetada: "Tela 2 do Facho Restaurante apresentou oscilação/queda no dia 14/10",
    },
    { dia: "15/10", insercoes: 79, status: "normal" },
    { dia: "16/10", insercoes: 82, status: "normal" },
    { dia: "17/10", insercoes: 85, status: "normal" },
    {
      dia: "18/10",
      insercoes: 0,
      status: "zerado",
      telaAfetada: "Telas 1 e 2 do Facho Restaurante sem transmissão no dia 18/10",
    },
    { dia: "19/10", insercoes: 76, status: "normal" },
    { dia: "20/10", insercoes: 70, status: "normal" },
  ],
};
