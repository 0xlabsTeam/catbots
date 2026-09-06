import { createHash } from "node:crypto";
import type { Fill, OrderPlan } from "@catbots/strategy-runtime";
export type ProtectiveOrder = {
  cloid: `0x${string}`;
  kind: "tp" | "sl";
  triggerPrice: number;
  order: OrderPlan;
  exchangeId?: string;
  state: "planned" | "open" | "terminal" | "unknown";
};
export type ProtectionState = {
  generation: number;
  quantity: number;
  entry: number;
  side: "buy" | "sell";
  orders: ProtectiveOrder[];
  retiring: ProtectiveOrder[];
};
export type ProtectionStatus = {
  state: "open" | "terminal" | "unknown";
  exchangeId?: string;
  fill?: Fill;
};
export interface ProtectionVenue {
  submitProtection(order: ProtectiveOrder): Promise<string>;
  inspectProtection(order: ProtectiveOrder): Promise<ProtectionStatus>;
  cancelProtection(order: ProtectiveOrder): Promise<void>;
}
export function protectionPlan(
  deployment: string,
  generation: number,
  position: number,
  entry: number,
  tp: number,
  sl: number,
): ProtectionState {
  const side: "buy" | "sell" = position > 0 ? "sell" : "buy",
    sign = Math.sign(position),
    quantity = Math.abs(position);
  if (
    ![quantity, entry, tp, sl].every(Number.isFinite) ||
    quantity <= 0 ||
    entry <= 0 ||
    tp <= 0 ||
    sl <= 0
  )
    throw new Error("Invalid native protection configuration");
  const orders = (["sl", "tp"] as const).map((kind) => {
    const triggerPrice =
      entry * (1 + (sign * (kind === "tp" ? tp : -sl)) / 100);
    if (triggerPrice <= 0)
      throw new Error("Native trigger price must be positive");
    const id = `${deployment}:protection:${generation}:${kind}`;
    return {
      cloid:
        `0x${createHash("sha256").update(id).digest("hex").slice(0, 32)}` as `0x${string}`,
      kind,
      triggerPrice,
      order: {
        clientOrderId: id,
        side,
        quantity,
        reduceOnly: true,
        purpose: "exit" as const,
      },
      state: "planned" as const,
    };
  });
  return { generation, quantity, entry, side, orders, retiring: [] };
}
/** Journal before every submission. Never retry an ambiguous request. Replace
 * protection before canceling old orders; all generations are reduce-only. */
export async function installProtection(
  state: ProtectionState,
  venue: ProtectionVenue,
  persist: () => void,
) {
  for (const order of state.orders) {
    if (order.state === "planned") {
      order.state = "unknown";
      persist();
      order.exchangeId = await venue.submitProtection(order);
      order.state = "open";
      persist();
    } else {
      const status = await venue.inspectProtection(order);
      order.state = status.state;
      order.exchangeId = status.exchangeId ?? order.exchangeId;
      persist();
      if (status.state !== "open")
        throw new Error("Protection outcome requires reconciliation");
    }
  }
  for (const old of state.retiring) {
    await venue.cancelProtection(old);
    old.state = "terminal";
    persist();
  }
  state.retiring = [];
  persist();
}
