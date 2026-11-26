# Vetiva IT Remote Desk

Secure, AnyDesk-inspired remote desktop support platform built for **Vetiva Capital Management Limited**.

## Architecture

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons, Sonner
- **Persistence & Security**: Server-authoritative SQLite (`node:sqlite`) + Firebase Authentication (Google Workspace Sign-In) with server-verified ID tokens and RBAC (`admin`, `technician`, `employee`)
- **Backend**: Node.js, Express, Socket.IO (real-time WebRTC signaling, rate-limited join guard, and malware-scanned file transfer API)
- **Real-Time Streaming**: WebRTC (`RTCPeerConnection` + `RTCDataChannel`) with STUN & HMAC-signed short-lived Coturn TURN credentials
- **Native Control Companion**: Rust + Tauri agent in `/desktop-agent` for explicit-consent OS mouse and keyboard forwarding

## Local Development

1. Configure optional environment variables in `.env` (`TURN_SERVER_URL`, `TURN_SHARED_SECRET`) and ensure `firebase-applet-config.json` is present.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the full-stack server on port `3000`:
   ```bash
   npm run dev
   ```

## Production Build

```bash
npm run build
npm start
```
