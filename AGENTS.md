# Regras do projeto Veno

## Usuários, autenticação e papéis

- Todos os usuários da aplicação devem estar na mesma coleção `users` do Cloud Firestore.
- O identificador de cada documento deve ser o mesmo `uid` gerado pelo Firebase Authentication: `users/{uid}`.
- A criação de uma nova conta deve criar o usuário no Firebase Authentication e, em seguida, sincronizar seu cadastro em `users/{uid}` com o `uid`, e-mail, nome, status, papel e demais informações de perfil necessárias.
- A criação deve ser coordenada pelo backend com Firebase Admin SDK. Se a gravação no Firestore falhar, o fluxo deve desfazer ou compensar a criação no Authentication para não deixar cadastros parciais.
- Senhas, tokens e credenciais nunca devem ser armazenados no Firestore.
- Papéis devem ser armazenados na coleção `roles` e referenciados pelo campo `roleId` do usuário. Não usar allowlists de e-mail no frontend como mecanismo de autorização.
- Criação, atualização, desativação e exclusão de usuários devem manter Firebase Authentication e `users/{uid}` sincronizados.
- O frontend pode ler apenas o próprio cadastro e o papel atribuído. Criação de usuários, atribuição de papéis e outras operações privilegiadas devem ser executadas e validadas pelo backend.
