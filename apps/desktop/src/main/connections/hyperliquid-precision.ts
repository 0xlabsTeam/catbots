/** Hyperliquid validator perps: <= 5 significant price digits, <= 6-szDecimals decimals.
 * Integer prices are valid regardless of significant digits. Never round an IOC
 * limit beyond the requested tolerance. Quantize in base 10, not binary floats.
 */
function quantize(value: number, places: number, up: boolean): string {
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isInteger(places) ||
    places < 0 ||
    places > 6
  )
    throw new Error("Invalid exchange precision");
  const [mantissa, exponent = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const coefficient = BigInt(whole + fraction),
    power = Number(exponent) - fraction.length + places;
  let units: bigint;
  if (power >= 0) units = coefficient * 10n ** BigInt(power);
  else {
    const divisor = 10n ** BigInt(-power);
    units =
      coefficient / divisor + (up && coefficient % divisor !== 0n ? 1n : 0n);
  }
  const digits = units.toString().padStart(places + 1, "0");
  return places
    ? `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(
        /\.?0+$/,
        "",
      )
    : digits;
}
export function perpSize(quantity: number, sizeDecimals: number): number {
  return Number(quantize(quantity, sizeDecimals, false));
}
export function perpIocPrice(
  reference: number,
  buy: boolean,
  sizeDecimals: number,
  tolerance = 0.005,
): string {
  if (
    !Number.isInteger(sizeDecimals) ||
    sizeDecimals < 0 ||
    sizeDecimals > 6 ||
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    tolerance >= 1
  )
    throw new Error("Invalid perp parameters");
  const bound = reference * (buy ? 1 + tolerance : 1 - tolerance);
  if (!Number.isFinite(bound) || bound <= 0)
    throw new Error("Invalid market price");
  const places = Math.max(
    0,
    Math.min(6 - sizeDecimals, 4 - Math.floor(Math.log10(bound))),
  );
  const price = quantize(bound, places, !buy);
  if (Number(price) <= 0) throw new Error("Price below market tick");
  return price;
}
