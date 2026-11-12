// The fictional preview, in place of Ri's demo mode: People with invented
// people, companies, conversations and a small pipeline, in a disposable data
// directory. Nothing reads a real account: PEOPLE_PREVIEW makes the owner's
// view the fictional preview (its records are seeded the first time it opens),
// and APP_CONNECTORS=fixtures answers any hub call from fixtures/connectors.json.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = process.env.APP_DATA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "people-preview-"));
console.log(`Fictional preview. Data: ${dataDir} (disposable)`);
const child = spawn("pnpm", ["exec", "app-builder", "dev"], {
  stdio: "inherit",
  env: { ...process.env, APP_DATA_DIR: dataDir, PEOPLE_PREVIEW: "1", APP_CONNECTORS: "fixtures", APP_CONNECTOR_FIXTURES: path.resolve("fixtures/connectors.json") },
});
child.on("exit", (code) => process.exit(code ?? 0));
