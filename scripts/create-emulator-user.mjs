const email = process.argv[2] ?? 'admin@veno.local';
const password = process.argv[3] ?? 'Veno@123';
const authBaseUrl = 'http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts';
const firestoreBaseUrl = 'http://127.0.0.1:8180/v1/projects/demo-veno/databases/(default)/documents';

async function authenticate(action) {
  return fetch(`${authBaseUrl}:${action}?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
}

let response = await authenticate('signUp');

if (!response.ok && (await response.clone().text()).includes('EMAIL_EXISTS')) {
  response = await authenticate('signInWithPassword');
}

if (!response.ok) {
  const error = await response.text();
  throw new Error(`Não foi possível criar o usuário no emulador: ${error}`);
}

const authUser = await response.json();

async function writeDocument(path, fields) {
  const firestoreResponse = await fetch(`${firestoreBaseUrl}/${path}`, {
    method: 'PATCH',
    headers: {
      authorization: 'Bearer owner',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });

  if (!firestoreResponse.ok) {
    throw new Error(`Não foi possível criar ${path} no Firestore Emulator: ${await firestoreResponse.text()}`);
  }
}

await writeDocument('roles/admin', {
  active: { booleanValue: true },
  name: { stringValue: 'Administrador' },
  permissions: {
    arrayValue: {
      values: [
        { stringValue: 'dashboard:view' },
        { stringValue: 'meta:manage' },
      ],
    },
  },
});

await writeDocument(`users/${authUser.localId}`, {
  active: { booleanValue: true },
  email: { stringValue: email.toLowerCase() },
  roleId: { stringValue: 'admin' },
});

console.log(`Usuário ${email} e papel admin criados nos emuladores.`);
