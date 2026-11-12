// Connect to a running People the way any MCP client does, and use it.
//
//   node scripts/oauth-check.mjs http://127.0.0.1:<port>/mcp
//
// It registers a client, prints the address of People's consent screen to
// open in a browser (no sign-in on this computer), waits for the approval to
// come back to its own loopback address, exchanges the code for a token with
// PKCE, then lists the tools and reads with them. Nothing is saved: the client
// and token live only while this runs. Use a disposable APP_DATA_DIR.
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

const serverUrl = process.argv[2];
if (!serverUrl) { console.error("Usage: node scripts/oauth-check.mjs <app address>/mcp"); process.exit(64); }
const name = process.argv[3] ?? "People OAuth check";

let resolveCode;
const codeArrived = new Promise((resolve) => { resolveCode = resolve; });
const callback = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  response.writeHead(200, { "content-type": "text/plain" }).end(url.searchParams.get("code") ? "Connected. You can close this tab." : "No code came back.");
  if (url.searchParams.get("code")) resolveCode(url.searchParams.get("code"));
});
await new Promise((resolve) => callback.listen(0, "127.0.0.1", resolve));
const redirectUrl = `http://127.0.0.1:${callback.address().port}/callback`;

let client, tokens, verifier;
const provider = {
  get redirectUrl() { return redirectUrl; },
  get clientMetadata() {
    return { client_name: name, redirect_uris: [redirectUrl], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  },
  clientInformation: () => client,
  saveClientInformation: (value) => { client = value; },
  tokens: () => tokens,
  saveTokens: (value) => { tokens = value; },
  redirectToAuthorization: (url) => { console.log(`CONSENT ${url.href}`); },
  saveCodeVerifier: (value) => { verifier = value; },
  codeVerifier: () => verifier,
};

const step = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
try {
  // Without a token the app answers 401 with where to find its authorization server.
  const challenge = await fetch(serverUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  step("unauthenticated", `${challenge.status} ${challenge.headers.get("www-authenticate") ?? ""}`);
  step("start", await auth(provider, { serverUrl }));
  step("registered client", client?.client_id ?? "none");
  const code = await Promise.race([codeArrived, new Promise((_, reject) => setTimeout(() => reject(new Error("No approval within 5 minutes")), 300_000))]);
  step("finish", await auth(provider, { serverUrl, authorizationCode: code }));
  step("token", tokens?.access_token ? `received (expires in ${tokens.expires_in}s, refresh ${tokens.refresh_token ? "yes" : "no"})` : "missing");
  const mcp = new Client({ name: "people-oauth-check", version: "1" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: provider }));
  const tools = (await mcp.listTools()).tools;
  step("tools", `${tools.length}: ${tools.map((tool) => tool.name).join(" ")}`);
  const people = await mcp.callTool({ name: "list_people", arguments: { limit: 10 } });
  step("list_people", people.isError ? people.content?.[0]?.text : people.structuredContent.result.items.map((item) => item.name));
  const today = await mcp.callTool({ name: "show_today", arguments: {} });
  step("show_today", today.isError ? today.content?.[0]?.text : today.content?.[0]?.text);
  const note = await mcp.callTool({ name: "capture_about_person", arguments: { name: "Nobody Here", text: "Checking that writes follow the consent choice." } });
  step("capture_about_person", note.isError ? `refused: ${note.content?.[0]?.text}` : note.structuredContent.result.status);
  await mcp.close();
} catch (error) {
  console.error(`FAILED: ${error.message}`);
  process.exitCode = 1;
} finally { callback.close(); }
