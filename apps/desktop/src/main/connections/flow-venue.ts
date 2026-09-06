import type {
  ProtectiveOrder,
  ProtectionVenue,
  ProtectionStatus,
} from "./native-protection";
import { perpIocPrice } from "./hyperliquid-precision";
import { ClosedCandleCache } from "./market-cache";
import { ApiRequestError } from "@nktkas/hyperliquid/api/exchange";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import type { ExchangeConnection, ExecutionTarget } from "@catbots/contracts";
import type { FlowContext, OrderPlan, Fill } from "@catbots/strategy-runtime";
import { fetchMarketSnapshot } from "../nodes/market-snapshot";
export type VenueSnapshot = {
  context: Omit<FlowContext, "runId" | "deploymentId">;
  position: number;
  available: number;
  openOrders: number;
  openOrderIds?: string[];
  entryPrice?: number;
  sizeDecimals: number;
  asset: number;
};
export class OrderRejectedError extends Error {}
export interface FlowVenue {
  protection?: ProtectionVenue;
  snapshot(timeframes: string[]): Promise<VenueSnapshot>;
  reconcile?(
    order: OrderPlan,
    cloid: `0x${string}`,
  ): Promise<Fill | null | undefined>;
  place(
    order: OrderPlan,
    cloid: `0x${string}`,
    snapshot: VenueSnapshot,
  ): Promise<Fill | null>;
}
export class HyperliquidFlowVenue implements FlowVenue, ProtectionVenue {
  protection: ProtectionVenue = this;
  private cache = new ClosedCandleCache();
  private metadata?: {
    at: number;
    value: Awaited<ReturnType<InfoClient["meta"]>>;
  };
  private async meta() {
    if (this.metadata && Date.now() - this.metadata.at < 300000)
      return this.metadata.value;
    const value = await this.info.meta();
    this.metadata = { at: Date.now(), value };
    return value;
  }
  private info: InfoClient;
  private exchange: ExchangeClient;
  constructor(
    private connection: ExchangeConnection,
    private target: ExecutionTarget,
    key: `0x${string}`,
  ) {
    const transport = new HttpTransport({
      isTestnet: connection.environment === "testnet",
      timeout: 15000,
    });
    this.info = new InfoClient({ transport });
    this.exchange = new ExchangeClient({
      transport,
      wallet: privateKeyToAccount(key),
      ...(target.accountId.toLowerCase() === connection.owner.toLowerCase()
        ? {}
        : { defaultVaultAddress: target.accountId as `0x${string}` }),
    });
  }
  async snapshot(timeframes: string[]): Promise<VenueSnapshot> {
    const user = this.target.accountId as `0x${string}`,
      coin = this.target.market.replace(/-PERP$/, "");
    const [market, meta, state, orders, mode] = await Promise.all([
      fetchMarketSnapshot(
        { action: "market_snapshot", market: this.target.market, timeframes },
        (url, init) =>
          this.cache.fetch(
            this.connection.environment === "testnet"
              ? String(url).replace(
                  "https://api.hyperliquid.xyz",
                  "https://api.hyperliquid-testnet.xyz",
                )
              : url,
            init,
          ),
      ),
      this.meta(),
      this.info.clearinghouseState({ user }),
      this.info.openOrders({ user }),
      this.info.userAbstraction({ user }),
    ]);
    const asset = meta.universe.findIndex(
      (item) => item.name === coin && !item.isDelisted,
    );
    if (asset < 0) throw new Error("Market unavailable on target network");
    let equity = Number(state.marginSummary.accountValue),
      available = Number(state.withdrawable);
    if (mode === "portfolioMargin")
      throw new Error("Portfolio margin execution is not supported");
    if (mode === "unifiedAccount") {
      const spot = await this.info.spotClearinghouseState({ user });
      equity = Number(
        spot.balances.find((item) => "token" in item && item.token === 0)
          ?.total ?? 0,
      );
      available = Number(
        spot.tokenToAvailableAfterMaintenance?.find(
          (item) => item[0] === 0,
        )?.[1] ?? 0,
      );
    }
    const position = Number(
      state.assetPositions.find((item) => item.position.coin === coin)?.position
        .szi ?? 0,
    );
    if (
      ![equity, available, position, market.price].every(Number.isFinite) ||
      equity <= 0
    )
      throw new Error("Account balance unavailable or empty");
    return {
      context: {
        market: this.target.market,
        at: Date.now(),
        price: market.price,
        equity,
        candles: market.candles,
        fills: [],
        cancelledOrderIds: [],
      },
      position,
      available,
      openOrders: orders.length,
      openOrderIds: orders.map((order) => String(order.oid)),
      entryPrice: Number(
        state.assetPositions.find((item) => item.position.coin === coin)
          ?.position.entryPx ?? 0,
      ),
      sizeDecimals: meta.universe[asset].szDecimals,
      asset,
    };
  }
  async submitProtection(plan: ProtectiveOrder): Promise<string> {
    const meta = await this.meta(),
      coin = this.target.market.replace(/-PERP$/, "");
    const asset = meta.universe.findIndex(
      (item) => item.name === coin && !item.isDelisted,
    );
    if (asset < 0)
      throw new OrderRejectedError("Protection market unavailable");
    const decimals = meta.universe[asset].szDecimals,
      triggerPx = perpIocPrice(plan.triggerPrice, true, decimals, 0),
      buy = plan.order.side === "buy";
    const response = await this.exchange.order(
      {
        orders: [
          {
            a: asset,
            b: buy,
            s: String(plan.order.quantity),
            p: perpIocPrice(Number(triggerPx), buy, decimals, 0.1),
            r: true,
            t: { trigger: { isMarket: true, triggerPx, tpsl: plan.kind } },
            c: plan.cloid,
          },
        ],
        grouping: "positionTpsl",
      },
      { expiresAfter: Date.now() + 15000 },
    );
    const status = response.response.data.statuses[0];
    if (typeof status === "object" && "resting" in status)
      return String(status.resting.oid);
    throw new Error(
      "Protection placement not confirmed; reconcile before continuing",
    );
  }
  async inspectProtection(plan: ProtectiveOrder): Promise<ProtectionStatus> {
    const result = await this.info.orderStatus({
      user: this.target.accountId as `0x${string}`,
      oid: plan.cloid,
    });
    if (result.status !== "order") return { state: "unknown" };
    const exchangeId = String(result.order.order.oid);
    if (result.order.status === "open") return { state: "open", exchangeId };
    const fill = await this.reconcile(plan.order, plan.cloid);
    return fill === undefined
      ? { state: "unknown", exchangeId }
      : { state: "terminal", exchangeId, ...(fill ? { fill } : {}) };
  }
  async cancelProtection(plan: ProtectiveOrder): Promise<void> {
    const status = await this.inspectProtection(plan);
    if (status.state === "terminal") {
      if (status.fill)
        throw new Error(
          "Native protection filled during replacement; reconcile",
        );
      return;
    }
    if (status.state !== "open")
      throw new Error("Unknown protection order; cancellation not confirmed");
    const meta = await this.meta(),
      asset = meta.universe.findIndex(
        (item) => item.name === this.target.market.replace(/-PERP$/, ""),
      );
    await this.exchange.cancelByCloid(
      { cancels: [{ asset, cloid: plan.cloid }] },
      { expiresAfter: Date.now() + 15000 },
    );
    const after = await this.inspectProtection(plan);
    if (after.state !== "terminal" || after.fill)
      throw new Error("Protection changed during cancellation; reconcile");
  }
  async reconcile(
    order: OrderPlan,
    cloid: `0x${string}`,
  ): Promise<Fill | null | undefined> {
    const user = this.target.accountId as `0x${string}`;
    const result = await this.info.orderStatus({ user, oid: cloid });
    if (result.status !== "order") return undefined;
    const status = result.order.status;
    if (status === "rejected" || status.endsWith("Rejected")) return null;
    if (
      status !== "filled" &&
      status !== "canceled" &&
      !status.endsWith("Canceled")
    )
      return undefined;
    const detail = result.order.order;
    const expected = Number(detail.origSz) - Number(detail.sz);
    const fills = (await this.info.userFills({ user })).filter(
      (fill) => fill.oid === detail.oid,
    );
    const quantity = fills.reduce((sum, fill) => sum + Number(fill.sz), 0);
    if (
      !Number.isFinite(expected) ||
      expected < 0 ||
      Math.abs(quantity - expected) > 1e-8
    )
      return undefined;
    if (!quantity) return status === "filled" ? undefined : null;
    const price =
        fills.reduce(
          (sum, fill) => sum + Number(fill.sz) * Number(fill.px),
          0,
        ) / quantity,
      fee = fills.reduce((sum, fill) => sum + Number(fill.fee), 0);
    if (![quantity, price, fee].every(Number.isFinite) || price <= 0)
      return undefined;
    return {
      id: String(detail.oid),
      clientOrderId: order.clientOrderId,
      side: order.side,
      quantity,
      price,
      fee,
    };
  }
  async place(
    order: OrderPlan,
    cloid: `0x${string}`,
    snapshot: VenueSnapshot,
  ): Promise<Fill | null> {
    if (order.limitPrice !== undefined)
      throw new Error("Resting limit orders are not supported by this runtime");
    const price = perpIocPrice(
      snapshot.context.price,
      order.side === "buy",
      snapshot.sizeDecimals,
    );
    let result;
    try {
      result = await this.exchange.order(
        {
          orders: [
            {
              a: snapshot.asset,
              b: order.side === "buy",
              p: price,
              s: String(order.quantity),
              r: order.reduceOnly,
              t: { limit: { tif: "Ioc" } },
              c: cloid,
            },
          ],
          grouping: "na",
        },
        { expiresAfter: Date.now() + 15000 },
      );
    } catch (error) {
      if (error instanceof ApiRequestError)
        throw new OrderRejectedError(
          "Exchange rejected the order. Check size, margin and liquidity.",
        );
      throw new Error(
        "Order submission failed or outcome uncertain; inspect the exchange before restarting",
      );
    }
    const status = result.response.data.statuses[0];
    if (typeof status === "object" && "filled" in status) {
      const filled = status.filled;
      let fees;
      try {
        fees = (
          await this.info.userFills({
            user: this.target.accountId as `0x${string}`,
          })
        ).filter((item) => item.oid === filled.oid);
      } catch {
        throw new Error(
          "Order filled but fee reconciliation unavailable; inspect exchange",
        );
      }
      if (!fees.length)
        throw new Error(
          "Fill not yet available for reconciliation; inspect exchange",
        );
      const quantity = Number(filled.totalSz),
        average = Number(filled.avgPx),
        fee = fees.reduce((sum, item) => sum + Number(item.fee), 0),
        matched = fees.reduce((sum, item) => sum + Number(item.sz), 0);
      if (
        ![quantity, average, fee, matched].every(Number.isFinite) ||
        quantity <= 0 ||
        average <= 0 ||
        Math.abs(matched - quantity) > 1e-8
      )
        throw new Error("Incomplete fill reconciliation; inspect exchange");
      return {
        id: String(filled.oid),
        clientOrderId: order.clientOrderId,
        side: order.side,
        quantity,
        price: average,
        fee,
      };
    }
    if (typeof status === "object" && "error" in status)
      throw new OrderRejectedError(
        "Exchange rejected the order; check size, margin and liquidity",
      );
    throw new Error(
      "Order outcome uncertain; inspect the exchange before restarting",
    );
  }
}
