/** Tell every open Marks panel to read the chain again. Fired again while the RPC catches up. */
export function notifyTraded() {
  const fire = () => window.dispatchEvent(new Event("marks-traded"));
  fire();
  window.setTimeout(fire, 1600);
  window.setTimeout(fire, 4500);
}
