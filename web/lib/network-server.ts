import { NETWORK_COOKIE, parseNetwork } from "@/lib/network";
import { cookies } from "next/headers";

export async function selectedNetwork() {
  const jar = await cookies();
  return parseNetwork(jar.get(NETWORK_COOKIE)?.value);
}
