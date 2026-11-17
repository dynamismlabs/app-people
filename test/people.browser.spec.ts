/**
 * People's whole app inside an assistant, in the kit's strict MCP Apps test
 * host (test/host/browser-host.ts, as the kit's own AppBridge tests use it): a
 * scripts-only sandbox, a page that may not reach the network, a host that
 * keeps view-only tools from its model, drafts messages, records links and
 * files, and sends deep links. The records are the fictional preview.
 *
 * Verified in this test host only. Ri, ChatGPT and Claude are checked next.
 */
import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { oauthToken } from "./host/connections";
import type { HostOptions } from "./host/browser-host";

type Result = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, any> };
type Message = { role: string; content: { type: string; text?: string }[]; _meta?: Record<string, unknown> };
type Download = { contents: { type: string; resource: { uri: string; mimeType: string; text?: string } }[] };
const VIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
const origin = process.env.PEOPLE_HOST_TEST_URL!;

/** A host like Ri around People's view resource, connected with its own OAuth token and the access chosen for it. */
async function openHost(sourcePage: Page, access: { sources?: string[] | null; write?: boolean } = {}) {
  const context = await sourcePage.context().browser()!.newContext();
  const page = await context.newPage();
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) failures.push(message.text()); });
  page.on("request", (request) => {
    if (request.frame().parentFrame() && !request.url().endsWith("/__mcp-view__")) failures.push("The view reached the network: " + request.url());
  });
  const token = await oauthToken(origin, { name: "Qualification host", access });
  const response = await page.request.post(origin + "/mcp", {
    headers: { accept: "application/json, text/event-stream", authorization: "Bearer " + token },
    data: { jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "ui://people/main" } },
  });
  const resource = await response.json() as { result: { contents: { text: string; _meta: { ui: { csp: Record<string, string[]> } } }[] } };
  expect(resource.result.contents[0]._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [] });
  await page.route("**/__mcp-view__", (route) => route.fulfill({ contentType: "text/html", headers: { "content-security-policy": VIEW_CSP }, body: resource.result.contents[0].text }));
  await page.route("**/__mcp-host__", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>MCP Apps qualification host</title><body style='margin:0'></body>" }));
  const bundle = await build({ entryPoints: [path.resolve("test/host/browser-host.ts")], bundle: true, write: false, format: "iife", platform: "browser" });
  await page.goto(origin + "/__mcp-host__");
  await page.evaluate((value) => { (window as unknown as { mcpToken: string }).mcpToken = value; }, token);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  return {
    page, failures,
    view: page.frameLocator("#app-frame"),
    mount: (tool: string, input: Record<string, unknown> = {}, options: HostOptions = {}) =>
      page.evaluate(([tool, input, options]) => window.mcpFixture.mount("/__mcp-view__", tool, input, options), [tool, input, options] as const) as Promise<Result>,
    call: (name: string, input: Record<string, unknown> = {}) => page.evaluate(([name, input]) => window.mcpFixture.call(name, input), [name, input] as const) as Promise<Result>,
    appCall: (name: string, input: Record<string, unknown> = {}) => page.evaluate(([name, input]) => window.mcpFixture.appCall(name, input), [name, input] as const) as Promise<Result>,
    modelTools: () => page.evaluate(() => window.mcpFixture.modelTools()),
    deepLink: (url: string) => page.evaluate((url) => window.mcpFixture.deepLink(url), url),
    asked: () => page.evaluate(() => ({ messages: window.mcpFixture.messages, links: window.mcpFixture.links, downloads: window.mcpFixture.downloads })) as Promise<{ messages: Message[]; links: string[]; downloads: Download[] }>,
    modelContext: () => page.evaluate(() => ((window.mcpFixture.context as { content?: { text?: string }[] } | null)?.content ?? []).map((part) => part.text ?? "").join("\n")),
    displayMode: () => page.evaluate(() => window.mcpFixture.displayMode),
    close: () => context.close(),
  };
}

/** The fictional preview, seeded by the person's own first visit. */
async function seeded(page: Page) {
  await page.goto(origin + "/today");
  await expect(page.getByText("Fictional preview").first()).toBeVisible();
}

test("the whole of People inside a host: open at a person, the person's own work, the @ menu, drafts, links, files and the wider selection", async ({ page }) => {
  await seeded(page);
  const host = await openHost(page);
  const { view } = host;
  const person = async (name: string) => (await host.call("search_people", { text: name, limit: 5 })).structuredContent!.result.items[0] as { id: string; name: string; revision: number };
  try {
    // The model never sees the person's own decisions, and the host refuses its call to one.
    const modelTools = await host.modelTools();
    expect(modelTools).toEqual(expect.arrayContaining(["search_people", "get_person", "show_people", "open_people"]));
    for (const name of ["delete_record", "merge_people", "list_sources", "apply_import", "export_records", "search_mentions", "open_view"]) expect(modelTools).not.toContain(name);
    const maya = await person("Maya");
    const jordan = await person("Jordan");
    expect((await host.call("delete_record", { kind: "person", id: jordan.id, expectedRevision: jordan.revision, mode: "archive", notes: "keep", suppress: false })).isError).toBe(true);

    // The host's @ menu finds people as links.
    const found = await host.appCall("search_mentions", { query: "Maya" });
    expect(found.structuredContent).toMatchObject({ items: [{ type: "resource_link", uri: `app://people/people/${maya.id}`, title: "Maya Chen" }] });

    // open_people at a person opens the whole app there, and the place reaches the assistant.
    const opened = await host.mount("open_people", { path: `/people/${maya.id}` });
    expect(opened.structuredContent).toEqual({ view: "open_people", path: `/people/${maya.id}` });
    await expect.poll(host.displayMode).toBe("fullscreen");
    await expect(view.getByRole("article", { name: "Maya Chen" })).toBeVisible();
    await expect.poll(host.modelContext).toContain(`"path":"/people/${maya.id}"`);
    await expect.poll(host.modelContext).toContain('"selected":{"id"');
    expect(await host.modelContext()).toContain("Maya Chen");

    // Open in browser opens People's own address at the same person, through the host.
    await view.getByRole("navigation", { name: "App" }).getByRole("button", { name: "Open in browser" }).click();
    await expect.poll(async () => (await host.asked()).links).toEqual([`${origin}/people/${maya.id}`]);

    // Ask Ri puts a question in the chat for the person to edit and send, never sent for them.
    await view.getByRole("article", { name: "Maya Chen" }).getByRole("button", { name: "Ask Ri" }).click();
    await expect(view.getByText("It’s in the chat for you to edit and send.")).toBeVisible();
    const [message] = (await host.asked()).messages;
    expect(message).toMatchObject({ role: "user", content: [{ type: "text" }] });
    expect(message.content[0].text).toContain("Maya Chen");
    expect(message._meta).toEqual({ "openai/message": { target: "active", send: false } });

    // A host link moves the open app to another person (Ri's links, OpenAI's deep links).
    await host.deepLink(`/people/${jordan.id}`);
    await expect(view.getByRole("article", { name: "Jordan Bell" })).toBeVisible();

    // The person's own work in the host: archiving is view-only, and the view does it.
    await view.getByRole("article", { name: "Jordan Bell" }).getByRole("button", { name: "More" }).first().click();
    await view.getByRole("menuitem", { name: "Archive or remove" }).click();
    await view.getByRole("dialog", { name: "Archive or remove Jordan Bell" }).getByRole("button", { name: "Archive", exact: true }).click();
    await expect.poll(async () => (await host.call("get_person", { id: jordan.id })).structuredContent?.result.person.archived).toBe(true);

    // Sources, imports and export, as in Ri's owner view.
    await view.getByRole("tab", { name: "Sources" }).click();
    await expect.poll(host.modelContext).toContain('"section":"Sources"');
    const chooser = host.page.waitForEvent("filechooser");
    await view.getByRole("button", { name: "Choose file" }).click();
    await (await chooser).setFiles({ name: "contacts.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Email,Company\nKai Moreno,kai@imported.example,Northstar\n") });
    const review = view.getByRole("dialog", { name: "Review contacts.csv" });
    await expect(review).toBeVisible();
    await review.getByRole("button", { name: "Import", exact: true }).click();
    await expect.poll(async () => (await host.call("search_people", { text: "Kai", limit: 5 })).structuredContent!.result.total).toBe(1);
    // The export buttons sit at the bottom of the full-screen frame. In this test host Chrome doesn't
    // deliver a real mouse click to the frame's bottom band (about the last 80 px of a sandboxed frame
    // made full screen), so this one click is dispatched to the button. Clicks above it are real.
    await view.getByRole("region", { name: "Export" }).getByRole("button", { name: "People", exact: true }).dispatchEvent("click");
    await expect.poll(async () => (await host.asked()).downloads.length).toBe(1);
    const [file] = (await host.asked()).downloads;
    expect(file.contents[0]).toMatchObject({ type: "resource", resource: { mimeType: "text/csv" } });
    expect(file.contents[0].resource.uri).toMatch(/^file:\/\/\/.+\.csv$/);
    expect(file.contents[0].resource.text).toContain("Maya Chen");

    // The directory's filters and a bulk selection reach the assistant.
    await view.getByRole("tab", { name: "People" }).click();
    await view.getByPlaceholder("Search").fill("a");
    await expect.poll(host.modelContext).toContain('"filters":{"Search":"a"}');
    await view.getByPlaceholder("Search").fill("");
    await view.getByRole("button", { name: "Select", exact: true }).click();
    await view.getByRole("checkbox", { name: "Select Maya Chen" }).check();
    await view.getByRole("checkbox", { name: "Select Priya Shah" }).check();
    await expect.poll(host.modelContext).toContain('"selection":{"items":[');
    expect(await host.modelContext()).toContain('"total":2');

    // A card opens the whole app at one person.
    await host.mount("show_people", { text: "Priya" });
    await view.getByRole("button", { name: /Priya Shah/ }).click();
    await expect.poll(host.displayMode).toBe("fullscreen");
    await expect(view.getByRole("article", { name: "Priya Shah" })).toBeVisible();
    expect(host.failures).toEqual([]);
  } finally { await host.close(); }
});

test("in a host without drafts, links or files, nothing is sent and People offers what it can", async ({ page }) => {
  await seeded(page);
  const host = await openHost(page);
  const { view } = host;
  try {
    const maya = (await host.call("search_people", { text: "Maya", limit: 5 })).structuredContent!.result.items[0] as { id: string };
    await host.mount("open_people", { path: `/people/${maya.id}` }, { draft: false, openLinks: false, download: false });
    await expect(view.getByRole("article", { name: "Maya Chen" })).toBeVisible();
    await expect(view.getByRole("button", { name: "Open in browser" })).toHaveCount(0);
    // The question shows to copy instead of a draft.
    await view.getByRole("article", { name: "Maya Chen" }).getByText("Ask Ri").click();
    await expect(view.locator(".ask-in-chat q")).toContainText("Maya Chen");
    await view.getByRole("tab", { name: "Sources" }).click();
    await expect(view.getByText("Saving files isn't available here. Use Open in browser to export.")).toBeVisible();
    expect(await host.asked()).toEqual({ messages: [], links: [], downloads: [] });
    expect(host.failures).toEqual([]);
  } finally { await host.close(); }
});

test("a connection limited to some sources sees only those, and not the person's own work", async ({ page }) => {
  await seeded(page);
  const host = await openHost(page, { sources: ["manual"], write: true });
  const { view } = host;
  try {
    await host.mount("open_people", { path: "/people" });
    await expect(view.getByRole("tab", { name: "People" })).toBeVisible();
    // Only the people in the person's own collection, not those from the fictional accounts.
    const names = (await host.call("list_people", { limit: 50 })).structuredContent!.result.items.map((item: { name: string }) => item.name);
    expect(names).not.toContain("Maya Chen");
    await view.getByRole("tab", { name: "Sources" }).click();
    await expect(view.getByText(/sees only part of People/)).toBeVisible();
    expect(host.failures).toEqual([]);
  } finally { await host.close(); }
});
