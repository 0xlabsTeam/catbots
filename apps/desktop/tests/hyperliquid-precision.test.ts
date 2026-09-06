import { expect, it } from "vitest";
import {
  perpIocPrice,
  perpSize,
} from "../src/main/connections/hyperliquid-precision";
it("preserves valid decimal lots without floating point truncation", () => {
  expect(perpSize(0.29, 2)).toBe(0.29);
  expect(perpSize(1.0001, 3)).toBe(1);
  expect(perpSize(0.000001, 6)).toBe(0.000001);
  expect(perpSize(0.001, 2)).toBe(0);
});
it("honors official perp significant-digit and decimal constraints without widening tolerance", () => {
  for (const reference of [0.001234, 0.012345, 1.23456, 1234.56, 123456])
    for (const size of [0, 1, 3, 5])
      for (const buy of [true, false]) {
        if (reference < 0.1 && size === 5) continue;
        const price = perpIocPrice(reference, buy, size);
        const value = Number(price);
        expect(value).toBeGreaterThan(0);
        expect(price).not.toContain("e");
        expect((price.split(".")[1] ?? "").length).toBeLessThanOrEqual(
          6 - size,
        );
        if (!Number.isInteger(value))
          expect(
            price.replace(".", "").replace(/^0+/, "").length,
          ).toBeLessThanOrEqual(5);
        if (buy) expect(value).toBeLessThanOrEqual(reference * 1.005);
        else expect(value).toBeGreaterThanOrEqual(reference * 0.995);
      }
  expect(perpIocPrice(123456, true, 0, 0)).toBe("123456");
});
