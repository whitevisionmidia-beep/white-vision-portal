"use client";

import React, { useState } from "react";
import {
  Target,
  Calendar,
  RotateCw,
  Tv,
  Clock,
  MapPin,
  MessageCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  History,
  Info,
  BarChart3,
  MonitorCheck,
  AlertCircle,
  Lightbulb,
} from "lucide-react";
import {
  DEFAULT_CLIENT_THEME,
  RelatorioData,
  LocalPontoItem,
  SubTelaItem,
  HistoricoDiarioItem,
} from "../types/whiteVision";

export interface WhiteVisionClientPortalProps {
  data: RelatorioData;
  whatsappNumber?: string;
}

export function WhiteVisionClientPortal({
  data,
  whatsappNumber = "5511999999999",
}: WhiteVisionClientPortalProps) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [activeTooltipDay, setActiveTooltipDay] = useState<HistoricoDiarioItem | null>(null);
  const [frameLogoFailed, setFrameLogoFailed] = useState(false);
  const [headerLogoFailed, setHeaderLogoFailed] = useState(false);
  const clientTheme = { ...DEFAULT_CLIENT_THEME, ...data.clientTheme };

  // Accordion de locais: aberto por padrão para visualização imediata
  const [expandedLocais, setExpandedLocais] = useState<Record<string, boolean>>({
    [data.locais?.[0]?.id || "local-01"]: true,
  });

  const toggleLocalAccordion = (localId: string) => {
    setExpandedLocais((prev) => ({
      ...prev,
      [localId]: !prev[localId],
    }));
  };

  // Ação WhatsApp de Renovação
  const handleRenovarCampanha = (comNovoMaterial?: boolean) => {
    const extra = comNovoMaterial
      ? `\n*Observação:* Gostaria de renovar a campanha e enviar um novo anúncio/vídeo para atualização!`
      : ``;

    const tokenText = data.token ? `\n*Token:* ${data.token}` : "";
    const mensagemTexto = `Olá White Vision! Gostaria de renovar a veiculação da campanha:\n\n*Cliente:* ${data.clienteNome}\n*Campanha:* ${data.campanhaNome}\n*Período Auditado:* ${data.periodo}\n*Inserções no Período:* ${data.totalExibicoesPeriodo.toLocaleString("pt-BR")}\n*Total Histórico Acumulado:* ${data.totalExibicoesHistorico.toLocaleString("pt-BR")} exibições (${data.diasEmExibicaoTotal} dias)${tokenText}${extra}\n\nPor favor, me envie as condições para renovação do próximo período!`;
    const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(mensagemTexto)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Contagem de telas totais
  const totalTelasNaRede = data.telasAtivas ?? data.locais.reduce(
    (acc, local) => acc + (local.telas ? local.telas.length : 0),
    0
  );

  // Cálculo para o gráfico
  const maxInsercoes = Math.max(
    ...data.historicoDiario.map((d) => d.insercoes),
    data.mediaDiariaPeriodo * 1.15 || 80
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-emerald-500/30 selection:text-emerald-200 pb-28 sm:pb-24">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full bg-slate-900/95 border border-emerald-500/40 text-emerald-300 text-xs sm:text-sm font-medium shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-3">
          <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Glow de Fundo Sutil */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[550px] h-[280px] bg-emerald-500/10 blur-[140px] rounded-full" />
        <div className="absolute top-1/2 -right-32 w-[350px] h-[350px] bg-sky-500/10 blur-[150px] rounded-full" />
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10">
        {/* ================================================================= */}
        {/* HEADER: Minimalista com Badge "🟢 Relatório de Veiculação Auditada"*/}
        {/* ================================================================= */}
        <header className="mb-8 rounded-3xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl shadow-black/20 backdrop-blur-sm sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-800/80">
            {/* Logo da White Vision via tag <img> */}
            <div className="flex items-center gap-3">
              <img
                src={
                  headerLogoFailed || !clientTheme.logoUrl
                    ? DEFAULT_CLIENT_THEME.logoUrl
                    : clientTheme.logoUrl
                }
                onError={() => setHeaderLogoFailed(true)}
                alt={data.clienteNome}
                translate="no"
                className="h-10 sm:h-12 w-auto object-contain drop-shadow-md"
              />
            </div>

            {/* Badge: 🟢 Relatório de Veiculação Auditada */}
            <div className="inline-flex items-center gap-2 self-start sm:self-auto px-3.5 py-1.5 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs sm:text-sm font-semibold shadow-inner shadow-emerald-950">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
              </span>
              <span>🟢 Relatório de Veiculação Auditada</span>
            </div>
          </div>

          {/* Destaque do Cliente e Período */}
          <div className="mt-5 p-4 sm:p-5 rounded-2xl bg-black/30 border border-slate-800/80 relative overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <span translate="no" className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 block mb-1">
                  Portal do Cliente • White Vision
                </span>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {data.clienteNome}
                </h1>
                <p className="text-sm text-sky-400 font-medium mt-0.5">
                  {data.campanhaNome}
                </p>
              </div>

              <div className="flex items-center gap-2 bg-slate-950/70 px-3.5 py-2 rounded-xl border border-slate-800/80 self-start sm:self-auto text-xs sm:text-sm">
                <Calendar className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="text-slate-400">Período:</span>
                <strong className="text-slate-200">{data.periodo}</strong>
              </div>
            </div>
          </div>
        </header>

        {data.resumoRelatorio && (
          <section className="mb-8 rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-4 sm:p-5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-300">
              Resumo do relatório
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-200" aria-live="polite">
              {data.resumoRelatorio}
            </p>
          </section>
        )}

        {/* ================================================================= */}
        {/* 1. MÉTRICAS DO TOPO: HISTÓRICO ACUMULADO VS RELATÓRIO DO PERÍODO  */}
        {/* ================================================================= */}
        <section className="mb-10">
          {/* Card Comparativo: Histórico Total do Pacote */}
          <div className="mb-4 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-900/80 border border-slate-800 backdrop-blur-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                    Histórico Geral Acumulado da Campanha
                  </span>
                  <div className="text-sm sm:text-base font-extrabold text-white mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sky-300">
                      {data.diasEmExibicaoTotal} dias em exibição
                    </span>
                    <span className="text-slate-600">•</span>
                    <span className="text-emerald-400">
                      {data.totalExibicoesHistorico.toLocaleString("pt-BR")} exibições
                    </span>
                  </div>
                </div>
              </div>

              {/* Legenda de Clareza */}
              <div className="self-start sm:self-center shrink-0">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950 text-slate-300 text-xs font-medium border border-slate-800">
                  <Info className="w-3.5 h-3.5 text-sky-400" />
                  <span>Relatório detalhado do período dos últimos 30 dias</span>
                </span>
              </div>
            </div>
          </div>

          {/* 4 Cards de Métricas do Período dos Últimos 30 Dias */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Card 1: Total do Período */}
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                  Inserções no Período
                </span>
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Target className="w-4 h-4" />
                </div>
              </div>
              <div className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {data.totalExibicoesPeriodo.toLocaleString("pt-BR")}
              </div>
              <p className="text-[11px] text-emerald-400 font-medium mt-1">
                exibições (últimos 30 dias)
              </p>
            </div>

            {/* Card 2: Média Diária no Período */}
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                  Média Diária
                </span>
                <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                  <Calendar className="w-4 h-4" />
                </div>
              </div>
              <div className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {typeof data.metaDiaria === "number" && data.metaDiaria > 0
                  ? `${data.metaDiaria.toLocaleString("pt-BR")} inserções/dia`
                  : "Não informado"}
              </div>
              <p className="text-[11px] text-sky-400 font-medium mt-1">
                meta diária do relatório
              </p>
            </div>

            {/* Card 3: Frequência Média por Loop */}
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                  Frequência Loop
                </span>
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <RotateCw className="w-4 h-4" />
                </div>
              </div>
              <div className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
                {data.frequenciaLoop?.trim() ||
                  data.frequenciaGeral?.trim() ||
                  "Não informado"}
              </div>
              <p className="text-[11px] text-slate-400 font-medium mt-1">
                intervalo contínuo
              </p>
            </div>

            {/* Card 4: Telas Ativas */}
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                  Telas Ativas
                </span>
                <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                  <Tv className="w-4 h-4" />
                </div>
              </div>
              <div className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {totalTelasNaRede} Telas
              </div>
              <p className="text-[11px] text-emerald-400 font-medium mt-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>em {data.locais.length} {data.locais.length === 1 ? "Local" : "Locais"}</span>
              </p>
            </div>
          </div>
        </section>

        {data.conteudos && data.conteudos.length > 0 && (
          <section className="mb-10">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-white tracking-tight">
                Vídeo em Exibição nas Telas
              </h2>
              <p className="text-sm text-slate-400">
                Este é o conteúdo que está sendo exibido na nossa rede no momento.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {data.conteudos.map((conteudo) => (
                <article
                  key={conteudo.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-3"
                >
                  <div
                    className="mx-auto w-full max-w-[320px] shrink-0 rounded-[2rem] p-3 shadow-xl"
                    style={{ backgroundColor: clientTheme.frameColor }}
                  >
                    <div className="flex min-h-14 w-full min-w-0 items-center justify-center whitespace-pre-line break-words px-3 pb-3 text-center text-sm font-black tracking-wide text-white">
                      {clientTheme.topBannerText}
                    </div>
                    {conteudo.mimeType === "video/mp4" ? (
                      <video
                        src={conteudo.src}
                        controls
                        preload="metadata"
                        className="block aspect-[9/16] w-full rounded-2xl bg-black object-contain"
                      />
                    ) : (
                      <img
                        src={conteudo.src}
                        alt={conteudo.titulo}
                        className="block aspect-[9/16] w-full rounded-2xl bg-black object-contain"
                      />
                    )}
                    <div
                      className="flex h-16 max-h-16 w-full min-w-0 items-center justify-center overflow-hidden rounded-xl px-3"
                      style={{ backgroundColor: clientTheme.logoBgColor }}
                    >
                      <img
                        src={
                          frameLogoFailed || !clientTheme.logoUrl
                            ? DEFAULT_CLIENT_THEME.logoUrl
                            : clientTheme.logoUrl
                        }
                        alt={`Logo ${data.clienteNome}`}
                        onError={() => setFrameLogoFailed(true)}
                        style={{
                          height: `${Math.min(Math.max(clientTheme.logoSize, 20), 64)}px`,
                          maxHeight: "100%",
                          maxWidth: "100%",
                        }}
                        className="h-auto w-auto max-w-full object-contain"
                      />
                    </div>
                  </div>
                  {conteudo.titulo && (
                    <h3 className="text-center font-semibold text-white">{conteudo.titulo}</h3>
                  )}
                  {conteudo.descricao && (
                    <p className="text-center text-sm text-slate-400 whitespace-pre-wrap">
                      {conteudo.descricao}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
        {(!data.conteudos || data.conteudos.length === 0) && (
          <section className="mb-10 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <h2 className="text-lg font-bold text-white">Seus arquivos</h2>
            <p className="mt-1 text-sm text-slate-400">
              Ainda não há arquivos de mídia associados a este cliente.
            </p>
          </section>
        )}

        {/* ================================================================= */}
        {/* 2. DADOS E NOMES REAIS DOS PONTOS: META DIÁRIA & AUDITORIA NOMINAL*/}
        {/* ================================================================= */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Tv className="w-5 h-5 text-emerald-400" />
              <h2 className="text-lg font-bold text-white tracking-tight">
                Desempenho por Local e Telas
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              Clique para expandir as telas individuais
            </span>
          </div>

          <div className="space-y-4">
            {data.locais.map((local: LocalPontoItem) => {
              const isExpanded = Boolean(expandedLocais[local.id]);

              return (
                <div
                  key={local.id}
                  className="rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-sm overflow-hidden transition-all shadow-md"
                >
                  {/* Cabeçalho do Local: Nome Real do Ponto (ex: Facho Restaurante — Total: 2.136 exibições) */}
                  <button
                    type="button"
                    onClick={() => toggleLocalAccordion(local.id)}
                    className="w-full p-5 text-left flex items-start sm:items-center justify-between gap-4 hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="flex items-start sm:items-center gap-3">
                      <div className="p-2 rounded-xl bg-slate-800 text-sky-400 border border-slate-700/60 shrink-0 mt-0.5 sm:mt-0">
                        <MapPin className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-white text-base sm:text-lg">
                            {local.nome}
                          </h3>
                          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
                            Total: {local.totalExibicoes.toLocaleString("pt-BR")} exibições
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-1">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-500" />
                            {local.horarioFuncionamento}
                          </span>
                          <span className="text-slate-600">•</span>
                          <span>{local.telas.length} telas</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-center">
                      <span className="hidden sm:inline text-xs text-slate-400 font-medium">
                        {isExpanded ? "Ocultar Telas" : "Ver Telas"}
                      </span>
                      <div className="p-1.5 rounded-lg bg-slate-800 text-slate-300">
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Conteúdo Expandido: Meta Diária e Auditoria Nominal por Tela */}
                  {isExpanded && (
                    <div className="px-5 pb-5 pt-2 border-t border-slate-800/80 bg-slate-950/50">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {local.telas.map((tela: SubTelaItem) => {
                          const percentualLocal = Math.round(
                            (tela.exibicoes / local.totalExibicoes) * 100
                          );
                          const isOnline = tela.status === "online";
                          const isOffline = tela.status === "offline";

                          return (
                            <div
                              key={tela.id}
                              className={`p-4 rounded-xl border transition-all ${
                                isOnline
                                  ? "bg-slate-900/90 border-slate-800 hover:border-slate-700"
                                  : isOffline
                                    ? "bg-amber-950/20 border-amber-500/40"
                                    : "bg-slate-900/70 border-slate-700"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="flex items-center gap-2">
                                  <MonitorCheck
                                    className={`w-4 h-4 ${
                                      isOnline
                                        ? "text-emerald-400"
                                        : isOffline
                                        ? "text-amber-400"
                                        : "text-slate-400"
                                    }`}
                                  />
                                  <h4 className="font-bold text-white text-sm">
                                    {tela.nome}
                                  </h4>
                                </div>

                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                    isOnline
                                      ? "bg-emerald-950/80 border-emerald-500/40 text-emerald-300"
                                      : isOffline
                                        ? "bg-amber-950/80 border-amber-500/40 text-amber-300"
                                        : "bg-slate-800 border-slate-600 text-slate-300"
                                  }`}
                                >
                                  {isOnline ? "🟢 Online" : isOffline ? "⚠️ Offline" : "Status não informado"}
                                </span>
                              </div>

                              {/* Total e Percentual */}
                              <div className="mt-2 flex items-baseline justify-between">
                                <span className="text-xl font-black text-white">
                                  {tela.exibicoes.toLocaleString("pt-BR")}{" "}
                                  <span className="text-xs font-normal text-slate-400">
                                    exibições
                                  </span>
                                </span>
                                <span className="text-xs font-mono font-semibold text-sky-400">
                                  {percentualLocal}% do local
                                </span>
                              </div>
                              <p className="mt-1 text-xs font-medium text-sky-300">
                                ~{(tela.mediaDiaria ?? 0).toLocaleString("pt-BR")} exibições/dia nesta tela
                              </p>

                              {/* 1. Meta Diária Esperada por Tela */}
                              <div className="mt-2 text-xs text-slate-400 flex items-center justify-between border-t border-slate-800/80 pt-2">
                                <span>Meta diária esperada:</span>
                                <strong className="text-slate-200 font-mono">
                                  {tela.metaDiariaEsperada === null
                                    ? "Não informado no relatório"
                                    : `~${tela.metaDiariaEsperada} exibições/dia`}
                                </strong>
                              </div>

                              {/* Barra de Progresso Relativo */}
                              <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    isOnline ? "bg-emerald-400" : "bg-amber-400"
                                  }`}
                                  style={{ width: `${percentualLocal}%` }}
                                />
                              </div>

                              {/* Auditoria Nominal Explícita da Tela Afetada */}
                              {tela.statusOscilacao && (
                                <div className="mt-3 p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-1.5 leading-snug">
                                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                                  <span>{tela.statusOscilacao}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ================================================================= */}
        {/* 3. GRÁFICO DIÁRIO & NOTA DE TRANSPARÊNCIA PADRÃO                  */}
        {/* ================================================================= */}
        <section className="mb-10">
          <div className="p-5 sm:p-6 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-sky-400" />
                  <h3 className="text-base font-bold text-white tracking-tight">
                    Histórico Diário de Inserções (Dados Brutos)
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Volume diário registrado no período auditado
                </p>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
                  <span>Veiculação ativa</span>
                </span>
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-sm bg-slate-700 border border-slate-600" />
                  <span>Sem transmissão (0)</span>
                </span>
              </div>
            </div>

            {/* Barras do Gráfico Diário com Suporte Factual a Dias Zerados */}
            <div className="overflow-x-auto overflow-y-visible pb-2 pt-12 scrollbar-thin scrollbar-thumb-slate-800">
              <div className="min-w-[960px] h-[380px] flex items-end gap-1.5 sm:gap-2 px-1 pt-6 border-b border-slate-800 relative">
                {/* Linha Guia da Média */}
                <div
                  className="absolute left-0 right-0 border-b border-dashed border-sky-500/40 pointer-events-none z-0"
                  style={{
                    bottom: `${Math.min(
                      Math.max((data.mediaDiariaPeriodo / maxInsercoes) * 100, 15),
                      85
                    )}%`,
                  }}
                >
                  <span className="absolute -top-4 right-2 text-[9px] font-mono text-sky-400 bg-slate-950/90 px-1.5 py-0.5 rounded border border-sky-900/60">
                    Média: ~{data.mediaDiariaPeriodo} inserções/dia
                  </span>
                </div>

                {data.historicoDiario.map((item, index) => {
                  const isZero = item.insercoes === 0;
                  const isAbaixoMeta = item.status === "alerta" || isZero;
                  const percentage = isZero
                    ? 4
                    : Math.min(Math.round((item.insercoes / maxInsercoes) * 100), 100);
                  const isSelected = activeTooltipDay?.dia === item.dia;

                  return (
                    <div
                      key={item.dia + index}
                      onMouseEnter={() => setActiveTooltipDay(item)}
                      onMouseLeave={() => setActiveTooltipDay(null)}
                      onClick={() =>
                        setActiveTooltipDay((prev) =>
                          prev?.dia === item.dia ? null : item
                        )
                      }
                      className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer relative"
                    >
                      {/* Tooltip Factual sem justificativas fictícias */}
                      <div
                        className={`absolute -top-10 z-[50] px-2 py-1 rounded bg-slate-950 text-emerald-300 text-[11px] font-mono border border-slate-700 shadow-xl pointer-events-none transition-all duration-150 whitespace-nowrap ${
                          isSelected || "group-hover:opacity-100 group-hover:scale-100"
                        } ${
                          isSelected
                            ? "opacity-100 scale-100"
                            : "opacity-0 scale-95"
                        } ${isZero ? "border-slate-600 text-slate-400" : isAbaixoMeta ? "border-amber-500 text-amber-300" : "border-emerald-500/60"}`}
                      >
                        {item.dia}: {item.insercoes}{" "}
                        {isZero ? "exibições" : "inserções"}
                      </div>

                      {/* Barra de Progresso Real */}
                      <div className="w-full flex items-end justify-center h-full">
                        <div
                          style={{ height: `${percentage}%` }}
                          className={`w-full max-w-[12px] rounded-t-sm transition-all duration-300 ${
                            isZero
                              ? "bg-slate-700/80 hover:bg-slate-600 border border-slate-600/50"
                              : isAbaixoMeta
                              ? "bg-amber-400 hover:bg-amber-300 shadow-sm shadow-amber-500/30"
                              : "bg-emerald-400 hover:bg-emerald-300 shadow-sm shadow-emerald-500/20"
                          }`}
                        />
                      </div>

                      {/* Dia */}
                      <span
                        className={`text-[9px] font-mono mt-2 transition-colors ${
                          isZero
                            ? "text-slate-600 group-hover:text-slate-400 font-bold"
                            : "text-slate-500 group-hover:text-slate-200"
                        }`}
                      >
                        {item.dia}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Detalhe factual e auditoria nominal do dia selecionado */}
            {activeTooltipDay && (
              <div className="mt-3 p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">
                    Data: <strong className="text-white">{activeTooltipDay.dia}</strong>
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    {activeTooltipDay.insercoes} inserções registradas
                  </span>
                </div>

                {/* Apontamento explícito e nominal da tela afetada */}
                {activeTooltipDay.telaAfetada && (
                  <div className="pt-1.5 border-t border-slate-800 text-[11px] text-amber-300 flex items-center gap-1.5 font-medium">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>{activeTooltipDay.telaAfetada}</span>
                  </div>
                )}
              </div>
            )}

            {/* NOTA PADRÃO DE TRANSPARÊNCIA (EXATAMENTE COMO REQUISITADO) */}
            <div className="mt-4 p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 text-xs text-slate-300 leading-relaxed flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                ⚠️ Nota: Dias com volume de exibições reduzido ou zerado refletem ocorrências operacionais reais do ponto (como oscilações de energia, religamento da tela ou manutenções locais), garantindo transparência total na auditoria.
              </span>
            </div>
          </div>
        </section>

        {/* ================================================================= */}
        {/* 2. DICA DE CONTEÚDO (LOGO ACIMA DO BOTÃO DE RENOVAÇÃO)            */}
        {/* ================================================================= */}
        <section className="mb-8">
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-slate-900/95 to-slate-900/80 border border-slate-800/90 shadow-lg relative overflow-hidden group">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0 mt-0.5">
                  <Lightbulb className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-medium">
                    <strong className="text-amber-300 font-semibold">
                      💡 Dica White Vision:
                    </strong>{" "}
                    Atualizar a arte ou o vídeo do seu anúncio a cada renovação aumenta a retenção de atenção do público nos pontos de exibição. Aproveite para renovar e enviar seu novo material!
                  </p>
                </div>
              </div>

              <button
                onClick={() => handleRenovarCampanha(true)}
                type="button"
                className="self-start sm:self-center shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 border border-slate-700/80 text-xs font-semibold transition-all active:scale-95"
              >
                <span>Renovar com Novo Material</span>
              </button>
            </div>
          </div>
        </section>

        {/* Rodapé Institucional */}
        <div className="py-6 border-t border-slate-900 text-center text-xs text-slate-500">
          <p className="font-semibold text-slate-400">
            Grupo White Vision • Mídia Indoor & Tecnologia
          </p>
          <p className="text-[11px] text-slate-600 mt-1">
            {data.token && `Token de Autenticação: ${data.token}`}
          </p>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 4. RODAPÉ DE AÇÕES (FOCO TOTAL EM RENOVAR CAMPANHA NO WHATSAPP)    */}
      {/* ================================================================= */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/80 px-4 py-3 shadow-2xl">
        <div className="max-w-3xl mx-auto flex items-center justify-center">
          {/* Botão de conversão direta via WhatsApp */}
          <button
            onClick={() => handleRenovarCampanha()}
            type="button"
            style={{ backgroundColor: clientTheme.primaryColor }}
            className="w-full sm:w-auto sm:min-w-[340px] inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl text-white font-bold text-sm shadow-lg transition-all transform hover:brightness-110 active:scale-95"
          >
            <MessageCircle className="w-5 h-5 shrink-0" />
            <span>Renovar Campanha</span>
          </button>
        </div>
      </footer>
    </div>
  );
}

export default WhiteVisionClientPortal;
