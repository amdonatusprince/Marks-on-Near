// The sender's links, kept in this browser only, so a sent gift's link can be copied again.
// A link holds the claim secret, so it never leaves the browser except through the sender.

type Vault = { pending: Record<string, string>; links: Record<string, string> };

function keyOf(contract: string, account: string) {
  return `marks-gifts:${contract}:${account}`;
}

function read(contract: string, account: string): Vault {
  try {
    const raw = window.localStorage.getItem(keyOf(contract, account));
    const parsed = raw ? (JSON.parse(raw) as Partial<Vault>) : {};
    return { pending: parsed.pending ?? {}, links: parsed.links ?? {} };
  } catch {
    return { pending: {}, links: {} };
  }
}

function write(contract: string, account: string, vault: Vault) {
  window.localStorage.setItem(keyOf(contract, account), JSON.stringify(vault));
}

/** Save the secret under its public key before the transaction, so a closed tab loses nothing. */
export function holdSecret(
  contract: string,
  account: string,
  claimKey: string,
  secret: string,
) {
  const vault = read(contract, account);
  vault.pending[claimKey] = secret;
  write(contract, account, vault);
}

export function saveLink(
  contract: string,
  account: string,
  claimKey: string,
  giftId: number,
  link: string,
) {
  const vault = read(contract, account);
  delete vault.pending[claimKey];
  vault.links[String(giftId)] = link;
  write(contract, account, vault);
}

export function linksOf(contract: string, account: string) {
  return read(contract, account).links;
}

export function rememberLink(
  contract: string,
  account: string,
  giftId: number,
  link: string,
) {
  const vault = read(contract, account);
  vault.links[String(giftId)] = link;
  write(contract, account, vault);
}

export function forgetLink(contract: string, account: string, giftId: number) {
  const vault = read(contract, account);
  delete vault.links[String(giftId)];
  write(contract, account, vault);
}

export function pendingOf(contract: string, account: string) {
  return read(contract, account).pending;
}

export function storageWorks() {
  try {
    window.localStorage.setItem("marks-probe", "1");
    window.localStorage.removeItem("marks-probe");
    return true;
  } catch {
    return false;
  }
}
