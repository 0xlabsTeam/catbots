import { randomUUID } from "node:crypto";
import { ConnectionError, approvalRejection } from "./errors";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, parseSignature, type TypedData } from "viem";
import { ApproveAgentTypes } from "@nktkas/hyperliquid/api/exchange";
import type { ExchangeConnection } from "@catbots/contracts";
export type Cipher = {
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
};
type RecordValue = {
  key: `0x${string}`;
  owner: string;
  environment: string;
  nonce: number;
  name: string;
  verifiedAt?: string;
};
type Slots = {
  active?: RecordValue;
  pending?: RecordValue;
  retired: RecordValue[];
};
export class ConnectionAuthorization {
  constructor(
    private path: string,
    private cipher: Cipher,
    private request: typeof fetch = fetch,
  ) {}
  private read(): Record<string, Slots> {
    try {
      const raw = existsSync(this.path)
        ? JSON.parse(this.cipher.decrypt(readFileSync(this.path)))
        : {};
      return Object.fromEntries(
        Object.entries(raw).map(([id, value]) => {
          const record = value as RecordValue & Slots;
          return [
            id,
            record.key
              ? {
                  ...(record.verifiedAt
                    ? { active: record }
                    : { pending: record }),
                  retired: [],
                }
              : record,
          ];
        }),
      );
    } catch {
      throw new ConnectionError("CONNECTION_KEYSTORE_UNAVAILABLE");
    }
  }
  private write(records: Record<string, Slots>) {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(
        `${this.path}.tmp`,
        this.cipher.encrypt(JSON.stringify(records)),
        { mode: 0o600 },
      );
      renameSync(`${this.path}.tmp`, this.path);
    } catch {
      throw new ConnectionError("CONNECTION_KEYSTORE_UNAVAILABLE");
    }
  }
  private typed(record: RecordValue) {
    return {
      domain: {
        name: "HyperliquidSignTransaction",
        version: "1",
        chainId: 42161,
        verifyingContract:
          "0x0000000000000000000000000000000000000000" as const,
      },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ] as const,
        ...ApproveAgentTypes,
      } as TypedData,
      primaryType: "HyperliquidTransaction:ApproveAgent" as const,
      message: {
        hyperliquidChain:
          record.environment === "production" ? "Mainnet" : "Testnet",
        agentAddress: privateKeyToAccount(record.key).address,
        agentName: record.name,
        nonce: record.nonce,
      },
    };
  }
  prepare(connection: ExchangeConnection) {
    if (connection.adapterId !== "hyperliquid")
      throw new Error("Wallet authorization unavailable for this adapter");
    const records = this.read(),
      slots = records[connection.id] ?? { retired: [] };
    let record = slots.pending;
    if (
      !record ||
      record.owner !== connection.owner ||
      record.environment !== connection.environment ||
      Date.now() - record.nonce >= 600000
    ) {
      if (record) slots.retired.push(record);
      record = {
        key: generatePrivateKey(),
        owner: connection.owner,
        environment: connection.environment,
        nonce: Date.now(),
        name: `cb-${connection.id.slice(0, 8)}-${randomUUID().slice(0, 6)} valid_until ${Date.now() + 30 * 86400000}`,
      };
      slots.pending = record;
      records[connection.id] = slots;
      this.write(records);
    }
    return {
      connectionId: connection.id,
      owner: connection.owner,
      environment: connection.environment,
      typedData: this.typed(record),
    };
  }
  async complete(connection: ExchangeConnection, signature: `0x${string}`) {
    const record = this.read()[connection.id]?.pending;
    if (
      !record ||
      record.owner !== connection.owner ||
      record.environment !== connection.environment ||
      Date.now() - record.nonce > 600000
    )
      throw new ConnectionError("CONNECTION_AUTHORIZATION_EXPIRED");
    const typed = this.typed(record);
    let signer: string;
    try {
      signer = await recoverTypedDataAddress({ ...typed, signature });
    } catch {
      throw new ConnectionError("CONNECTION_SIGNATURE_REJECTED");
    }
    if (signer.toLowerCase() !== connection.owner.toLowerCase())
      throw new ConnectionError("CONNECTION_WALLET_MISMATCH");
    const parts = parseSignature(signature);
    await this.post(connection, "exchange", {
      action: {
        type: "approveAgent",
        signatureChainId: "0xa4b1",
        ...typed.message,
      },
      nonce: record.nonce,
      signature: {
        r: parts.r,
        s: parts.s,
        v: Number(parts.v ?? BigInt(27 + parts.yParity!)),
      },
    });
    await this.verify(connection);
    if (this.read()[connection.id]?.active?.key !== record.key)
      throw new ConnectionError("CONNECTION_INVALID_RESPONSE");
    return true;
  }
  private async post(
    connection: ExchangeConnection,
    path: string,
    body: unknown,
  ) {
    const root =
      connection.environment === "production"
        ? "https://api.hyperliquid.xyz"
        : "https://api.hyperliquid-testnet.xyz";
    let response: Response;
    try {
      response = await this.request(`${root}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ConnectionError("CONNECTION_EXCHANGE_UNREACHABLE");
    }
    if (response.status === 429)
      throw new ConnectionError("CONNECTION_RATE_LIMITED");
    if (!response.ok)
      throw new ConnectionError("CONNECTION_EXCHANGE_UNREACHABLE");
    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new ConnectionError("CONNECTION_INVALID_RESPONSE");
    }
    if (path === "exchange" && data.status !== "ok")
      throw approvalRejection(data.response);
    return data;
  }

  async executionKey(connection: ExchangeConnection): Promise<`0x${string}`> {
    const slots = this.read()[connection.id],
      record = slots?.active;
    if (
      !record ||
      record.owner !== connection.owner ||
      record.environment !== connection.environment
    )
      throw new ConnectionError("CONNECTION_AUTHORIZATION_EXPIRED");
    if (!(await this.isAuthorized(connection, record)))
      throw new ConnectionError("CONNECTION_AUTHORIZATION_EXPIRED");
    return record.key;
  }
  private async isAuthorized(
    connection: ExchangeConnection,
    record: RecordValue,
  ) {
    if (
      record.owner !== connection.owner ||
      record.environment !== connection.environment
    )
      return false;
    const agents = await this.post(connection, "info", {
      type: "extraAgents",
      user: connection.owner,
    });
    if (!Array.isArray(agents))
      throw new ConnectionError("CONNECTION_INVALID_RESPONSE");
    const address = privateKeyToAccount(record.key).address.toLowerCase();
    return agents.some(
      (agent) =>
        typeof agent.address === "string" &&
        agent.address.toLowerCase() === address &&
        (agent.validUntil === null ||
          (typeof agent.validUntil === "number" &&
            agent.validUntil > Date.now())),
    );
  }
  async verify(connection: ExchangeConnection, promotePending = true) {
    const slots = this.read()[connection.id];
    if (!slots) return false;
    if (promotePending && slots.pending && (await this.isAuthorized(connection, slots.pending))) {
      const records = this.read(),
        latest = records[connection.id];
      if (latest.pending?.key === slots.pending.key) {
        if (latest.active) latest.retired.push(latest.active);
        latest.active = {
          ...latest.pending,
          verifiedAt: new Date().toISOString(),
        };
        delete latest.pending;
        this.write(records);
        return true;
      }
      return false;
    }
    return slots.active ? this.isAuthorized(connection, slots.active) : false;
  }
}
