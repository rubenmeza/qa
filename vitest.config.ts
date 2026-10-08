import { defineConfig } from "vitest/config";

// Browser tests run whole Test Cases, each Step settling for up to seconds.
export default defineConfig({ test: { testTimeout: 30_000 } });
