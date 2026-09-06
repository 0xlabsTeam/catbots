import { expect, it, vi } from "vitest";
import {
  installProtection,
  protectionPlan,
  type ProtectionVenue,
} from "../src/main/connections/native-protection";
it("uses deterministic reduce-only SL and TP for long and short positions", () => {
  const long = protectionPlan("run", 1, 2, 100, 10, 5);
  expect(
    long.orders.map((o) => [
      o.kind,
      o.triggerPrice,
      o.order.side,
      o.order.quantity,
      o.order.reduceOnly,
    ]),
  ).toEqual([
    ["sl", 95, "sell", 2, true],
    ["tp", 110.00000000000001, "sell", 2, true],
  ]);
  const short = protectionPlan("run", 1, -2, 100, 10, 5);
  expect(short.orders[0]).toMatchObject({
    triggerPrice: 105,
    order: { side: "buy" },
  });
  expect(protectionPlan("run", 1, 2, 100, 10, 5).orders[0].cloid).toBe(
    long.orders[0].cloid,
  );
});
it("journals before submission and confirms replacements before canceling old protection", async () => {
  const events: string[] = [];
  const state = protectionPlan("run", 2, 3, 101, 10, 5);
  state.retiring = protectionPlan("run", 1, 2, 100, 10, 5).orders.map((o) => ({
    ...o,
    state: "open",
  }));
  const venue: ProtectionVenue = {
    submitProtection: vi.fn(async (order) => {
      expect(order.state).toBe("unknown");
      expect(events.at(-1)).toBe("persist");
      events.push("submit");
      return order.cloid;
    }),
    inspectProtection: vi.fn(async () => ({ state: "open" as const })),
    cancelProtection: vi.fn(async () => {
      expect(state.orders.every((o) => o.state === "open")).toBe(true);
      events.push("cancel");
    }),
  };
  await installProtection(state, venue, () => events.push("persist"));
  expect(venue.submitProtection).toHaveBeenCalledTimes(2);
  expect(venue.cancelProtection).toHaveBeenCalledTimes(2);
  expect(state.retiring).toEqual([]);
});
it("never blindly resubmits an uncertain trigger placement", async () => {
  const state = protectionPlan("run", 1, 2, 100, 10, 5);
  const venue: ProtectionVenue = {
    submitProtection: vi.fn(async () => {
      throw Error("timeout");
    }),
    inspectProtection: vi.fn(async () => ({ state: "unknown" as const })),
    cancelProtection: vi.fn(),
  };
  await expect(installProtection(state, venue, () => {})).rejects.toThrow(
    "timeout",
  );
  expect(state.orders[0].state).toBe("unknown");
  await expect(installProtection(state, venue, () => {})).rejects.toThrow(
    "reconciliation",
  );
  expect(venue.submitProtection).toHaveBeenCalledTimes(1);
});
