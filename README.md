# Veno

Painel leve em Vite + TypeScript vanilla, autenticado pelo Firebase Authentication e publicado como aplicação estática no Firebase Hosting.

## Stack

- Vite 8 e TypeScript
- Firebase Authentication (SDK modular)
- Firebase Hosting
- Vitest
- CSS nativo, sem framework de interface

## Desenvolvimento local

Instale as dependências:

```bash
npm install
```

Inicie o Firebase Auth Emulator:

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

As portas reservadas para este projeto são: Auth `9199`, Emulator UI `4100` e Hosting `5100`, evitando conflito com outros projetos que usem os padrões do Firebase.

Para testar pelo Firebase Hosting Emulator em `http://127.0.0.1:5100`, use este comando no lugar dos dois servidores acima:

```bash
npm run emulators
```

Esse comando gera o `dist-emulator/` com a configuração local antes de iniciar os emuladores. Executar `firebase emulators:start` diretamente funciona, mas pode servir um build local anterior.
O `firebase.json` permite conexão com o Auth Emulator local; o deploy usa `firebase.production.json`, cuja política permanece restrita aos serviços HTTPS do Google.

Os builds ficam separados: `dist-emulator/` para desenvolvimento e `dist/` para produção. Assim, validar a versão de produção não sobrescreve a aplicação servida pelos emuladores.

## Validação

```bash
npm run check
```

Esse comando executa verificação de tipos, testes e build de produção.

## Firebase de produção

1. No Firebase Console, abra **Authentication > Sign-in method** e habilite **E-mail/senha**.
2. Em **Authentication > Users**, crie o primeiro administrador.
3. Em **Configurações do projeto > Seus aplicativos**, registre um aplicativo Web.
4. Copie `.env.example` para `.env` e preencha a configuração recebida:

```bash
cp .env.example .env
```

Para produção, remova `VITE_FIREBASE_AUTH_EMULATOR_URL` do `.env`. Mais de um administrador pode ser informado em `VITE_ADMIN_EMAILS`, separado por vírgulas.

As variáveis `VITE_*` são incorporadas ao bundle e não são segredos. A Web API Key do Firebase identifica o projeto; a proteção dos dados deve ser feita com Security Rules e autorização no backend.

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
- `src/access.ts`: autorização da interface e mensagens de autenticação
- `src/style.css`: identidade visual responsiva
- `public/`: logo e arquivos estáticos
- `firebase.json`: Hosting e emuladores locais, incluindo acesso ao Auth Emulator
- `firebase.production.json`: Hosting de produção com política de segurança restrita
- `scripts/`: criação do usuário local e deploy

> A lista de administradores no frontend protege a navegação, mas não substitui autorização de servidor. Quando os disparos da Meta forem implementados, o backend TypeScript validará o token do Firebase e permissões antes de aceitar qualquer operação.
