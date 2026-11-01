import { spawn } from "child_process";
import { readFile } from "fs/promises";
import path from "path";

export function repoRoot() {
  const cwd = process.cwd();
  return path.basename(cwd) === "web" ? path.resolve(cwd, "..") : cwd;
}

export async function agentId() {
  const text = await readFile(path.join(repoRoot(), "scripts/testnet.env"), "utf8");
  const match = text.match(/^AGENT_ID=(.+)$/m);
  const id = match?.[1]?.trim();
  if (!id) throw new Error("AGENT_ID is missing from scripts/testnet.env");
  return id;
}

export function redact(text: string) {
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]").slice(-2000);
}

export function runScript(name: string, args: string[], timeoutMs: number) {
  const script = path.join(repoRoot(), "scripts", name);
  return new Promise<string>((resolve, reject) => {
    const child = spawn("bash", [script, ...args], { cwd: repoRoot() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("The NEAR Auth request timed out"));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(redact(stderr || stdout || `Script exited ${code}`)));
      else resolve(stdout);
    });
  });
}
