import { expect, it, vi } from "vitest";
import { ClosedCandleCache } from "../src/main/connections/market-cache";
it("reuses closed candles and incrementally requests new bars, scoped by network", async () => {
  const candle = (t: number) => ({
    t,
    T: t + 59999,
    s: "SOL",
    i: "1m",
    o: "1",
    h: "1",
    l: "1",
    c: "1",
    v: "1",
  });
  const request = vi.fn(async () =>
    Response.json([candle(0), candle(60000), candle(120000)]),
  );
  const cache = new ClosedCandleCache(request as typeof fetch);
  const args = (endTime: number) => ({
    method: "POST",
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin: "SOL", interval: "1m", startTime: 0, endTime },
    }),
  });
  expect(
    await (await cache.fetch("https://testnet/info", args(120001))).json(),
  ).toHaveLength(2);
  await cache.fetch("https://testnet/info", args(130000));
  expect(request).toHaveBeenCalledTimes(1);
  expect(
    await (await cache.fetch("https://testnet/info", args(180001))).json(),
  ).toHaveLength(3);
  const init = (request.mock.calls as unknown as [string, RequestInit][])[1][1];
  expect(JSON.parse(String(init.body)).req.startTime).toBe(60000);
  await cache.fetch("https://mainnet/info", args(180001));
  expect(request).toHaveBeenCalledTimes(3);
});
it("does not cache price requests or swallow fetch failures", async () => {
  const request = vi.fn(
    async () => new Response("unavailable", { status: 503 }),
  );
  const cache = new ClosedCandleCache(request as typeof fetch);
  const args = { body: JSON.stringify({ type: "metaAndAssetCtxs" }) };
  expect((await cache.fetch("https://testnet/info", args)).status).toBe(503);
  await cache.fetch("https://testnet/info", args);
  expect(request).toHaveBeenCalledTimes(2);
});
