// A long-lived Marks process uses the same on-disk database as local dev.
// The framework otherwise treats that file as an unconfigured production
// deploy and refuses it. A host that sets a serverless marker is still refused.
(
  globalThis as { __AGENT_NATIVE_EMBEDDED_RUNTIME__?: boolean }
).__AGENT_NATIVE_EMBEDDED_RUNTIME__ = true;

export default function marksData() {}
