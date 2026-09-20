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

Esse comando gera o `dist-emulator/` com a configuração local antes de iniciar os emuladores. Executar `firebase emulators:start` diretamente funciona, mas pode servir um build local anterior.
O `firebase.json` permite conexão com Auth e Firestore Emulators; o deploy usa `firebase.production.json`, cuja política permanece restrita aos serviços HTTPS do Google.

Os builds ficam separados: `dist-emulator/` para desenvolvimento e `dist/` para produção. Assim, validar a versão de produção não sobrescreve a aplicação servida pelos emuladores.

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

A área **Configuração Meta** em `/painel/meta` usa Cloud Functions autenticadas. O navegador nunca recebe o token da Meta. O backend valida o usuário em `users/{uid}`, carrega o papel em `roles/{roleId}` e exige a permissão `meta:manage`.

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
- `src/style.css`: identidade visual responsiva
- `functions/`: backend protegido da WhatsApp Cloud API
- `public/`: logo e arquivos estáticos
- `firebase.json`: Hosting e emuladores locais, incluindo acesso ao Auth Emulator
- `firebase.production.json`: Hosting de produção com política de segurança restrita
- `firestore.rules`: acesso RBAC; o navegador não pode alterar usuários ou roles
- `tests/firestore.rules.test.ts`: testes das regras de segurança
- `scripts/`: criação do usuário local e deploy

> O frontend consulta permissões para montar a interface, mas operações sensíveis também devem ser autorizadas no backend. Quando os disparos da Meta forem implementados, o backend TypeScript validará o token do Firebase e o papel armazenado no Firestore antes de aceitar qualquer operação.
