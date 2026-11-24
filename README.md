# Vetiva IT Remote Desk

Secure, AnyDesk-inspired remote desktop support platform built for **Vetiva Capital Management Limited**.

## Architecture

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons, Sonner
- **Backend**: Node.js, Express, Socket.IO (real-time WebRTC signaling & presence), PostgreSQL + Drizzle ORM
- **Real-Time Streaming**: WebRTC (`RTCPeerConnection` + `RTCDataChannel`) with STUN & HMAC-signed short-lived Coturn TURN credentials
- **Authentication & RBAC**: Firebase Authentication (Google Workspace Sign-In) with PostgreSQL roles (`admin`, `technician`, `employee`)
- **Native Control Companion**: Rust + Tauri agent in `/desktop-agent` for explicit-consent OS mouse and keyboard forwarding

## Local Development

1. Configure environment secrets (`SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`, and optional `TURN_SERVER_URL`, `TURN_SHARED_SECRET`).
2. Install dependencies:
   ```bash
   npm install
   ```
3. Push Drizzle schema to PostgreSQL:
   ```bash
   npx drizzle-kit push --config=src/db/drizzle.config.ts
   ```
4. Start the full-stack server on port `3000`:
   ```bash
   npm run dev
   ```

## Production Build & Docker Deployment

```bash
npm run build
docker compose -f infrastructure/docker-compose.yml up -d --build
```
