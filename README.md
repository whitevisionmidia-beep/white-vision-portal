# Portal White Vision

Portal White Vision com React/Vite, Supabase Auth, Postgres, Storage e Edge Functions. O painel mestre fica em `/`, `/login` e `/admin`. Cada campanha tem um endereço público exclusivo `/c/{slug}`; o painel oferece **Copiar Link do Cliente**. A rota anterior `/cliente/{slug}` redireciona ao novo link. O `vercel.json` reescreve as rotas do frontend para a SPA.

## Configuração do Supabase

1. Crie `.env` a partir de `.env.example` e defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. A anon key é pública; nunca coloque a `service_role` ou chaves de API em variáveis `VITE_*`.
2. Aplique o schema/RLS e crie os buckets com Supabase CLI:

   ```sh
   npx supabase login
   npx supabase link --project-ref dfyzynhymcwaousvtzkp
   npx supabase db push
   npx supabase functions deploy groq-admin
   npx supabase functions deploy analyze-pdf
   ```

3. No Supabase Auth, crie o usuário administrador `whitevisionmidia@gmail.com`. Depois, execute no SQL Editor, substituindo apenas o email se necessário:

   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users
   where email = 'whitevisionmidia@gmail.com'
   on conflict (user_id) do update set enabled = true;
   ```

4. Configure a chave Groq de uma das duas formas:

   - Entre no portal como administrador e use **Configuração da chave Groq**. A chave fica em `private_settings`, acessível somente às Edge Functions por service role, e pode ser testada na própria tela.
   - Ou configure `GROQ_API_KEY` como secret da Edge Function no painel do Supabase.

   A chave configurada no portal tem prioridade sobre `GROQ_API_KEY`. A Edge Function `analyze-pdf` usa `llama-3.1-8b-instant`; a chave nunca é retornada ao navegador.

5. Na Vercel, configure `VITE_SUPABASE_URL=https://dfyzynhymcwaousvtzkp.supabase.co` e `VITE_SUPABASE_ANON_KEY` para Production, Preview e Development, e faça novo deploy.

## Desenvolvimento e validação

Requer Node.js 20 ou superior. Instale dependências com `npm install`, configure `.env` e execute `npm run dev`. O frontend acessa Supabase diretamente com sessão Auth persistente e RLS; a chave Groq é gerida pelo backend administrativo. Execute `npm run lint` e `npm run build`.

As tabelas e políticas estão em `supabase/migrations`. Administradores são provisionados explicitamente em `admin_users`; não existe cadastro público de administradores. O bucket `client-media` permite leitura pública de arquivos de mídia endereçados por UUID e gravação somente por admins; `report-pdfs` é privado e acessível somente por admins/Edge Functions.

O totem White Label, métricas por tela, logos, relatórios e dados de campanha são persistidos no Postgres/Storage. Processamento PDF e operações secretas Groq são executados em Edge Functions autenticadas; não exponha service role ou chaves de API em variáveis `VITE_*`.
