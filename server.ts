import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { db, seedInstitutionalDefaults } from './src/server/db.ts';
import { registerRoutes } from './src/server/routes.ts';
import { setupRealtimeServer } from './src/server/realtime.ts';
import { validateProductionSecurityEnv } from './src/server/security.ts';
import { startMarketFeedService, stopMarketFeedService } from './src/server/marketFeed.ts';
import { startTimedTradeSettler, stopTimedTradeSettler } from './src/server/timedTrading.ts';

async function startServer() {
  validateProductionSecurityEnv();
  seedInstitutionalDefaults();

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '2mb' }));

  // Production security headers & optional CORS allowlist
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  registerRoutes(app);

  const server = http.createServer(app);
  const wss = setupRealtimeServer(server);

  startMarketFeedService();
  startTimedTradeSettler();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AZKOYEN INVEST institutional server running on http://0.0.0.0:${PORT}`);
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`Received ${signal}. Shutting down AZKOYEN INVEST gracefully...`);
    stopTimedTradeSettler();
    stopMarketFeedService();
    wss.close();
    server.close(() => {
      try {
        db.close();
      } catch {
        // ignore if already closed
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start AZKOYEN INVEST server:', err);
  process.exit(1);
});
