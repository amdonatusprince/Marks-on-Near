export function dollars(ticks: number, tickSize: string) {
  const scale = BigInt(1000000);
  const quote = BigInt(ticks) * BigInt(tickSize);
  const whole = quote / scale;
  const frac = (quote % scale).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function money(atoms: bigint | string) {
  const value = typeof atoms === "string" ? BigInt(atoms) : atoms;
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const whole = abs / BigInt(1000000);
  const frac = (abs % BigInt(1000000)).toString().padStart(6, "0").slice(0, 2);
  return `${negative ? "-" : ""}$${whole.toString()}.${frac}`;
}

export function price(ticks: number, tickSize: string) {
  return money(BigInt(ticks) * BigInt(tickSize));
}

export function openInterest(lots: number, ticks: number, tickSize: string) {
  return money(BigInt(lots) * BigInt(ticks) * BigInt(tickSize));
}

export function fundingWords(bps: number) {
  if (bps === 0) return "None";
  const percent = (Math.abs(bps) / 100).toFixed(2);
  return bps > 0 ? `Longs pay ${percent}%` : `Shorts pay ${percent}%`;
}

export function quote(atoms: string) {
  const scale = BigInt(1000000);
  const value = BigInt(atoms);
  const whole = value / scale;
  const frac = (value % scale).toString().padStart(2, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

export function atomsFromDollars(text: string): bigint | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d*)?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const digits = `${frac}000000`.slice(0, 6);
  return BigInt(whole) * BigInt(1000000) + BigInt(digits);
}

export function ticksFromDollars(text: string, tickSize: string): bigint | null {
  const atoms = atomsFromDollars(text);
  const tick = BigInt(tickSize);
  if (atoms === null || tick <= BigInt(0)) return null;
  const ticks = atoms / tick;
  return ticks > BigInt(0) ? ticks : null;
}

export function liquidationPrice(
  collateral: bigint,
  baseLots: bigint,
  entry: bigint,
  maintenanceBps: number,
) {
  if (baseLots === BigInt(0) || maintenanceBps >= 10_000 || entry <= BigInt(0)) return null;
  const maintenance = BigInt(maintenanceBps);
  const numerator = (collateral - baseLots * entry) * BigInt(10_000);
  const denominator =
    baseLots > BigInt(0)
      ? baseLots * (maintenance - BigInt(10_000))
      : -baseLots * (maintenance + BigInt(10_000));
  if (denominator === BigInt(0)) return null;
  const price = numerator / denominator;
  return price > BigInt(0) ? price : null;
}

export function sizedOrder(amount: string, ticks: bigint, tickSize: string) {
  const atoms = atomsFromDollars(amount);
  const per = ticks * BigInt(tickSize);
  if (atoms === null || ticks <= BigInt(0) || per <= BigInt(0)) return null;
  const lots = atoms / per;
  return { lots, cost: lots * per, margin: (lots * per) / BigInt(10) };
}
