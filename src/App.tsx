import React, { useEffect, useState } from "react";
import { WhiteVisionClientPortal } from "./components/WhiteVisionClientPortal";
import {
  fetchAuthSession,
  fetchPublicClientReport,
  login as authenticate,
  logout,
} from "./lib/adminApi";
import { AdminPage } from "./pages/AdminPage";
import type { RelatorioData } from "./types/whiteVision";

function LoginPage({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4"
      >
        <div>
          <p className="text-xs uppercase tracking-wider text-emerald-400 font-bold">White Vision</p>
          <h1 className="text-2xl font-extrabold text-white mt-1">Acesso ao portal</h1>
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-300">
            {error}
          </p>
        )}
        <label className="block text-sm space-y-1">
          <span className="text-slate-300">Usuário</span>
          <input
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
          />
        </label>
        <label className="block text-sm space-y-1">
          <span className="text-slate-300">Senha</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2.5 disabled:opacity-60"
        >
          {submitting ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}

function ClientPortalFromDb({ slug }: { slug: string }) {
  const [data, setData] = useState<RelatorioData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let hasLoaded = false;
    let requestInFlight = false;
    const refresh = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const { report } = await fetchPublicClientReport(slug);
        if (!active) return;
        setData(report);
        setError(null);
        setRefreshError(null);
        hasLoaded = true;
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : String(err);
        if (hasLoaded) setRefreshError(message);
        else setError(message);
      } finally {
        requestInFlight = false;
      }
    };
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 5000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
    };
  }, [slug]);

  if (error && !data) {
    return (
      <div className="min-h-screen bg-slate-950 text-rose-300 flex items-center justify-center p-6">
        Este link de cliente é inválido ou está indisponível: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center">
        Carregando relatório do cliente...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 pt-4 text-xs text-slate-400 sm:px-6">
        <a href="/" className="rounded-lg border border-slate-800 px-3 py-2 hover:border-slate-600 hover:text-white">
          Página inicial
        </a>
        <span>Portal exclusivo do cliente</span>
      </nav>
      {refreshError && (
        <div role="alert" className="bg-amber-950 px-4 py-2 text-center text-sm text-amber-200">
          Não foi possível atualizar o relatório agora: {refreshError}
        </div>
      )}
      <WhiteVisionClientPortal data={data} whatsappNumber="5511999999999" />
    </div>
  );
}

function AdminApplication() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    fetchAuthSession()
      .then(({ authenticated: isAuthenticated }) => setAuthenticated(isAuthenticated))
      .catch((err: unknown) => setSessionError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCheckingSession(false));
  }, []);

  const handleLogin = async (username: string, password: string) => {
    await authenticate(username, password);
    setSessionError(null);
    setAuthenticated(true);
  };

  const handleLogout = async () => {
    try {
      await logout();
      setAuthenticated(false);
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center">
        Verificando sessão...
      </div>
    );
  }

  if (!authenticated) {
    return sessionError ? (
      <div role="alert" className="min-h-screen bg-slate-950 text-rose-300 flex items-center justify-center p-6">
        Não foi possível validar a sessão: {sessionError}
      </div>
    ) : (
      <LoginPage onLogin={handleLogin} />
    );
  }

  return (
    <>
      <div className="border-b border-slate-800 bg-slate-900 px-4 py-2 flex items-center justify-between">
        <a href="/" className="text-sm text-slate-300 hover:text-white">
          Página inicial
        </a>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="text-sm text-slate-300 hover:text-white"
        >
          Encerrar sessão
        </button>
      </div>
      {sessionError && (
        <div role="alert" className="bg-rose-950/70 px-4 py-2 text-center text-sm text-rose-300">
          {sessionError}
        </div>
      )}
      <AdminPage />
    </>
  );
}

function PublicLanding() {
  const [clientLink, setClientLink] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleClientAccess = (event: React.FormEvent) => {
    event.preventDefault();
    const value = clientLink.trim();
    const match = value.match(/^(?:https?:\/\/[^/]+)?\/?cliente\/([^/?#]+)\/?$/i);
    const candidate = match?.[1] || value;

    let slug: string;
    try {
      slug = decodeURIComponent(candidate);
    } catch {
      setError("O link informado não é válido. Confira o endereço enviado pela White Vision.");
      return;
    }

    if (!/^[a-z0-9-]+$/i.test(slug)) {
      setError("Informe o link exclusivo ou o código de acesso recebido para o portal.");
      return;
    }

    window.location.assign(`/cliente/${encodeURIComponent(slug)}`);
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-12 flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/90 px-5 py-4 shadow-xl shadow-black/20 sm:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">White Vision</p>
            <p className="mt-1 text-sm text-slate-400">Mídia indoor • Portal digital</p>
          </div>
          <a
            href="/admin"
            className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-emerald-500/60 hover:text-white"
          >
            Acesso administrativo
          </a>
        </header>

        <section className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
            Bem-vindo
          </p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
            Portal White Vision
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
            Acesse a gestão administrativa ou consulte o painel personalizado da sua campanha.
          </p>
        </section>

        <section className="mx-auto mt-10 grid max-w-4xl gap-5 md:grid-cols-2">
          <article className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg">
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-lg font-bold text-emerald-300">
              WV
            </div>
            <h2 className="text-xl font-bold text-white">Painel administrativo</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">
              Gerencie clientes, campanhas, conteúdos, relatórios e personalização White Label.
              O acesso exige autenticação.
            </p>
            <a
              href="/admin"
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-emerald-500 px-4 py-3 font-bold text-slate-950 transition hover:bg-emerald-400"
            >
              Entrar no painel
            </a>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg">
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10 text-lg font-bold text-sky-300">
              ↗
            </div>
            <h2 className="text-xl font-bold text-white">Portal do cliente</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Use o link exclusivo ou o código de acesso enviado pela White Vision para abrir
              somente os dados e conteúdos da sua campanha.
            </p>
            <form onSubmit={handleClientAccess} className="mt-5 space-y-3">
              <label htmlFor="client-link" className="block text-sm font-medium text-slate-300">
                Link exclusivo ou código do cliente
              </label>
              <input
                id="client-link"
                value={clientLink}
                onChange={(event) => {
                  setClientLink(event.target.value);
                  setError(null);
                }}
                placeholder="https://site.com/cliente/seu-codigo"
                autoComplete="url"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-sky-500"
              />
              {error && (
                <p role="alert" className="text-sm text-rose-300">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={!clientLink.trim()}
                className="w-full rounded-xl border border-sky-400/40 bg-sky-500/10 px-4 py-3 font-bold text-sky-200 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Acessar meu portal
              </button>
            </form>
          </article>
        </section>

        <footer className="mt-10 text-center text-xs text-slate-600">
          Cada portal de cliente é acessado por um link exclusivo.
        </footer>
      </div>
    </main>
  );
}

function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
      <section className="max-w-md text-center">
        <p className="text-sm font-bold uppercase tracking-widest text-emerald-400">White Vision</p>
        <h1 className="mt-3 text-2xl font-extrabold text-white">Página não encontrada</h1>
        <p className="mt-2 text-slate-400">Confira o link ou volte à página inicial para acessar seu portal.</p>
        <a href="/" className="mt-6 inline-flex rounded-xl bg-emerald-500 px-5 py-3 font-bold text-slate-950 hover:bg-emerald-400">
          Ir para a página inicial
        </a>
      </section>
    </main>
  );
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return <PublicLanding />;
  if (path === "/admin") return <AdminApplication />;

  const clientMatch = path.match(/^\/cliente\/([^/]+)$/);
  if (clientMatch) {
    try {
      return <ClientPortalFromDb slug={decodeURIComponent(clientMatch[1])} />;
    } catch {
      return <NotFoundPage />;
    }
  }

  return <NotFoundPage />;
}
