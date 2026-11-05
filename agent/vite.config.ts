import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const marksRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Dev mode stamps data-agent-native-motion-source-file onto every lowercase JSX
// tag. React Three Fiber reads that as a property path and throws, so the
// envelope scene never draws. These tags are Three.js objects, not DOM.
const R3F_TAG =
  /^(mesh|group|points|line|sprite|primitive|color|fog|ambientLight|directionalLight|pointLight|spotLight|hemisphereLight)$/;

function marksR3fMotionAttributes(): Plugin {
  return {
    name: "marks-r3f-motion-attributes",
    // Runs after the dev provenance plugin adds the attributes, and before JSX
    // is compiled, so the tags below are still written as <mesh> rather than jsx().
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?", 1)[0] ?? id;
      if (!file.endsWith("EnvelopeScene.tsx")) return null;
      if (!code.includes("data-agent-native-motion-source-file")) return null;
      const next = code.replace(
        /<([A-Za-z][\w]*)([^<>]*)>/g,
        (full, tag: string, attrs: string) => {
          if (!R3F_TAG.test(tag) && !/(?:Geometry|Material|Light)$/.test(tag)) {
            return full;
          }
          const cleaned = attrs.replace(
            /\s+data-agent-native-(?:node-id|motion-source-file|motion-source-hash)="[^"]*"/g,
            "",
          );
          return cleaned === attrs ? full : `<${tag}${cleaned}>`;
        },
      );
      return next === code ? null : next;
    },
  };
}

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];
export default defineConfig({
  // One env file for the app and the scripts: marks/.env. agent/.env links to it.
  envDir: marksRoot,
  optimizeDeps: {
    entries: [
      "app/entry.client.tsx",
      "app/root.tsx",
      "app/components/layout/{Layout,Sidebar}.tsx",
      "app/components/chat/ChatRouteContent.tsx",
      "app/routes/{home,chat.$threadId}.tsx",
      "app/routes/{_index,markets._index,markets.$symbol,stocks,borrow,portfolio,send,faucet,g.$id}.tsx",
    ],
    // Discovery is off under AgentKit, so the Marks desk's CommonJS and heavy
    // browser dependencies are pre-bundled here.
    include: [
      "@auth0/auth0-spa-js",
      "@fast-auth-near/browser-sdk",
      "@hot-labs/near-connect",
      "@noble/curves/ed25519",
      "@react-three/drei",
      "@react-three/fiber",
      "buffer",
      "framer-motion",
      "gsap",
      "gsap/ScrollTrigger",
      "jwt-decode",
      "lenis",
      "lightweight-charts",
      "near-api-js",
      "near-api-js/lib/transaction",
      "near-api-js/lib/utils",
      "near-api-js/lib/utils/serialize",
      "three",
      "three/examples/jsm/loaders/SVGLoader.js",
    ],
  },
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      ssrStubs: ["shiki"],
    }),
    marksR3fMotionAttributes(),
  ],
});
