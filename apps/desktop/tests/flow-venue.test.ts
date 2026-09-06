import { beforeEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@nktkas/hyperliquid/api/exchange";
const mock = vi.hoisted(() => ({
  order: vi.fn(),
  orderStatus: vi.fn(),
  userFills: vi.fn(),
  meta: vi.fn(),
  cancelByCloid: vi.fn(),
}));
vi.mock("@nktkas/hyperliquid", () => ({
  HttpTransport: class {},
  InfoClient: class {
    orderStatus = mock.orderStatus;
    userFills = mock.userFills;
    meta = mock.meta;
  },
  ExchangeClient: class {
    order = mock.order;
    cancelByCloid = mock.cancelByCloid;
  },
}));
import {
  HyperliquidFlowVenue,
  OrderRejectedError,
  type VenueSnapshot,
} from "../src/main/connections/flow-venue";
import type { ExchangeConnection, ExecutionTarget } from "@catbots/contracts";
const venue = () =>
  new HyperliquidFlowVenue(
    {
      environment: "testnet",
      owner: "0x" + "1".repeat(40),
    } as ExchangeConnection,
    { accountId: "0x" + "1".repeat(40), market: "SOL-PERP" } as ExecutionTarget,
    `0x${"1".repeat(64)}`,
  );
const plan = {
  clientOrderId: "local",
  side: "buy" as const,
  quantity: 0.2,
  reduceOnly: false,
  purpose: "entry" as const,
};
const snapshot = {
  asset: 1,
  sizeDecimals: 2,
  context: { price: 100 },
} as VenueSnapshot;
beforeEach(() => vi.resetAllMocks());
it("distinguishes definitive SDK rejection from an uncertain transport failure", async () => {
  mock.order.mockRejectedValueOnce(
    new ApiRequestError({ status: "err", response: "Rejected" }),
  );
  await expect(venue().place(plan, "0x123", snapshot)).rejects.toBeInstanceOf(
    OrderRejectedError,
  );
  mock.order.mockRejectedValueOnce(new Error("timeout"));
  await expect(
    venue().place(plan, "0x123", snapshot),
  ).rejects.not.toBeInstanceOf(OrderRejectedError);
});
it("requires terminal order status and complete matching fills before reconciliation", async () => {
  mock.orderStatus.mockResolvedValue({ status: "unknownOid" });
  expect(await venue().reconcile(plan, "0x123")).toBeUndefined();
  mock.orderStatus.mockResolvedValue({
    status: "order",
    order: { status: "filled", order: { oid: 123, origSz: "0.2", sz: "0" } },
  });
  mock.userFills.mockResolvedValue([]);
  expect(await venue().reconcile(plan, "0x123")).toBeUndefined();
  mock.userFills.mockResolvedValue([
    { oid: 123, sz: "0.2", px: "100", fee: "0.01" },
  ]);
  expect(await venue().reconcile(plan, "0x123")).toMatchObject({
    quantity: 0.2,
    price: 100,
    fee: 0.01,
  });
  expect(mock.order).not.toHaveBeenCalled();
});
it("signs a bounded-lifetime IOC request with canonical price and reduce-only intent", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1000000);
  try {
    mock.order.mockRejectedValue(
      new ApiRequestError({ status: "err", response: "Rejected" }),
    );
    await expect(
      venue().place({ ...plan, reduceOnly: true }, "0x123", snapshot),
    ).rejects.toBeInstanceOf(OrderRejectedError);
    expect(mock.order).toHaveBeenCalledWith(
      expect.objectContaining({
        grouping: "na",
        orders: [
          expect.objectContaining({
            p: "100.49",
            s: "0.2",
            r: true,
            t: { limit: { tif: "Ioc" } },
          }),
        ],
      }),
      { expiresAfter: 1015000 },
    );
  } finally {
    now.mockRestore();
  }
});

it("submits native position protection as a reduce-only trigger and requires confirmation", async () => {
  mock.meta.mockResolvedValue({ universe: [{ name: "SOL", szDecimals: 2 }] });
  mock.order.mockResolvedValue({
    response: { data: { statuses: [{ resting: { oid: 77 } }] } },
  });
  const { protectionPlan } =
    await import("../src/main/connections/native-protection");
  const trigger = protectionPlan("run", 1, 0.2, 100, 10, 5).orders[0];
  expect(await venue().submitProtection(trigger)).toBe("77");
  expect(mock.order).toHaveBeenCalledWith(
    expect.objectContaining({
      grouping: "positionTpsl",
      orders: [
        expect.objectContaining({
          r: true,
          b: false,
          s: "0.2",
          t: { trigger: { isMarket: true, triggerPx: "95", tpsl: "sl" } },
        }),
      ],
    }),
    expect.objectContaining({ expiresAfter: expect.any(Number) }),
  );
});
