# Vetiva IT Remote Desk — Firestore Security Specification

## 1. Data Invariants
1. **Identity Integrity**: No user may create a `/users/{userId}` document with `uid != request.auth.uid` or assign themselves `'admin'` or `'technician'` roles without either being the bootstrapped corporate administrator (`gideonline18@gmail.com`) or redeeming a valid, unclaimed `/invites/{inviteId}` document matching their verified email.
2. **Session Isolation & Single-Use Access Code**: A remote support session `/sessions/{sessionId}` cannot be joined by another user unless the incoming `tokenHash` exists in `/sessions/{sessionId}/accessTokens/{tokenHash}`, and `accessTokens` documents are readable only by the session host.
3. **Unattended Access Prohibition**: `permissions.unattendedAccess` on `/sessions/{sessionId}` must strictly equal `false` on every create and update.
4. **Host-Only Consent & Emergency Stop**: Only the session host (or an admin) may approve an incoming connection or enable `canControlInput`, `canShareClipboard`, `canTransferFiles`, or `canRecordSession`. Either participant may trigger an Emergency Stop that sets all four flags to `false`.
5. **Terminal State Locking**: Once a session reaches `'ended'`, `'expired'`, or `'rejected'`, non-admin updates are strictly rejected.
6. **PII Isolation**: User records containing email addresses (`/users/{userId}`) are readable only by the owning user or an administrator; technician dashboard presence uses `/technicians/{userId}` without email PII.
7. **Immutable Audit Trail**: `/auditLogs/{logId}` documents can only be created with `actorUid == request.auth.uid` and `createdAt == request.time`, and may never be updated or deleted.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Promotion on Sign-Up**: Normal user creating `/users/{uid}` with `roleSlug: "admin"` and no invite -> `PERMISSION_DENIED`.
2. **Unverified Email Spoofing**: Request with `email: "gideonline18@gmail.com"` and `email_verified: false` -> `PERMISSION_DENIED`.
3. **Ghost Field Injection (Shadow Update)**: Updating `/sessions/{sessionId}` with extra field `isBypassed: true` -> `PERMISSION_DENIED`.
4. **Forged Session Join Without Access Code**: Technician updating `/sessions/{sessionId}` to `status: "active"` or without matching `accessTokens/{tokenHash}` -> `PERMISSION_DENIED`.
5. **Unattended Access Escalation**: Host or technician setting `permissions.unattendedAccess: true` -> `PERMISSION_DENIED`.
6. **Technician Self-Granting Input Control**: Technician updating `permissions.canControlInput: true` on `/sessions/{sessionId}` -> `PERMISSION_DENIED`.
7. **Terminal State Resurrection**: Updating a session with `status: "ended"` back to `status: "active"` -> `PERMISSION_DENIED`.
8. **ID Poisoning**: Creating or reading `/sessions/` with a 500-character document ID or invalid characters (`../etc/passwd`) -> `PERMISSION_DENIED`.
9. **Timestamp Forgery**: Creating a chat message or audit log with a backdated `createdAt` != `request.time` -> `PERMISSION_DENIED`.
10. **PII Blanket Read**: Employee attempting `get` or `list` on `/users` to read another employee's email -> `PERMISSION_DENIED`.
11. **Access Token Enumeration**: Technician attempting `list` or `get` on `/sessions/{sessionId}/accessTokens` -> `PERMISSION_DENIED`.
12. **Audit Log Tampering**: Any user attempting `update` or `delete` on `/auditLogs/{logId}` -> `PERMISSION_DENIED`.
