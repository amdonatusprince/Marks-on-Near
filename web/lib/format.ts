export function dollars(ticks: number, tickSize: string) {
  const scale = BigInt(1000000);
  const quote = BigInt(ticks) * BigInt(tickSize);
  const whole = quote / scale;
  const frac = (quote % scale).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function quote(atoms: string) {
  const scale = BigInt(1000000);
  const value = BigInt(atoms);
  const whole = value / scale;
  const frac = (value % scale).toString().padStart(2, "0").slice(0, 2);
  return `${whole}.${frac}`;
}
