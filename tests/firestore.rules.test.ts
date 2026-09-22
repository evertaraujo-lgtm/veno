import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const projectId = 'demo-veno-rules';
let testEnvironment: RulesTestEnvironment;

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8280,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
}, 30_000);

beforeEach(async () => {
  await testEnvironment.clearFirestore();

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(doc(database, 'roles', 'admin'), {
      active: true,
      name: 'Administrador',
      permissions: ['dashboard:view', 'meta:manage'],
    });
    await setDoc(doc(database, 'roles', 'operator'), {
      active: true,
      name: 'Operador',
      permissions: [],
    });
    await setDoc(doc(database, 'users', 'user-admin'), {
      active: true,
      roleId: 'admin',
    });
    await setDoc(doc(database, 'users', 'user-inactive'), {
      active: false,
      roleId: 'admin',
    });
  });
}, 30_000);

afterAll(async () => {
  await testEnvironment?.cleanup();
}, 30_000);

describe('regras RBAC do Firestore', () => {
  it('permite ao usuário ler somente o próprio cadastro e papel', async () => {
    const database = testEnvironment.authenticatedContext('user-admin').firestore();

    await assertSucceeds(getDoc(doc(database, 'users', 'user-admin')));
    await assertSucceeds(getDoc(doc(database, 'roles', 'admin')));
    await assertFails(getDoc(doc(database, 'users', 'user-inactive')));
    await assertFails(getDoc(doc(database, 'roles', 'operator')));
  });

  it('nega leituras para usuários anônimos ou inativos', async () => {
    const anonymousDatabase = testEnvironment.unauthenticatedContext().firestore();
    const inactiveDatabase = testEnvironment.authenticatedContext('user-inactive').firestore();

    await assertFails(getDoc(doc(anonymousDatabase, 'users', 'user-admin')));
    await assertFails(getDoc(doc(inactiveDatabase, 'roles', 'admin')));
  });

  it('nega alterações de usuários e papéis feitas pelo navegador', async () => {
    const database = testEnvironment.authenticatedContext('user-admin').firestore();

    await assertFails(setDoc(doc(database, 'users', 'user-admin'), {
      active: true,
      roleId: 'admin',
    }));
    await assertFails(setDoc(doc(database, 'roles', 'admin'), {
      active: true,
      permissions: ['users:manage'],
    }));
  });

  it('mantém templates e registros de envio acessíveis somente pelo backend', async () => {
    const database = testEnvironment.authenticatedContext('user-admin').firestore();

    await assertFails(getDoc(doc(database, 'metaTemplates', 'template-1')));
    await assertFails(setDoc(doc(database, 'metaTemplates', 'template-1'), {
      name: 'template_injetado',
    }));
    await assertFails(getDoc(doc(database, 'testMessages', 'message-1')));
    await assertFails(getDoc(doc(database, 'metaWebhookEvents', 'event-1')));
    await assertFails(getDoc(doc(database, 'metaIncomingMessages', 'message-1')));
    await assertFails(getDoc(doc(database, 'metaMessageStatuses', 'status-1')));
    await assertFails(setDoc(doc(database, 'metaWebhookEvents', 'event-1'), {
      kind: 'message',
    }));
  });
});
