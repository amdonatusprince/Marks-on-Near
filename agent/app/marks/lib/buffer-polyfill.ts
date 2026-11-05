import { Buffer } from "buffer";

const target = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
target.Buffer ??= Buffer;
