import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

/**
 * A fake web app with a real sign-in, used to test switching end to end.
 * The browser maps every *.test host to this server (see fixtures.ts), so the
 * same server answers as several "sites": acme.test, other.test, …
 *
 * The sign-in has three parts, like real apps:
 * - an HttpOnly session cookie set by the server (acme_sid),
 * - a readable cookie set by the page (acme_user),
 * - a supabase-js style session in local storage (sb-acme-auth-token).
 * The page reports who each part says is signed in.
 */

const PEOPLE: Record<string, { id: string; name: string }> = {
  'alice@acme.test': { id: 'u-alice', name: 'Alice Nguyen' },
  'bob@acme.test': { id: 'u-bob', name: 'Bob Tran' },
  'carol@acme.test': { id: 'u-carol', name: 'Carol Le' },
};

function base64Url(text: string): string {
  return Buffer.from(text).toString('base64url');
}

export function fakeJwt(payload: Record<string, unknown>): string {
  return `${base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64Url(JSON.stringify(payload))}.c2lnbmF0dXJl`;
}

function cookies(request: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) out[name] = decodeURIComponent(rest.join('='));
  }
  return out;
}

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%23e8590c'/%3E%3C/svg%3E" />
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 32px; background: #fafafa; color: #111; }
    .card { max-width: 520px; padding: 24px; border-radius: 14px; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
    button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
    input { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid #ccc; }
  </style>
</head>
<body>${body}</body>
</html>`;

function appPage(serverUser: string | undefined, title = 'Acme Cloud') {
  return page(
    title,
    `<div class="card">
      <h1>Acme Cloud</h1>
      <p>Server sees: <strong id="server-user">${serverUser ?? 'nobody'}</strong></p>
      <p>Page sees: <strong id="page-user">…</strong></p>
      <p>Storage sees: <strong id="storage-user">…</strong></p>
      <form id="login" hidden>
        <input id="email" type="email" placeholder="email" />
        <button id="sign-in" type="submit">Sign in</button>
      </form>
      <p id="signed-in" hidden><button id="sign-out" type="button">Sign out</button></p>
    </div>
    <script>
      const cookie = (name) => document.cookie.split('; ').find((c) => c.startsWith(name + '='))?.split('=')[1];
      const stored = JSON.parse(localStorage.getItem('sb-acme-auth-token') || 'null');
      const pageUser = cookie('acme_user') ? decodeURIComponent(cookie('acme_user')) : 'nobody';
      document.getElementById('page-user').textContent = pageUser;
      document.getElementById('storage-user').textContent = stored?.user?.email ?? 'nobody';
      const signedIn = ${JSON.stringify(Boolean(serverUser))};
      document.getElementById('login').hidden = signedIn;
      document.getElementById('signed-in').hidden = !signedIn;
      document.getElementById('login').addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('email').value;
        const response = await fetch('/api/login', { method: 'POST', body: email });
        const session = await response.json();
        document.cookie = 'acme_user=' + encodeURIComponent(email) + '; path=/; max-age=86400';
        localStorage.setItem('sb-acme-auth-token', JSON.stringify(session));
        location.reload();
      });
      document.getElementById('sign-out').addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        document.cookie = 'acme_user=; path=/; max-age=0';
        localStorage.removeItem('sb-acme-auth-token');
        location.reload();
      });
    </script>`,
  );
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => resolve(body));
  });
}

async function handle(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const jar = cookies(request);
  const serverUser = jar.acme_sid;

  if (url.pathname === '/robots.txt') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('User-agent: *\nAllow: /\n');
    return;
  }
  if (url.pathname === '/empty-403') {
    // Chrome shows its own error page for an error without a body: no script can run there.
    response.writeHead(403);
    response.end();
    return;
  }
  if (url.pathname === '/bounce') {
    // A switching page that sends signed-out visitors to a sign-in site elsewhere.
    const port = (request.headers.host ?? '').split(':')[1] ?? '80';
    response.writeHead(302, { location: `http://elsewhere.test:${port}/plain` });
    response.end();
    return;
  }
  if (url.pathname === '/spa-robots.txt') {
    // A site that answers every path with its app: scripts here must not run while switching.
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      page('App shell', '<p id="shell">app shell</p><script>localStorage.setItem("shell-ran", "yes")</script>'),
    );
    return;
  }
  if (url.pathname === '/api/login' && request.method === 'POST') {
    const email = (await readBody(request)).trim();
    const person = PEOPLE[email] ?? { id: `u-${email}`, name: email };
    const token = fakeJwt({ sub: person.id, email, exp: Math.floor(Date.now() / 1000) + 3600 });
    response.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': `acme_sid=${encodeURIComponent(email)}; Path=/; HttpOnly; Max-Age=86400; SameSite=Lax`,
    });
    response.end(
      JSON.stringify({
        access_token: token,
        refresh_token: `refresh-${person.id}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: person.id, email, user_metadata: { full_name: person.name } },
      }),
    );
    return;
  }
  if (url.pathname === '/api/csrf') {
    // A readable cookie set by an API response (CSRF tokens work this way), for the signed-in person.
    response.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': `acme_csrf=${encodeURIComponent(serverUser ?? 'anonymous')}; Path=/; SameSite=Lax`,
    });
    response.end('{}');
    return;
  }
  if (url.pathname === '/api/cors') {
    // An API on another origin of the site that allows the app's pages with credentials and the one
    // header its client sends (content-type); a preflight asking for any other header is refused.
    const origin = request.headers.origin;
    if (request.method === 'OPTIONS') {
      const asked = String(request.headers['access-control-request-headers'] ?? '')
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean);
      if (!origin || asked.some((name) => name !== 'content-type')) {
        response.writeHead(403);
        response.end();
        return;
      }
      response.writeHead(204, {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'content-type',
      });
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'application/json',
      ...(origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {}),
    });
    response.end(JSON.stringify({ user: serverUser ?? 'nobody', cookie: request.headers.cookie ?? '' }));
    return;
  }
  if (url.pathname === '/api/logout' && request.method === 'POST') {
    response.writeHead(204, { 'set-cookie': 'acme_sid=; Path=/; Max-Age=0' });
    response.end();
    return;
  }
  const project = /^\/project\/([a-z0-9]+)/.exec(url.pathname);
  if (project) {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(appPage(serverUser, `Project ${project[1]} | Acme`));
    return;
  }
  if (url.pathname === '/editor') {
    // A page with a text area: what is typed there is lost when the tab reloads.
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(appPage(serverUser, 'Editor | Acme').replace('</body>', '<textarea id="draft"></textarea></body>'));
    return;
  }
  if (url.pathname === '/leave') {
    // A page that warns before being left, as apps with unsaved changes do.
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      appPage(serverUser, 'Unsaved changes | Acme').replace(
        '</body>',
        `<script>addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = ''; });</script></body>`,
      ),
    );
    return;
  }
  if (url.pathname === '/' || url.pathname === '/dashboard' || url.pathname === '/login') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(appPage(serverUser));
    return;
  }
  if (url.pathname.startsWith('/spa/') || url.pathname === '/spa-late') {
    // A single-page app: signing in changes the address without reloading the page,
    // or (spa-late) the session is written a moment after the page has loaded.
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      page(
        'Acme SPA',
        `<p>Signed in: <strong id="spa-user">nobody</strong></p>
        <input id="email" type="email" /><button id="sign-in" type="button">Sign in</button>
        <script>
          async function signIn(email) {
            const response = await fetch('/api/login', { method: 'POST', body: email });
            localStorage.setItem('sb-acme-auth-token', JSON.stringify(await response.json()));
            document.getElementById('spa-user').textContent = email;
          }
          document.getElementById('sign-in').addEventListener('click', async () => {
            await signIn(document.getElementById('email').value);
            history.pushState({}, '', '/spa/home');
          });
          const late = new URLSearchParams(location.search).get('late');
          if (late) setTimeout(() => signIn(late), 1200);
        </script>`,
      ),
    );
    return;
  }
  if (url.pathname === '/plain') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(page('Plain site', '<h1>Just a page</h1>'));
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('Not found');
}

export type TestServer = { port: number; url: (host: string, path?: string) => string; close: () => Promise<void> };

export async function startTestServer(): Promise<TestServer> {
  const server: Server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });
  // A WebSocket that says who its handshake was signed in as (sites authenticate sockets by cookie).
  const sockets = new Set<Duplex>();
  server.on('upgrade', (request: IncomingMessage, socket: Duplex) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    const text = Buffer.from(cookies(request).acme_sid ?? 'nobody');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    // One unmasked text frame (short), then close.
    socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
    socket.end(Buffer.from([0x88, 0x00]));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    url: (host, path = '/') => `http://${host}:${port}${path}`,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
