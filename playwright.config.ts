import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// People's view in the kit's strict MCP Apps test host (test/host). One worker, one server on a
// disposable data directory in the fictional preview; Playwright stops the server when it's done
// and the teardown removes the directory.
const dataRoot = process.env.PEOPLE_HOST_TEST_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), "people-host-"));
process.env.PEOPLE_HOST_TEST_ROOT = dataRoot;
const port = Number(process.env.PEOPLE_HOST_TEST_PORT ?? 4481);
const origin = `http://127.0.0.1:${port}`;
process.env.PEOPLE_HOST_TEST_URL = origin;
export default defineConfig({
  testDir: "test",
  testMatch: "**/*.browser.spec.ts",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  globalTeardown: "./test/host/teardown.ts",
  use: {
    browserName: "chromium",
    launchOptions: { executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) },
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node dist/server.mjs", url: origin + "/api/health", reuseExistingServer: false, timeout: 60000,
    env: {
      APP_DATA_DIR: path.join(dataRoot, "data"), APP_URL: origin, PORT: String(port), APP_HOST: "127.0.0.1",
      PEOPLE_PREVIEW: "1", APP_CONNECTORS: "fixtures", APP_CONNECTOR_FIXTURES: path.resolve("fixtures/connectors.json"),
    },
  },
});
