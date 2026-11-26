import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { createApiRouter } from './src/server/routes/api.ts';
import { initSocketServer } from './src/server/signaling/socket.ts';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.set('trust proxy', 1);

  // Baseline HTTP security headers (iframe-compatible for AI Studio preview)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'display-capture=(self)');
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.use('/api', createApiRouter());

  const httpServer = http.createServer(app);
  initSocketServer(httpServer);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Vetiva IT Remote Desk server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Vetiva IT Remote Desk server:', err);
  process.exit(1);
});
