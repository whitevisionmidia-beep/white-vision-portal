/**
 * Testes das funções críticas do fluxo de importação.
 * Executar com: `node tests/fluxo-importacao.test.cjs`
 *
 * O arquivo `src/lib/supabaseAdminApi.ts` é transpilado com o compilador oficial
 * do TypeScript (já presente no projeto) e as funções puras são exercitadas
 * isoladamente, sem tocar no banco nem na IA.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cwd = path.join(os.homedir(), "OneDrive", "Área de Trabalho", "portal cliente wv");
const srcPath = path.join(cwd, "src", "lib", "supabaseAdminApi.ts");
const src = fs.readFileSync(srcPath, "utf8");

const ts = require(path.join(cwd, "node_modules", "esbuild"));

/**
 * Transpila o módulo e devolve as funções puras exportadas.
 * Dependências externas (supabase) são substituídas por stubs.
 */
function carregarModulo() {
  const transpiled = ts.transformSync(src, {
    loader: "ts",
    format: "cjs",
    target: "es2020",
  }).code;

  const module = { exports: {} };
  const requireStub = (id) => {
    if (id === "./supabase") {
      return {
        getSupabase: () => {
          throw new Error("Supabase não deve ser acessado nos testes unitários.");
        },
        getPublicMediaUrl: (p) => p,
      };
    }
    if (id.includes("types/whiteVision")) {
      return { DEFAULT_CLIENT_THEME: {} };
    }
    return {};
  };
  const fn = new Function("exports", "require", "module", "__filename", "__dirname", transpiled);
  fn(module.exports, requireStub, module, srcPath, path.dirname(srcPath));
  return module.exports;
}

const api = carregarModulo();
const { normalizeDateKey, calcularSerieDiaria, screenStatusFrom, reportStatusFrom } = api;

let passou = 0;
let falhou = 0;
function teste(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  ok    ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU ${nome}\n        ${error.message}`);
    process.exitCode = 1;
  }
}

console.log("\n[1] Normalização de datas (DD/MM/AAAA e AAAA-MM-DD)");
teste("converte DD/MM/AAAA para YYYY-MM-DD", () => {
  assert.equal(normalizeDateKey("03/08/2026"), "2026-08-03");
});
teste("mantém YYYY-MM-DD", () => {
  assert.equal(normalizeDateKey("2026-08-03"), "2026-08-03");
});
teste("descarta horário de YYYY-MM-DDTHH:mm", () => {
  assert.equal(normalizeDateKey("2026-08-03T10:00:00Z"), "2026-08-03");
});
teste("retorna vazio para data inválida (não inventa zero)", () => {
  assert.equal(normalizeDateKey("sem data"), "");
  assert.equal(normalizeDateKey(""), "");
  assert.equal(normalizeDateKey(undefined), "");
});
teste("converte DD-MM-AAAA", () => {
  assert.equal(normalizeDateKey("03-08-2026"), "2026-08-03");
});

console.log("\n[2] Série diária: dias com zero, ausentes e sem duplicação");
teste("preserva dia com zero inserções declarado no relatório", () => {
  const serie = calcularSerieDiaria(
    [],
    [
      { data: "2026-08-01", insercoes: 0, status: "zerado" },
      { data: "2026-08-02", insercoes: 70, status: "normal" },
    ],
    2
  );
  assert.equal(serie.length, 2);
  assert.equal(serie[0].data, "2026-08-01");
  assert.equal(serie[0].insercoes, 0);
  assert.equal(serie[0].status, "zerado");
  assert.equal(serie[0].temRegistro, true);
});
teste("não inventa datas que não constam em nenhuma fonte", () => {
  const serie = calcularSerieDiaria(
    [{ id: "r1", data: "2026-08-02", telaId: "s1", exibicoesEntregues: 30, metaDiaria: 40, falhaNominal: false }],
    [{ data: "2026-08-02", insercoes: 30, status: "normal" }],
    1
  );
  assert.equal(serie.length, 1);
  assert.equal(serie[0].data, "2026-08-02");
});
teste("soma as telas do dia quando o detalhe é completo", () => {
  const serie = calcularSerieDiaria(
    [
      { id: "r1", data: "2026-08-02", telaId: "s1", exibicoesEntregues: 30, metaDiaria: 40, falhaNominal: false },
      { id: "r2", data: "2026-08-02", telaId: "s2", exibicoesEntregues: 40, metaDiaria: 40, falhaNominal: false },
    ],
    [{ data: "2026-08-02", insercoes: 70, status: "normal" }],
    2
  );
  assert.equal(serie[0].insercoes, 70);
});
teste("mantém o total do relatório quando o detalhe é parcial", () => {
  const serie = calcularSerieDiaria(
    [{ id: "r1", data: "2026-08-02", telaId: "s1", exibicoesEntregues: 10, metaDiaria: 40, falhaNominal: false }],
    [{ data: "2026-08-02", insercoes: 70, status: "normal" }],
    2
  );
  assert.equal(serie[0].insercoes, 70);
});
teste("marca falha quando alguma tela do dia falhou", () => {
  const serie = calcularSerieDiaria(
    [{ id: "r1", data: "2026-08-02", telaId: "s1", exibicoesEntregues: 0, metaDiaria: 40, falhaNominal: true }],
    [],
    1
  );
  assert.equal(serie[0].status, "alerta");
});
teste("ordena a série por data", () => {
  const serie = calcularSerieDiaria(
    [],
    [
      { data: "2026-08-05", insercoes: 10, status: "normal" },
      { data: "2026-08-01", insercoes: 20, status: "normal" },
    ],
    1
  );
  assert.deepEqual(serie.map((d) => d.data), ["2026-08-01", "2026-08-05"]);
});

console.log("\n[3] Normalização de status aceitos pelos checks do banco");
teste("status de tela aceita apenas online/offline/desconhecido", () => {
  assert.equal(screenStatusFrom("online"), "online");
  assert.equal(screenStatusFrom("offline"), "offline");
  assert.equal(screenStatusFrom("desconhecido"), "desconhecido");
  // Statuses do relatório diário NÃO são válidos em `screens.status`.
  assert.equal(screenStatusFrom("normal"), "desconhecido");
  assert.equal(screenStatusFrom("alerta"), "desconhecido");
  assert.equal(screenStatusFrom("zerado"), "desconhecido");
  assert.equal(screenStatusFrom(undefined), "desconhecido");
});
teste("status de relatório aceita apenas normal/alerta/zerado/desconhecido", () => {
  assert.equal(reportStatusFrom("normal"), "normal");
  assert.equal(reportStatusFrom("alerta"), "alerta");
  assert.equal(reportStatusFrom("zerado"), "zerado");
  assert.equal(reportStatusFrom("desconhecido"), "desconhecido");
  assert.equal(reportStatusFrom("online"), "desconhecido");
  assert.equal(reportStatusFrom(null), "desconhecido");
});
teste("falha nominal só é marcada para alerta/zerado", () => {
  assert.equal(reportStatusFrom("alerta") === "alerta" || reportStatusFrom("alerta") === "zerado", true);
  assert.equal(reportStatusFrom("normal") === "alerta" || reportStatusFrom("normal") === "zerado", false);
  assert.equal(reportStatusFrom("desconhecido") === "alerta" || reportStatusFrom("desconhecido") === "zerado", false);
});

console.log("\n[4] Consistência entre o gráfico de um cliente e o multi-cliente");
teste("mesma série para o mesmo cliente (mesma função, mesmo resultado)", () => {
  const registros = [
    { id: "r1", data: "2026-08-02", telaId: "s1", exibicoesEntregues: 30, metaDiaria: 40, falhaNominal: false },
    { id: "r2", data: "2026-08-02", telaId: "s2", exibicoesEntregues: 40, metaDiaria: 40, falhaNominal: false },
  ];
  const historico = [{ data: "2026-08-02", insercoes: 70, status: "normal" }];
  const serieCliente = calcularSerieDiaria(registros, historico, 2);
  const serieMulti = calcularSerieDiaria(registros, historico, 2);
  assert.deepEqual(serieCliente, serieMulti);
  assert.equal(serieCliente[0].insercoes, 70);
});
teste("dia com zero explícito no histórico não some da série", () => {
  const serie = calcularSerieDiaria(
    [],
    [{ data: "2026-08-01", insercoes: 0, status: "zerado" }],
    1
  );
  assert.equal(serie.length, 1);
  assert.equal(serie[0].insercoes, 0);
  assert.equal(serie[0].temRegistro, true);
  assert.equal(serie[0].completa, false);
});

console.log(`\n${passou} passaram, ${falhou} falharam.`);

