import { defineConfig } from "vitest/config";
// `pnpm test:perf`: the wall-clock latency budget, kept out of `pnpm test` (see test/performance.perf.ts).
export default defineConfig({ test: { include: ["test/**/*.perf.ts"], testTimeout: 300_000, hookTimeout: 600_000, fileParallelism: false } });
