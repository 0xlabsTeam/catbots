export type PerpMarket = Readonly<{
  market: string;
  baseAsset: string;
  quoteAsset: string;
  active: boolean;
  sizeDecimals: number;
  maximumLeverage: number;
}>;

export type PerpBalance = Readonly<{
  asset: string;
  total: string;
  available: string;
}>;

export type PerpPosition = Readonly<{
  market: string;
  side: 'long' | 'short';
  notionalUsd: string;
  quantity: string;
  entryPrice: string;
  leverage: number;
}>;

type IntentIdentity = Readonly<{
  market: string;
  clientOrderId: string;
}>;

export type OpenPositionIntent = IntentIdentity & Readonly<{
  type: 'open_position';
  side: 'long' | 'short';
  orderType: 'market';
  notionalUsd: string;
  leverage: number;
}>;

export type ClosePositionIntent = IntentIdentity & Readonly<{
  type: 'close_position';
  percent: number;
}>;

export type NormalizedOrderIntent = OpenPositionIntent | ClosePositionIntent;

export type CancelOrderIntent = Readonly<{
  market: string;
  clientOrderId: string;
}>;

export type UpdateLeverageIntent = Readonly<{
  market: string;
  leverage: number;
}>;

export type ExecutionReceipt = Readonly<{
  status: 'acknowledged' | 'filled' | 'rejected' | 'unknown' | 'partially_filled_cancelled' | 'partially_filled_rejected';
  clientOrderId: string;
  venueOrderId?: string;
  errorCode?: string;
  filledQuantity?: string;
  originalQuantity?: string;
  filledNotionalUsd?: string;
}>;

export type ExecutionEvent = Readonly<{
  id: string;
  clientOrderId: string;
  type: 'acknowledged' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected' | 'partially_filled_cancelled' | 'partially_filled_rejected';
  occurredAt: string;
  filledQuantity?: string;
  averagePrice?: string;
  originalQuantity?: string;
  filledNotionalUsd?: string;
}>;

export type ExecutionEventPage = Readonly<{
  events: readonly ExecutionEvent[];
  cursor: string | null;
}>;

export interface PerpDexAdapter {
  getMarkets(signal: AbortSignal): Promise<readonly PerpMarket[]>;
  getBalances(account: string, signal: AbortSignal): Promise<readonly PerpBalance[]>;
  getPositions(account: string, signal: AbortSignal): Promise<readonly PerpPosition[]>;
  placeOrder(order: NormalizedOrderIntent, signal: AbortSignal): Promise<ExecutionReceipt>;
  cancelOrder(order: CancelOrderIntent, signal: AbortSignal): Promise<ExecutionReceipt>;
  updateLeverage(input: UpdateLeverageIntent, signal: AbortSignal): Promise<ExecutionReceipt>;
  closePosition(input: ClosePositionIntent, signal: AbortSignal): Promise<ExecutionReceipt>;
  getExecutionEvents(cursor: string | null, signal: AbortSignal): Promise<ExecutionEventPage>;
  getOrderExecutionEvents?(clientOrderIds: readonly string[], signal: AbortSignal): Promise<ExecutionEventPage>;
}
