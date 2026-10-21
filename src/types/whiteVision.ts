export interface SubTelaItem {
  id: string;
  nome: string; // Ex: "Tela 1", "Tela 2"
  exibicoes: number; // Ex: 1108
  mediaDiaria?: number;
  metaDiariaEsperada: number | null;
  status: "online" | "offline" | "desconhecido";
  evidenciaMetaDiaria?: string;
  evidenciaStatus?: string;
  statusOscilacao?: string; // Ex: "Tela 2 do Facho Restaurante apresentou oscilação/queda no dia 14/10"
}

export interface LocalPontoItem {
  id: string;
  nome: string; // Ex: "Facho Restaurante"
  endereco?: string;
  horarioFuncionamento: string; // Ex: "11:00 às 23:00 - 12h/dia"
  totalExibicoes: number; // Ex: 2136
  frequenciaLocal: string; // Ex: "1x a cada 3.5 min"
  telas: SubTelaItem[];
  evidenciaEndereco?: string;
  evidenciaHorarioFuncionamento?: string;
  evidenciaFrequenciaLocal?: string;
}

export interface HistoricoDiarioItem {
  dia: string;
  insercoes: number;
  status: "normal" | "alerta" | "zerado" | "desconhecido";
  telaAfetada?: string; // Ex: "Tela 2 do Facho Restaurante apresentou oscilação/queda no dia 14/10"
  telas?: Array<{
    localNome: string;
    telaNome: string;
    insercoes: number;
    pagina: number;
    evidencia: string;
    status?: "normal" | "alerta" | "zerado" | "desconhecido";
    evidenciaStatus?: string;
    observacaoFalha?: string;
  }>;
}

export interface DesempenhoPorTelaItem {
  localNome: string;
  telaNome: string;
  insercoes: number;
}

export interface HistoricoDiarioSnapshotItem {
  data: string;
  insercoes: number;
  status: "normal" | "alerta" | "zerado" | "desconhecido";
}

export interface ClientTheme {
  frameColor: string;
  topBannerText: string;
  logoUrl: string;
  primaryColor: string;
  logoSize: number;
  logoBgColor: string;
}

export const DEFAULT_CLIENT_THEME: ClientTheme = {
  frameColor: "#111827",
  topBannerText: "ANUNCIE AQUI (41) 98833-2166",
  logoUrl: "/white-vision-logo.png",
  primaryColor: "#10b981",
  logoSize: 36,
  logoBgColor: "#111827",
};

export interface ConteudoPortal {
  id: string;
  titulo: string;
  descricao: string;
  src: string;
  nomeArquivo: string;
  mimeType: "video/mp4" | "image/png" | "image/jpeg";
}

export interface RelatorioData {
  clientTheme?: ClientTheme;
  token: string;
  clienteNome: string; // Ex: "Facho Restaurante"
  campanhaNome: string; // Ex: "Campanha Institucional"
  periodo: string; // Ex: "Últimos 30 dias (21/09/2026 a 20/10/2026)"
  mesAno?: string; // Ex: "Outubro/2026"
  // Histórico Acumulado vs Relatório
  diasEmExibicaoTotal: number; // Ex: 64 ("64 dias em exibição")
  totalExibicoesHistorico: number; // Ex: 4393 ("4.393 exibições")
  totalExibicoesPeriodo: number; // Ex: 2136 (Período dos últimos 30 dias)
  mediaDiariaPeriodo: number; // Ex: 71
  frequenciaGeral: string; // Ex: "A cada ~3 min"
  telasAtivas?: number;
  desempenhoPorTela?: DesempenhoPorTelaItem[];
  insercoesPeriodo?: number;
  metaDiaria?: number;
  frequenciaLoop?: string;
  resumoRelatorio?: string;
  locais: LocalPontoItem[];
  historicoDiario: HistoricoDiarioItem[];
  evidencias?: {
    clienteNome: string;
    campanhaNome: string;
    token: string;
    periodo: string;
    diasEmExibicaoTotal: string;
    totalExibicoesHistorico: string;
    frequenciaGeral: string;
  };
  conteudos?: ConteudoPortal[];
}
