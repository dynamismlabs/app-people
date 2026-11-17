import fs from "node:fs";
/** Remove the disposable data directory the host test's server used (only a mkdtemp folder). */
export default function teardown() {
  const root = process.env.PEOPLE_HOST_TEST_ROOT;
  if (root && /people-host-/.test(root)) fs.rmSync(root, { recursive: true, force: true });
}
