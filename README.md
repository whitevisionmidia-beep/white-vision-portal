<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Portal White Vision

Portal de clientes e painel administrativo White Vision, com API local em Vite e persistência no arquivo `data/whitevision-db.json`. A página inicial (`/`) apresenta opções para entrar no painel administrativo (`/admin`) ou acessar um portal de cliente pelo link/código exclusivo (`/cliente/{slug}`). O painel exige autenticação; cada portal público retorna somente os dados da campanha correspondente. O arquivo `vercel.json` direciona as rotas do frontend para a SPA.

O banco local `data/whitevision-db.json` é ignorado pelo Git para impedir que dados de clientes e relatórios sejam publicados. Em um clone novo, o servidor cria um banco vazio na primeira inicialização.

## Execução local

**Prerequisites:** Node.js 20 or newer

1. Instale as dependências com `npm install`.
2. Copie `.env.example` para `.env` e defina `ADMIN_USERNAME`, `ADMIN_PASSWORD` e `SESSION_SECRET` (mínimo de 32 caracteres).
3. Configure `GEMINI_API_KEY` no mesmo `.env` para importar relatórios PDF e usar o assistente. A chave é usada somente no servidor; também pode ser substituída temporariamente no painel administrativo (a substituição dura até o servidor reiniciar). Use **Testar conexão com Gemini** no painel para verificar a chave com uma solicitação mínima, sem enviar conteúdo de cliente. O processamento usa `gemini-3.5-flash` e tenta `gemini-3.5-flash-lite` em indisponibilidade temporária. PDFs até 10 MB são processados no backend; as citações geradas pelo Gemini são comparadas com o texto extraído localmente e PDFs escaneados sem texto selecionável são recusados.
4. Inicie com `npm run dev`. Admin: `/admin` (login obrigatório); clientes: link dedicado `/cliente/{slug}` (sem login).
5. Execute `npm run lint` e `npm run build` para validar o projeto.
6. Para executar o build em produção com o backend e a API ativos, use `npm start` após o build.

As sessões são assinadas no servidor e armazenadas em cookie `HttpOnly`, `SameSite=Strict`, com validade de 8 horas. O painel e as APIs de administração exigem uma sessão válida. Cadastre clientes no painel para criar links exclusivos aleatórios; cada link só retorna o relatório e os arquivos daquele cliente. Uploads aceitam somente MP4, PNG e JPG, validam assinatura e tipo do arquivo e são guardados fora da pasta pública em `data/media`, com limite de 100 MB por arquivo. Use **Editar dados** para alterar título, descrição ou cliente destinatário; para substituir o arquivo, remova-o e envie a nova versão. A seção **Logo White Vision** permite substituir a imagem por um PNG de até 5 MB, com validação de conteúdo. Os arquivos de mídia são removidos junto com o cliente. Em produção, use armazenamento de arquivos persistente e compartilhado entre instâncias.

O upload de PDF exige selecionar um cliente existente (ou cadastrá-lo no próprio formulário). O arquivo é salvo primeiro, de forma privada, em `data/report-pdfs`, relido do disco, convertido para Base64 e enviado ao Gemini via `inlineData` com MIME `application/pdf`. A chamada não configura timeout de 30 segundos; o SDK `@google/genai` aguarda a resposta, que deve ser JSON e é validada após remover eventuais cercas Markdown. A resposta deve conter nome do cliente e resumo geral, além de estruturar métricas do dashboard (`insercoesPeriodo`, `metaDiaria`, `frequenciaLoop`, `telasAtivas`, `desempenhoPorTela` e `historicoDiario`). O backend mapeia esses campos para as estruturas usadas pelos cards e gráficos, mantém dados legados quando uma métrica opcional não vier no PDF e grava o perfil junto ao histórico do envio. O portal público atualiza os dados periodicamente, sem exigir recarregamento manual. Em caso de indisponibilidade temporária, o sistema tenta `gemini-3.5-flash-lite`. O backend registra o modelo/tamanho do arquivo antes da chamada, o tamanho da resposta depois e erros com mensagem e stack, sem registrar a chave nem o conteúdo do PDF. Falhas de análise mantêm o PDF e exibem o erro específico retornado pelo Gemini ou pela validação local. Cada item do histórico pode ser removido, o que também apaga o arquivo físico. Citações fornecidas são comparadas com o texto/página do PDF; isso ainda exige revisão humana para conferir associação e interpretação dos dados. A marca usa `public/white-vision-logo.png`; substitua por um PNG oficial transparente mantendo esse caminho para atualizar ambos os cabeçalhos.

O perfil do cliente também oferece configuração White Label salva por campanha: cor do gabinete do totem vertical, texto do adesivo superior, URL segura de logo (HTTPS ou caminho local) e cor primária dos botões de renovação e download. O vídeo é exibido limpo em proporção 9:16, com faixa de texto acima da tela e logo abaixo, sem sobreposições nos controles. O portal usa valores padrão escuros/White Vision quando não há tema personalizado. Uploads de logo no painel aceitam PNG, JPEG/JPG, WEBP e SVG; são convertidos no navegador para PNG antes de enviados, para preservar compatibilidade e evitar servir SVG não rasterizado.

No perfil White Label, o adesivo superior aceita várias linhas, e o tamanho da logo (20–150 px) e a cor do fundo da área da logo podem ser configurados. Os cards por tela exibem o total do período, a média diária individual calculada sobre os dias do histórico disponível e o status operacional da tela.
