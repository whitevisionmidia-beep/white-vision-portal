export type StatusCampanha = "ativa" | "pausada" | "encerrada";
export type StatusTela = "online" | "offline" | "desconhecido";

export interface CampanhaCliente {
  id: string;
  slug: string;
  clienteNome: string;
  campanhaNome: string;
  token: string;
  diasAcumulados: number;
  totalExibicoesAcumuladas: number;
  status: StatusCampanha;
  periodo: string;
  mesAno?: string;
  frequenciaGeral: string;
  resumoRelatorio?: string;
  clientTheme?: ClientTheme;
  metricasDashboard?: {
    insercoesPeriodo?: number;
    metaDiaria?: number;
    telasAtivas?: number;
    desempenhoPorTela?: DesempenhoPorTelaItem[];
    locais?: Array<{
      nome: string;
      horarioFuncionamento: string;
      links: Array<{ rotulo: string; url: string }>;
    }>;
    historicoDiario?: HistoricoDiarioSnapshotItem[];
  };
}

export interface PontoTela {
  id: string;
  campanhaId: string;
  nome: string;
  endereco?: string;
  horarioFuncionamento: string;
  frequenciaLocal: string;
}

export interface TelaPonto {
  id: string;
  pontoId: string;
  nome: string;
  metaDiaria: number | null;
  status: StatusTela;
}

export interface RelatorioDiarioTela {
  id: string;
  data: string; // YYYY-MM-DD
  telaId: string;
  exibicoesEntregues: number;
  metaDiaria: number | null;
  falhaNominal: boolean;
  statusRelatorio?: "normal" | "alerta" | "zerado" | "desconhecido";
  observacaoFalha?: string;
}

export interface VideoPortal {
  id: string;
  campanhaId: string;
  titulo: string;
  descricao: string;
  arquivoId: string;
  nomeArquivo: string;
  mimeType: "video/mp4" | "image/png" | "image/jpeg";
  tamanhoBytes: number;
}

export interface PdfReportUpload {
  id: string;
  campanhaId: string;
  nomeArquivo: string;
  criadoEm: string;
  status: "analisando" | "analisado" | "salvo" | "perfil_salvo" | "falhou";
  relatorio?: RelatorioData;
  resumoIA?: string;
  erro?: string;
}

export interface WhiteVisionDb {
  campanhas: CampanhaCliente[];
  pontos: PontoTela[];
  telas: TelaPonto[];
  relatoriosDiarios: RelatorioDiarioTela[];
  videos: VideoPortal[];
  relatoriosPdf: PdfReportUpload[];
}

export interface AdminEstado {
  db: WhiteVisionDb;
}
import type {
  DesempenhoPorTelaItem,
  HistoricoDiarioSnapshotItem,
  ClientTheme,
  RelatorioData,
} from "./whiteVision";
