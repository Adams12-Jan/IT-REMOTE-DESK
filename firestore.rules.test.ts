/**
 * Vetiva IT Remote Desk — Adversarial Security Specification Verification ("Dirty Dozen")
 * Validates payload constraints synchronized with firebase-blueprint.json and firestore.rules.
 */

export interface SecurityPayloadTest {
  id: number;
  name: string;
  collection: string;
  expectedOutcome: 'PERMISSION_DENIED';
  payload: Record<string, unknown>;
}

export const DIRTY_DOZEN_PAYLOADS: SecurityPayloadTest[] = [
  {
    id: 1,
    name: 'Self-Promotion on Sign-Up',
    collection: '/users/{uid}',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { uid: 'attacker1', email: 'attacker@vetiva.com', roleSlug: 'admin', isActive: true },
  },
  {
    id: 2,
    name: 'Unverified Email Spoofing',
    collection: '/users/{uid}',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { email: 'gideonline18@gmail.com', email_verified: false },
  },
  {
    id: 3,
    name: 'Ghost Field Injection (Shadow Update)',
    collection: '/sessions/{sessionId}',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { permissions: { canControlInput: true }, isBypassed: true },
  },
  {
    id: 4,
    name: 'Forged Session Join Without Access Code',
    collection: '/sessions/{sessionId}',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { status: 'active', technicianUid: 'tech1', tokenHash: 'nonexistent' },
  },
  {
    id: 5,
    name: 'Unattended Access Escalation',
    collection: '/sessions/{sessionId}',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { permissions: { unattendedAccess: true } },
  },
  {
    id: 6,
    name: 'Technician Self-Granting Input Control',
    collection: '/sessions/{sessionId}',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { permissions: { canControlInput: true, canTransferFiles: true } },
  },
  {
    id: 7,
    name: 'Terminal State Resurrection',
    collection: '/sessions/{sessionId}',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { previousStatus: 'ended', status: 'active' },
  },
  {
    id: 8,
    name: 'ID Poisoning',
    collection: '/sessions/{sessionId}',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { sessionId: '../etc/passwd' + 'x'.repeat(200) },
  },
  {
    id: 9,
    name: 'Timestamp Forgery',
    collection: '/auditLogs/{logId}',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { action: 'auth.login', createdAt: '1999-01-01T00:00:00Z' },
  },
  {
    id: 10,
    name: 'PII Blanket Read',
    collection: '/users',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { callerRole: 'employee', query: 'listAllUsers' },
  },
  {
    id: 11,
    name: 'Access Token Enumeration',
    collection: '/sessions/{sessionId}/accessTokens',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { callerRole: 'technician', query: 'listAccessTokens' },
  },
  {
    id: 12,
    name: 'Audit Log Tampering',
    collection: '/auditLogs/{logId}',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { operation: 'delete', logId: 'audit123' },
  },
];
