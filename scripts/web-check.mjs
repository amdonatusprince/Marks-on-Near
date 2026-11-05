#!/usr/bin/env node
// Load every page at 375, 768, 1024 and 1440 wide in headless Chrome. Report horizontal overflow
// and console errors, and save a screenshot of each to /tmp/marks-check.
//   node scripts/web-check.mjs [base-url] [path ...]
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PATHS =
  process.argv.length > 3
    ? process.argv.slice(3)
    : [
        "/",
        "/markets",
        "/markets/NEAR-PERP",
        "/stocks",
        "/borrow",
        "/send",
        "/faucet",
        "/portfolio",
        "/g/0",
      ];
const WIDTHS = [375, 768, 1024, 1440];
const OUT = "/tmp/marks-check";
const PORT = 9333;

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(
      cache,
      "chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    ),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Set CHROME to a Chrome binary");
  return found;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let next = 0;
  const waiting = new Map();
  const listeners = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  };
  return {
    send(method, params = {}) {
      next += 1;
      socket.send(JSON.stringify({ id: next, method, params }));
      return new Promise((resolve, reject) => waiting.set(next, { resolve, reject }));
    },
    on(listener) {
      listeners.push(listener);
    },
    close() {
      socket.close();
    },
  };
}

const MEASURE = `(() => {
  const width = document.documentElement.clientWidth;
  const offenders = [];
  for (const element of document.querySelectorAll("body *")) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (box.right > width + 1 || box.left < -1) {
      let clipped = false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { clipped = true; break; }
        if (style.position === "fixed") { clipped = true; break; }
      }
      if (clipped || getComputedStyle(element).position === "fixed") continue;
      const name = element.tagName.toLowerCase() + (element.className && typeof element.className === "string" ? "." + element.className.trim().split(/\\s+/).slice(0, 3).join(".") : "");
      offenders.push(name + " [" + Math.round(box.left) + "," + Math.round(box.right) + "]");
      if (offenders.length >= 6) break;
    }
  }
  return JSON.stringify({ scroll: document.documentElement.scrollWidth, width, offenders, title: document.title });
})()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(path.join(os.tmpdir(), "marks-check-"));
  const chrome = spawn(
    chromePath(),
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--hide-scrollbars",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    let version;
    for (let attempt = 0; attempt < 50 && !version; attempt += 1) {
      version = await fetch(`http://127.0.0.1:${PORT}/json/version`)
        .then((r) => r.json())
        .catch(() => null);
      if (!version) await sleep(200);
    }
    if (!version) throw new Error("Chrome did not start");
    const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
    const page = targets.find((target) => target.type === "page");
    const cdp = await connect(page.webSocketDebuggerUrl);
    const errors = [];
    cdp.on((message) => {
      if (message.method === "Runtime.exceptionThrown") {
        errors.push(
          message.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? "exception",
        );
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        errors.push(
          message.params.args
            .map((arg) => arg.value ?? arg.description ?? "")
            .join(" ")
            .slice(0, 160),
        );
      }
    });
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    const report = [];
    for (const width of WIDTHS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width < 768,
      });
      for (const route of PATHS) {
        errors.length = 0;
        await cdp.send("Page.navigate", { url: BASE + route });
        await sleep(6000);
        const { result } = await cdp.send("Runtime.evaluate", {
          expression: MEASURE,
          returnByValue: true,
        });
        const measured = JSON.parse(result.value);
        const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
        const file = path.join(OUT, `${width}${route.replaceAll("/", "_") || "_home"}.png`);
        writeFileSync(file, Buffer.from(shot.data, "base64"));
        const overflow = measured.scroll > measured.width;
        report.push({
          width,
          route,
          overflow,
          offenders: measured.offenders,
          errors: [...new Set(errors)].slice(0, 4),
        });
        console.log(
          `${overflow || measured.offenders.length ? "WIDE" : "ok  "} ${width} ${route}${measured.offenders.length ? "  " + measured.offenders.join(" | ") : ""}${errors.length ? "  errors: " + [...new Set(errors)].slice(0, 2).join(" | ") : ""}`,
        );
      }
    }
    writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
    cdp.close();
  } finally {
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
