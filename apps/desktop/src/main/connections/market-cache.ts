/** Cache only closed candles; price and account requests always remain fresh. */
export class ClosedCandleCache {
  private entries = new Map<string, { bucket: number; rows: any[] }>();
  constructor(private request: typeof fetch = fetch) {}
  fetch: typeof fetch = async (url, init) => {
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    if (body?.type !== "candleSnapshot") return this.request(url, init);
    const { coin, interval, endTime, startTime } = body.req;
    const duration =
      parseInt(interval) *
      (interval.endsWith("m")
        ? 60000
        : interval.endsWith("h")
          ? 3600000
          : 86400000);
    const bucket = Math.floor(endTime / duration),
      key = JSON.stringify([String(url), coin, interval]);
    const cached = this.entries.get(key);
    if (cached?.bucket === bucket) return Response.json(cached.rows);
    const response = await this.request(url, {
      ...init,
      body: JSON.stringify({
        ...body,
        req: {
          ...body.req,
          startTime: cached?.rows.length
            ? Math.max(startTime, cached.rows.at(-1).t)
            : startTime,
        },
      }),
    });
    if (!response.ok) return response;
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return Response.json(data);
    const merged = new Map<number, any>();
    for (const row of [...(cached?.rows ?? []), ...data]) {
      if (
        !row ||
        !Number.isFinite(row.t) ||
        !Number.isFinite(row.T) ||
        row.s !== coin ||
        row.i !== interval
      )
        return Response.json(data);
      if (row.T < endTime && row.t >= startTime) merged.set(row.t, row);
    }
    const rows = [...merged.values()].sort((a, b) => a.t - b.t).slice(-5000);
    // Never extend freshness when no newly closed candle arrived.
    if (rows.length && endTime - rows.at(-1).T <= duration * 2) {
      if (this.entries.size >= 32 && !this.entries.has(key))
        this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(key, { bucket, rows });
    }
    return Response.json(rows);
  };
}
