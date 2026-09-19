const email = process.argv[2] ?? 'admin@veno.local';
const password = process.argv[3] ?? 'Veno@123';
const endpoint = 'http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key';

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, returnSecureToken: true }),
});

if (!response.ok) {
  const error = await response.text();
  throw new Error(`Não foi possível criar o usuário no emulador: ${error}`);
}

console.log(`Usuário ${email} criado no Firebase Auth Emulator.`);
