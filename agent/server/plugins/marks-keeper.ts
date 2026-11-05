import { defineNitroPlugin } from "@agent-native/core/server";

import { startKeeper } from "../marks/keeper";

export default defineNitroPlugin(() => {
  startKeeper();
});
