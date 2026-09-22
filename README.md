# Veno

Painel leve em Vite + TypeScript vanilla, autenticado pelo Firebase Authentication e publicado como aplicação estática no Firebase Hosting.

## Stack

- Vite 8 e TypeScript
- Firebase Authentication e Firestore Lite (SDK modular)
- Firebase Hosting
- Vitest e testes das Firestore Security Rules
- CSS nativo, sem framework de interface

## Desenvolvimento local

Instale as dependências:

```bash
npm install
```

Inicie os emuladores de Auth e Firestore:

```bash
npm run emulators:auth
```

Em outro terminal, crie o usuário local uma vez:

```bash
node scripts/create-emulator-user.mjs
```

Inicie o Vite:

```bash
npm run dev
```

Abra <http://127.0.0.1:5173> e entre com `admin@veno.local` / `Veno@123`. O projeto fictício `demo-veno` impede acesso acidental ao Firebase de produção.

As portas reservadas para este projeto são: Auth `9199`, Firestore `8180`, Emulator UI `4100` e Hosting `5100`, evitando conflito com outros projetos que usem os padrões do Firebase.

Para testar pelo Firebase Hosting Emulator em `http://127.0.0.1:5100`, use este comando no lugar dos dois servidores acima:

```bash
npm run emulators
```

Esse comando gera o `dist/` com a configuração local antes de iniciar os emuladores. Executar `firebase emulators:start` diretamente funciona, mas pode servir um build anterior.
O `firebase.json` permite conexão com Auth e Firestore Emulators; o deploy usa `firebase.production.json`, cuja política permanece restrita aos serviços HTTPS do Google.

O Firebase Hosting e os emuladores servem a pasta `dist/`. Antes de um deploy, execute o build de produção para garantir que o bundle use as credenciais corretas.

## Validação

```bash
npm run check
```

Esse comando executa verificação de tipos, testes e build de produção.

## Firebase de produção

1. No Firebase Console, abra **Authentication > Sign-in method** e habilite **E-mail/senha**.
2. Em **Authentication > Users**, crie o usuário.
3. Crie `users/{uid}` no Firestore com `active: true` e `roleId` apontando para um documento de `roles`.
4. Crie `roles/{roleId}` com `active: true`, `name` e a lista `permissions`.
5. Em **Configurações do projeto > Seus aplicativos**, registre um aplicativo Web.
6. Copie `.env.example` para `.env` e preencha a configuração recebida:

```bash
cp .env.example .env
```

Para produção, remova as URLs dos emuladores do `.env`.

As variáveis `VITE_*` são incorporadas ao bundle e não são segredos. A Web API Key do Firebase identifica o projeto; a proteção dos dados deve ser feita com Security Rules e autorização no backend.

## Integração com a Meta

A área **Configuração Meta** em `/painel/meta` mostra a conexão da conta. **Templates** em `/painel/templates` cadastra modelos e acompanha a aprovação. **Disparos** em `/painel/disparos` envia uma mensagem de teste. Todas usam Cloud Functions autenticadas; o navegador nunca recebe o token da Meta. O backend valida o usuário em `users/{uid}`, carrega o papel em `roles/{roleId}` e exige a permissão `meta:manage`.

Antes do primeiro deploy das funções:

1. No Meta for Developers, configure o WhatsApp Business Account e o número remetente.
2. Gere um token de usuário do sistema com as permissões `whatsapp_business_management` e `whatsapp_business_messaging`.
3. Cadastre cada valor no Secret Manager pelo Firebase CLI:

```bash
firebase functions:secrets:set META_ACCESS_TOKEN --project praxisagendamentos
firebase functions:secrets:set META_WABA_ID --project praxisagendamentos
firebase functions:secrets:set META_PHONE_NUMBER_ID --project praxisagendamentos
```

4. Garanta que o papel administrativo tenha `dashboard:view` e `meta:manage` em `permissions`.
5. Execute `./scripts/deploy.sh`.

O primeiro fluxo aceita templates textuais sem variáveis, nas categorias `UTILITY` e `MARKETING`. Um template novo passa pela análise da Meta e só fica disponível para envio de teste depois de atingir o status `APPROVED`. O número de destino deve incluir DDI e DDD.

### Webhook da WhatsApp Cloud API

O endpoint `metaWebhookGrobEventos` recebe eventos da Meta diretamente em uma Cloud Function HTTP na região `southamerica-east1`. Ele responde ao desafio de verificação (`GET`) e valida a assinatura `X-Hub-Signature-256` de cada notificação (`POST`) usando o corpo original e o segredo do aplicativo Meta. Grava o último status em `metaMessageStatuses/{sha256(messageId)}`, as mensagens recebidas em `metaIncomingMessages/{sha256(messageId)}` e uma linha por mensagem ou transição de status em `metaWebhookEvents`. O histórico inclui `sent`, `delivered`, `read`, `failed` e `deleted`, apenas para o WABA e número configurados. As coleções ficam inacessíveis ao navegador pelas regras atuais do Firestore. Eventos repetidos não criam novas linhas. O conteúdo persistido inclui texto, identificador de mídia, respostas a botões e listas, reações e localização quando presentes; outros tipos preservam identificador, remetente, tipo e horário. O webhook não envia respostas automaticamente nem baixa arquivos de mídia.

A página **Eventos WhatsApp** em `/painel/webhooks` mostra esse histórico em ordem de recebimento, com filtro por mensagens ou status, atualização e paginação de 100 linhas. `listMetaWebhookEvents` valida `users/{uid}` e `roles/{roleId}` no backend e exige `meta:manage`; o navegador não lê as coleções diretamente. O histórico da página começa com os eventos recebidos após o deploy desta versão.

1. Gere um token de verificação aleatório e copie o **Segredo do aplicativo** em Meta for Developers > Configurações do aplicativo > Básico. O token de verificação é escolhido por você; ele é diferente do token de acesso da Graph API e do segredo do aplicativo.
2. Cadastre os dois segredos no Firebase Secret Manager:

```bash
firebase functions:secrets:set META_WEBHOOK_VERIFY_TOKEN --project praxisagendamentos
firebase functions:secrets:set META_APP_SECRET --project praxisagendamentos
```

3. Publique a função com `firebase deploy --only functions:metaWebhookGrobEventos --project praxisagendamentos --config firebase.production.json` e copie a URL HTTPS exata exibida pelo CLI. Confirme que a implantação permite invocação pública; o código autentica os `POST` pela assinatura da Meta.
4. Em Meta for Developers > WhatsApp > Configuração > Webhook, informe essa URL como **URL de retorno** e o mesmo `META_WEBHOOK_VERIFY_TOKEN` como **token de verificação**. Assine o campo `messages` do objeto `whatsapp_business_account`.
5. Inscreva o aplicativo no WABA configurado em `META_WABA_ID` pela operação `POST /{WABA_ID}/subscribed_apps` da Graph API, usando o token de usuário do sistema com `whatsapp_business_management`. Sem essa inscrição, a verificação da URL pode funcionar sem que os eventos reais cheguem.
6. Envie uma mensagem de teste, responda pelo WhatsApp e confira `/painel/webhooks`, os documentos em `metaWebhookEvents` e os logs de `metaWebhookGrobEventos`. Repetições do mesmo evento não criam novas linhas; eventos mais antigos não substituem um status mais novo.

As duas inscrições são necessárias: o app deve assinar o campo `messages` no objeto `whatsapp_business_account`, e o WABA deve ter o app em `subscribed_apps`. Para conferir a configuração sem mostrar segredos, execute `node scripts/check-meta-webhook-config.mjs`. Com o callback já configurado no app, `node scripts/subscribe-meta-messages-field.mjs` acrescenta `messages` preservando os campos existentes, e `node scripts/subscribe-meta-webhook.mjs` inscreve o app no WABA. Eventos anteriores a essas inscrições não são recuperados; faça um novo envio para validar.

Para publicar a página junto com o histórico, execute `./scripts/deploy.sh`. O deploy precisa incluir Hosting, `metaWebhookGrobEventos`, `listMetaWebhookEvents` e o índice composto de `metaWebhookEvents` em `firestore.indexes.json`.

### Envio pela GrobExperience

O endpoint HTTP `sendGrobExperienceTemplate` recebe um pedido de envio do **backend** da GrobExperience, consulta o template aprovado no WABA da Veno e envia pela Cloud API da Meta. Ele usa uma chave Bearer exclusiva, guardada no Secret Manager dos dois projetos; a chave nunca deve ser colocada no navegador ou no Firestore. A URL é `https://southamerica-east1-praxisagendamentos.cloudfunctions.net/sendGrobExperienceTemplate`.

Os dois projetos de produção já têm o mesmo segredo `GROB_EXPERIENCE_API_KEY` no Secret Manager, e a função da Veno já está publicada. Para recriar a configuração, cadastre **a mesma chave** nos dois projetos e publique a função:

```bash
firebase functions:secrets:set GROB_EXPERIENCE_API_KEY --project praxisagendamentos
firebase functions:secrets:set GROB_EXPERIENCE_API_KEY --project grobexperience
firebase deploy --only functions:sendGrobExperienceTemplate --project praxisagendamentos --config firebase.production.json
```

A chamada deve sair de uma Cloud Function da GrobExperience que declare `GROB_EXPERIENCE_API_KEY` em `secrets`, com `Content-Type: application/json`, `Authorization: Bearer <chave>` e `Idempotency-Key: <identificador único e estável do envio>`. O corpo mínimo é:

```json
{
  "template": "infos_gbex",
  "nome": "Ana Silva",
  "numero": "11999999999"
}
```

`numero` pode ser um número brasileiro com DDD, com ou sem `55`, ou um número internacional começando com `+`. `idioma` é opcional e usa `en` por padrão. Para templates com outras variáveis, informe `parametros` com chaves como `body:evento` e `body:link`; `body:nome` é preenchido a partir de `nome`. Um template posicional cuja única variável seja `body:1` também recebe `nome`. O endpoint valida todas as variáveis contra o template aprovado. A resposta `202` contém `accepted` e `messageId`; `200` indica repetição de uma solicitação já aceita. O mesmo `Idempotency-Key` com outro conteúdo retorna `409`. Se a resposta da Meta for incerta, a chave fica bloqueada para evitar um segundo envio automático; confira o status pelo webhook.

Atualmente `infos_gbex` (`en`) está aprovado no WABA da Veno e usa apenas `nome`. Os templates `participacao_chegando` e `confirmar_data_participacao` usados no código atual da GrobExperience não aparecem no WABA da Veno; a GrobExperience também usa outro número remetente. Para usar esses templates neste endpoint, cadastre e aguarde aprovação no WABA da Veno, ou mapeie o pedido da GrobExperience para `infos_gbex` quando o conteúdo for adequado.

## Deploy

Faça login uma vez:

```bash
firebase login
```

Depois publique:

```bash
./scripts/deploy.sh
```

O script instala versões travadas, executa todas as validações e publica `dist/` em `https://praxisagendamentos.web.app`.

## Estrutura

- `src/main.ts`: interface e integração com Firebase Auth
- `src/access.ts`: modelo e avaliação das permissões
- `src/authorization.ts`: leitura de usuários e roles no Firestore
- `src/meta.ts`: interface de templates e envio de teste da Meta
- `src/webhooks.ts`: monitoramento de mensagens recebidas e status do WhatsApp
- `src/style.css`: identidade visual responsiva
- `functions/`: backend protegido da WhatsApp Cloud API
- `public/`: logo e arquivos estáticos
- `firebase.json`: Hosting e emuladores locais, incluindo acesso ao Auth Emulator
- `firebase.production.json`: Hosting de produção com política de segurança restrita
- `firestore.rules`: acesso RBAC; o navegador não pode alterar usuários ou roles
- `tests/firestore.rules.test.ts`: testes das regras de segurança
- `scripts/`: criação do usuário local e deploy

> O frontend consulta permissões para montar a interface, mas operações sensíveis também devem ser autorizadas no backend. Quando os disparos da Meta forem implementados, o backend TypeScript validará o token do Firebase e o papel armazenado no Firestore antes de aceitar qualquer operação.
