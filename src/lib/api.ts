// Session token is held strictly in JS memory (never localStorage or sessionStorage)
let memoryToken: string | null = null;

export function setAuthToken(token: string | null) {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (memoryToken) {
    headers['Authorization'] = `Bearer ${memoryToken}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const errMsg = typeof data === 'object' && data && 'error' in data ? String(data.error) : `Erro HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return data as T;
}

export function connectRealtime(
  token: string,
  onEvent: (event: string, data: unknown) => void
): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
  let ws: WebSocket | null = null;
  let closed = false;
  let retryTimer: number | undefined;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(wsUrl);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as { event?: string; data?: unknown };
        if (msg.event) {
          onEvent(msg.event, msg.data);
        }
      } catch {
        // Ignore malformed frame
      }
    };
    ws.onclose = () => {
      if (!closed) {
        retryTimer = window.setTimeout(connect, 3500);
      }
    };
  };

  connect();

  return () => {
    closed = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    if (ws && ws.readyState < WebSocket.CLOSING) {
      ws.close();
    }
  };
}
