import { get } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWebServer } from '../src/main/web/http-server';

let server: Awaited<ReturnType<typeof startWebServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });
async function start(invoke = vi.fn().mockResolvedValue({ saved: true })) {
  server = await startWebServer({ port: 0, invoke, subscribe: () => () => undefined,
    asset: async () => ({ body: Buffer.from('<html>Catbots</html>'), contentType: 'text/html' }),
  });
  const session = await fetch(`${server.origin}/api/session`, { headers: { 'x-catbots-client': '1' } });
  const cookie = session.headers.get('set-cookie')!.split(';')[0];
  return { origin: server.origin, cookie, invoke };
}

describe('local web transport', () => {
  it('requires a session, same-origin JSON and a client header before dispatching', async () => {
    const { origin, cookie, invoke } = await start();
    const post = (headers: Record<string, string>) => fetch(`${origin}/api/rpc`, {
      method: 'POST', headers, body: JSON.stringify({ method: 'bots:create-draft', input: { name: 'Web bot' } }),
    });
    expect((await post({ origin, 'content-type': 'application/json', 'x-catbots-client': '1' })).status).toBe(401);
    expect((await post({ cookie, origin: 'https://attacker.example', 'content-type': 'application/json', 'x-catbots-client': '1' })).status).toBe(403);
    expect((await post({ cookie, origin, 'content-type': 'application/json' })).status).toBe(403);
    expect(invoke).not.toHaveBeenCalled();
    expect(await (await post({ cookie, origin, 'content-type': 'application/json', 'x-catbots-client': '1' })).json()).toEqual({ result: { saved: true } });
    expect(invoke).toHaveBeenCalledWith('bots:create-draft', { name: 'Web bot' });
  });

  it('rejects cross-site session creation and forged hosts', async () => {
    const { origin } = await start();
    expect((await fetch(`${origin}/api/session`, { headers: { 'x-catbots-client': '1', 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    const status = await new Promise<number | undefined>((resolve, reject) => { get(origin, { headers: { host: 'attacker.example' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject); });
    expect(status).toBe(403);
  });

  it('does not return backend error text or credentials', async () => {
    const { origin, cookie } = await start(vi.fn().mockRejectedValue(new Error('provider secret-key')));
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', 'x-catbots-client': '1' }, body: JSON.stringify({ method: 'workbench:send-message' }) });
    expect(await response.text()).toBe('{"error":"WEB_REQUEST_FAILED"}');
  });

  it('serves the real browser entry on the root path', async () => {
    const { origin } = await start();
    expect(await (await fetch(origin)).text()).toContain('Catbots');
  });
});
