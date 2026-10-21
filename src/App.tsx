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
    <>
      {refreshError && (
        <div role="alert" className="bg-amber-950 px-4 py-2 text-center text-sm text-amber-200">
          Não foi possível atualizar o relatório agora: {refreshError}
        </div>
      )}
      <WhiteVisionClientPortal data={data} whatsappNumber="5511999999999" />
    </>
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
      <div className="border-b border-slate-800 bg-slate-900 px-4 py-2 flex justify-end">
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
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-lg text-center space-y-4">
        <p className="text-xs uppercase tracking-wider text-emerald-400 font-bold">White Vision</p>
        <h1 className="text-3xl font-extrabold text-white">Portal do cliente</h1>
        <p className="text-slate-300">
          Acesse o link individual enviado pela White Vision para visualizar os conteúdos e
          relatórios da sua campanha.
        </p>
      </div>
    </main>
  );
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin") return <AdminApplication />;

  const clientMatch = path.match(/^\/cliente\/([^/]+)$/);
  if (clientMatch) {
    try {
      return <ClientPortalFromDb slug={decodeURIComponent(clientMatch[1])} />;
    } catch {
      return <PublicLanding />;
    }
  }

  return <PublicLanding />;
}
