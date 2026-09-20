import { doc, getDoc, type Firestore } from 'firebase/firestore/lite';
import type { User } from 'firebase/auth';
import {
  DASHBOARD_PERMISSION,
  grantAccess,
  parseRoleRecord,
  parseUserAccessRecord,
  type GrantedAccess,
} from './access';

export type AuthorizationResult =
  | { granted: true; access: GrantedAccess }
  | { granted: false; reason: 'user-not-found' | 'user-invalid' | 'role-not-found' | 'role-invalid' | 'denied' };

export async function authorizeUser(
  database: Firestore,
  user: User,
): Promise<AuthorizationResult> {
  const userSnapshot = await getDoc(doc(database, 'users', user.uid));

  if (!userSnapshot.exists()) {
    return { granted: false, reason: 'user-not-found' };
  }

  const userRecord = parseUserAccessRecord(userSnapshot.data());

  if (!userRecord) {
    return { granted: false, reason: 'user-invalid' };
  }

  const roleSnapshot = await getDoc(doc(database, 'roles', userRecord.roleId));

  if (!roleSnapshot.exists()) {
    return { granted: false, reason: 'role-not-found' };
  }

  const roleRecord = parseRoleRecord(roleSnapshot.data());

  if (!roleRecord) {
    return { granted: false, reason: 'role-invalid' };
  }

  const access = grantAccess(userRecord, roleRecord, DASHBOARD_PERMISSION);
  return access ? { granted: true, access } : { granted: false, reason: 'denied' };
}
