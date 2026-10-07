import { defineConfig } from "vitest/config";

// Release script tests use node:test and run through `node --test`.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
