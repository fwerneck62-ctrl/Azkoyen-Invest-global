import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifySessionToken } from './security.ts';

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  role: 'investor' | 'trader' | 'admin';
}

const clients = new Set<ConnectedClient>();

export function setupRealtimeServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    let registered: ConnectedClient | null = null;

    const url = new URL(req.url || '/ws', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    if (queryToken) {
      const payload = verifySessionToken(queryToken);
      if (payload) {
        registered = { ws, userId: payload.uid, role: payload.role };
        clients.add(registered);
        ws.send(JSON.stringify({ event: 'ws:connected', data: { userId: payload.uid, role: payload.role } }));
      }
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; token?: string };
        if (msg.type === 'auth' && msg.token) {
          const payload = verifySessionToken(msg.token);
          if (payload) {
            if (registered) clients.delete(registered);
            registered = { ws, userId: payload.uid, role: payload.role };
            clients.add(registered);
            ws.send(JSON.stringify({ event: 'ws:connected', data: { userId: payload.uid, role: payload.role } }));
          }
        }
      } catch {
        // Ignore malformed frames
      }
    });

    ws.on('close', () => {
      if (registered) {
        clients.delete(registered);
      }
    });
  });

  return wss;
}

export function broadcastToUser(userId: string, event: string, data: unknown) {
  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export function broadcastToRole(role: 'investor' | 'trader' | 'admin', event: string, data: unknown) {
  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.role === role && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export function broadcastAll(event: string, data: unknown) {
  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}
