/**
 * The connection between People's screens and the app, on App Builder.
 *
 * In Ri this file connected the view to Ri's host bridge. It now sits on the
 * kit's client (`useAppClient` from @app-builder/core/react), which calls the
 * app's actions over HTTP in the app's own web page and as MCP tool calls
 * inside an assistant (MCP Apps). The `RiApp` interface the screens use is
 * unchanged, so the screens are the same code. Leaving the frame goes through
 * the host: a question drafted in the chat, a link, a saved file and Open in
 * browser each use the kit's call, which checks what the host allows.
 */
import { createContext, useCallback, useContext, useEffect, useInsertionEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAppClient } from "@app-builder/core/react";
import { LiveRegion } from "./announce.js";
import { installStyles } from "./styles.js";
import { errorMessage, stableJson } from "./util.js";

export type Theme = "light" | "dark";
export interface SelectedFile { name: string; mimeType: string; base64: string }
export interface DownloadRequest {
  /** File name such as `people.csv`. Path separators are removed. */
  name: string;
  mimeType: string;
  /** Text content. Provide exactly one of `text` or `base64`. */
  text?: string;
  base64?: string;
}

export interface RiApp<TData = unknown> {
  /** The latest `open_view` result for the current place. */
  data: TData | undefined;
  /** Counts refreshed results after the first. Queries refetch when it changes. */
  revision: number;
  theme: Theme;
  connected: boolean;
  error: string | null;
  /** Inside an assistant (MCP Apps) rather than the app's own page. */
  embedded: boolean;
  /** The host drafts a question in its chat for the person to send (Ri does). */
  canAsk: boolean;
  /** Files can be saved here: in the browser, or a host with `ui/download-file`. */
  canDownload: boolean;
  call<T = unknown>(action: string, input?: Record<string, unknown>, options?: { invocationId?: string }): Promise<T>;
  /** Where the person is: the section, its filters and the open record, for the assistant. */
  context(state: unknown): void;
  /** Several records the person selected for a bulk change (at most 50 listed), or none. */
  selectRecords(records: { id: string; title: string }[], total?: number): void;
  ask(prompt: string): Promise<void>;
  openSources(): Promise<void>;
  manageAccess(): Promise<void>;
  setLocation(path: string, options?: { replace?: boolean; push?: boolean }): void;
  goBack(fallback: string): void;
  moves: number;
  openExternal(url: string): Promise<void>;
  openDirections(address: string): Promise<void>;
  selectFile(): Promise<SelectedFile | null>;
  download(file: DownloadRequest): Promise<void>;
}

const RiAppContext = createContext<RiApp | null>(null);
type Follow = (listener: (data: unknown) => void) => () => void;
const FollowContext = createContext<Follow | null>(null);

export function useRiApp<TData = unknown>(): RiApp<TData> {
  const value = useContext(RiAppContext);
  if (!value) throw new Error("useRiApp needs a RiAppProvider above this component");
  return value as RiApp<TData>;
}
export function useOptionalRiApp<TData = unknown>(): RiApp<TData> | null {
  return useContext(RiAppContext) as RiApp<TData> | null;
}
/** Move the view when the person goes Back or Forward, or the host opens another place. `onMove` receives the `open_view` result for it. */
export function useLocationMoves<TData = unknown>(onMove: (data: TData) => void) {
  const follow = useContext(FollowContext);
  if (!follow) throw new Error("useLocationMoves needs a RiAppProvider above this component");
  const handler = useRef(onMove);
  useInsertionEffect(() => { handler.current = onMove; });
  useEffect(() => follow((data) => handler.current(data as TData)), [follow]);
}

/**
 * Where the host asked People to go: `open_people`'s path, a host link
 * (`openai/deepLink`) or a card's `openFullscreen(path)`. EmbeddedView calls
 * this with the router's place; the open People view moves there. A request
 * that arrives before the view is ready waits for it.
 */
let navigator: ((path: string) => void) | null = null;
let waiting: string | null = null;
export function navigatePeople(path: string) {
  if (navigator) navigator(path);
  else waiting = path;
}

export function assertHttpsUrl(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("This link is not a valid web address"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Only secure https links can open from this app");
  return parsed.href;
}
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
}

type Timer = ReturnType<typeof setTimeout>;
export interface CoalescerOptions { delay?: number; maxWait?: number; minInterval?: number; now?: () => number; schedule?: (fn: () => void, ms: number) => Timer; cancel?: (timer: Timer) => void }
/** Keeps only the latest value and sends it after a quiet period, skipping repeats. */
export function createCoalescer<T>(send: (value: T) => void, options: CoalescerOptions = {}) {
  const delay = options.delay ?? 150, maxWait = options.maxWait ?? 1000, minInterval = options.minInterval ?? 100;
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  let timer: Timer | null = null, pending: { value: T; key: string } | null = null;
  let firstPendingAt = 0, lastSentAt = -Infinity, lastSentKey: string | null = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    const { value, key } = pending;
    pending = null;
    if (key === lastSentKey) return;
    lastSentKey = key; lastSentAt = now();
    send(value);
  };
  const arm = () => {
    if (timer) cancel(timer);
    const at = now();
    timer = schedule(flush, Math.max(Math.min(delay, firstPendingAt + maxWait - at), lastSentAt + minInterval - at, 0));
  };
  return {
    push(value: T, key: string = stableJson(value)) { if (!pending) firstPendingAt = now(); pending = { value, key }; arm(); },
    flush() { if (timer) cancel(timer); flush(); },
    dispose() { if (timer) cancel(timer); timer = null; pending = null; },
  };
}

const splitPath = (path: string) => {
  const url = new URL(path, "http://view.local");
  return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
};
const currentTheme = (): Theme => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark") ? "dark" : "light";

/** The place's name, as People's tabs and records name it. */
const SECTION_TITLES: Record<string, string> = {
  today: "Today", people: "People", "follow-ups": "Follow-ups", companies: "Companies", pipelines: "Pipelines", sources: "Sources",
  person: "A person", company: "A company", organization: "A company", opportunity: "An opportunity",
};
const FILTER_NAMES: Record<string, string> = { text: "Search", listIds: "Lists", lastExchange: "Last exchange", nextMeeting: "Next meeting", organizationIds: "Companies", sources: "Sources", pinned: "Pinned" };
const FOLLOW_UPS: Record<string, string> = { i_owe: "I owe", waiting_on: "Waiting on", suggestions: "Suggestions", completed: "Completed" };
/** The screen's filters as names and short values, at most eight. */
function filtersOf(state: { filters?: Record<string, unknown>; viewId?: string; followUps?: string }) {
  const out: Record<string, string> = {};
  if (state.followUps) out.Show = FOLLOW_UPS[state.followUps] ?? state.followUps;
  if (state.viewId) out.View = state.viewId;
  for (const [key, value] of Object.entries(state.filters ?? {})) {
    if (value === undefined || value === null || (Array.isArray(value) && !value.length)) continue;
    out[FILTER_NAMES[key] ?? key] = (typeof value === "string" ? value : JSON.stringify(value)).slice(0, 120);
  }
  return Object.fromEntries(Object.entries(out).slice(0, 8));
}

/** A selected record's name, for the assistant: only records this connection may see get one. */
async function recordTitle(call: (name: string, input: Record<string, unknown>) => Promise<unknown>, item: { kind: string; id: string }) {
  try {
    const result = await call("get_record_title", { kind: item.kind, id: item.id }) as { title: string | null };
    return result.title;
  } catch { return null; }
}

export interface RiAppProviderProps {
  children?: ReactNode;
  /** Where the view starts. Defaults to the page's own address, or `/` inside an assistant. */
  initialPath?: string;
  /** Inside an assistant: open the core's Settings in the same frame. Without it, Settings opens in the browser. */
  openSettings?: () => void;
}

export function RiAppProvider({ children, initialPath, openSettings }: RiAppProviderProps) {
  useInsertionEffect(() => { installStyles(); }, []);
  const client = useAppClient();
  const embedded = client.embedded;
  const settingsRef = useRef(openSettings);
  settingsRef.current = openSettings;
  const [data, setData] = useState<unknown>(undefined);
  const [revision, setRevision] = useState(0);
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [error, setError] = useState<string | null>(null);
  const [moves, setMoves] = useState(0);
  const movers = useRef(new Set<(data: unknown) => void>());
  const lastKey = useRef<string | null>(null);
  const count = useRef(0);
  // Inside an assistant the view has no address: its places are kept here.
  const stack = useRef<string[]>([]);
  // Only the latest place asked for is shown, whichever answer arrives last.
  const latest = useRef(0);
  const clientRef = useRef(client);
  clientRef.current = client;
  const here = () => embedded || typeof window === "undefined" ? stack.current.at(-1) ?? "/" : window.location.pathname + window.location.search;

  // Ri gave the view the `data` part of the opener's result. open_view returns { resource, data, scope }.
  const open = useCallback(async (place: string) => {
    const { path, query } = splitPath(place);
    return ((await clientRef.current.call("open_view", { path, query })) as { data: unknown }).data;
  }, []);
  const receive = useCallback((value: unknown, moved: boolean) => {
    const key = stableJson(value);
    if (key === lastKey.current && !moved) return;
    lastKey.current = key;
    setData(value);
    if (count.current++ > 0) setRevision((current) => current + 1);
    if (moved) {
      setMoves((current) => current + 1);
      for (const listener of movers.current) listener(value);
    }
  }, []);
  const moveTo = useCallback(async (place: string) => {
    const ticket = ++latest.current;
    try {
      const value = await open(place);
      if (ticket === latest.current) { receive(value, true); setError(null); }
    } catch (failure) { if (ticket === latest.current) setError(errorMessage(failure, "People could not open this place")); }
  }, [open, receive]);

  useEffect(() => {
    const start = waiting ?? initialPath ?? (embedded || typeof window === "undefined" ? "/" : window.location.pathname + window.location.search);
    waiting = null;
    stack.current = [start];
    const ticket = ++latest.current;
    open(start).then((value) => { if (ticket === latest.current) { receive(value, false); setError(null); } },
      (failure) => { if (ticket === latest.current) setError(errorMessage(failure, "People could not open")); });
    // The host asks the open view to go somewhere: open_people's path, its link to a record, a card.
    navigator = (path) => {
      if (count.current === 0 && latest.current === ticket) { stack.current = [path]; }
      else stack.current.push(path);
      void moveTo(path);
    };
    return () => { navigator = null; latest.current++; };
  }, [open, receive, moveTo, initialPath, embedded]);

  // The host's theme, which the kit applies to <html data-theme>.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  // In the app's own page, Back and Forward move the view with the browser's history.
  useEffect(() => {
    if (embedded || typeof window === "undefined") return;
    const onPop = () => { void moveTo(window.location.pathname + window.location.search); };
    window.addEventListener("popstate", onPop);
    // Coming back to the page refreshes what it shows, as Ri did after changes elsewhere.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void open(window.location.pathname + window.location.search).then((value) => receive(value, false), () => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("popstate", onPop); document.removeEventListener("visibilitychange", onVisible); };
  }, [embedded, moveTo, open, receive]);

  // What the person is looking at reaches the assistant through the kit's bounded context:
  // the section, its path (which Open in browser and open_people can open again), its filters and the open record.
  const place = useRef<ReturnType<typeof createCoalescer<unknown>> | null>(null);
  if (!place.current)
    place.current = createCoalescer<unknown>((value) => {
      const state = (value ?? {}) as { section?: string; selected?: { kind: string; id: string }[]; filters?: Record<string, unknown>; viewId?: string; followUps?: string };
      const current = clientRef.current;
      current.setSection({ title: SECTION_TITLES[state.section ?? ""] ?? "People", path: here(), filters: filtersOf(state) });
      const selected = state.selected ?? [];
      if (!selected.length) { current.select(null); return; }
      void Promise.all(selected.slice(0, 50).map(async (item) => ({ id: item.id, title: await recordTitle(current.call, item) })))
        .then((items) => {
          const named = items.filter((item): item is { id: string; title: string } => !!item.title);
          if (named.length === 1) clientRef.current.select(named[0]);
          else if (named.length) clientRef.current.selectMany(named, selected.length);
          else clientRef.current.select(null);
        });
    }, { delay: 150, maxWait: 1000, minInterval: 100 });
  useEffect(() => () => { place.current?.flush(); clientRef.current.select(null); clientRef.current.setSection(null); }, []);

  const actions = useMemo(() => ({
    call: async <T,>(action: string, input: Record<string, unknown> = {}, options: { invocationId?: string } = {}) =>
      (await clientRef.current.call<T>(action, options.invocationId ? { ...input, requestId: options.invocationId } : input)) as T,
    context(state: unknown) { place.current!.push(state); },
    selectRecords(records: { id: string; title: string }[], total?: number) {
      clientRef.current.selectMany(records.slice(0, 50), total ?? records.length);
    },
    ask: async (prompt: string) => {
      if (!(await clientRef.current.draftMessage(prompt))) throw new Error(`Copy this into the chat: ${prompt}`);
    },
    openSources: async () => {
      if (embedded) { stack.current.push("/sources"); await moveTo("/sources"); return; }
      window.history.pushState({ people: true }, "", "/sources");
      await moveTo("/sources");
    },
    manageAccess: async () => {
      // Which accounts People reads is chosen in Ri; connecting People to Ri is in People's Settings.
      if (!embedded) { window.location.assign("/settings"); return; }
      if (settingsRef.current) { settingsRef.current(); return; }
      if (!(await clientRef.current.openInBrowser("/settings"))) {
        const address = clientRef.current.browserURL("/settings");
        throw new Error(address ? `Open People's Settings in your browser: ${address}` : "Choose which accounts People may read on People's page in Ri.");
      }
    },
    setLocation(path: string, options: { replace?: boolean; push?: boolean } = {}) {
      if (embedded) {
        const top = stack.current.at(-1);
        const samePlace = top && splitPath(top).path === splitPath(path).path;
        if (options.replace || (samePlace && !options.push)) stack.current[stack.current.length - 1] = path;
        else stack.current.push(path);
        return;
      }
      const current = window.location.pathname + window.location.search;
      if (current === path) return;
      const samePlace = window.location.pathname === splitPath(path).path;
      if (options.replace || (samePlace && !options.push)) window.history.replaceState({ people: true }, "", path);
      else window.history.pushState({ people: true }, "", path);
    },
    goBack(fallback: string) {
      if (embedded) {
        stack.current.pop();
        const previous = stack.current.at(-1);
        if (!previous) stack.current.push(fallback);
        void moveTo(previous ?? fallback);
        return;
      }
      if ((window.history.state as { people?: boolean } | null)?.people && window.history.length > 1) { window.history.back(); return; }
      window.history.replaceState({ people: true }, "", fallback);
      void moveTo(fallback);
    },
    openExternal: async (url: string) => {
      const safe = assertHttpsUrl(url);
      if (!(await clientRef.current.openLink(safe))) throw new Error(`Copy this address into your browser: ${safe}`);
    },
    openDirections: async (address: string) => {
      const url = directionsUrl(address);
      if (!(await clientRef.current.openLink(url))) throw new Error(`Copy this address into your browser: ${url}`);
    },
    selectFile: () => new Promise<SelectedFile | null>((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".csv,.vcf,.txt,text/csv,text/vcard,text/plain";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("The file could not be read"));
        reader.onload = () => {
          const url = String(reader.result);
          resolve({ name: file.name, mimeType: file.type || "text/plain", base64: url.slice(url.indexOf(",") + 1) });
        };
        reader.readAsDataURL(file);
      };
      input.click();
    }),
    download: async (file: DownloadRequest) => {
      if ((file.text === undefined) === (file.base64 === undefined)) throw new Error("Provide either text or base64 content to download");
      const name = file.name.split(/[\\/]/).pop()?.trim() || "export";
      const saved = await clientRef.current.download(file.text !== undefined
        ? { name, mimeType: file.mimeType, text: file.text }
        : { name, mimeType: file.mimeType, data: Uint8Array.from(atob(file.base64!), (char) => char.charCodeAt(0)) });
      if (!saved) throw new Error("This app can't save files here. Use Open in browser to export.");
    },
  }), [embedded, moveTo]);

  const follow = useCallback<Follow>((listener) => {
    movers.current.add(listener);
    return () => { movers.current.delete(listener); };
  }, []);
  const value = useMemo<RiApp>(() => ({
    data, revision, theme, connected: data !== undefined, error, moves, embedded,
    canAsk: embedded && client.can.draft, canDownload: client.can.download, ...actions,
  }), [data, revision, theme, error, moves, embedded, client.can.draft, client.can.download, actions]);
  return (
    <RiAppContext.Provider value={value}>
      <FollowContext.Provider value={follow}>
        <LiveRegion>{children}</LiveRegion>
      </FollowContext.Provider>
    </RiAppContext.Provider>
  );
}
