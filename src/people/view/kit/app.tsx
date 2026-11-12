/**
 * The connection between People's screens and the app, on App Builder.
 *
 * In Ri this file connected the view to Ri's host bridge. It now sits on the
 * kit's client (`useAppClient` from @app-builder/core/react), which calls the
 * app's actions over HTTP in the app's own web page and as MCP tool calls
 * inside an assistant (MCP Apps). The `RiApp` interface the screens use is
 * unchanged, so the screens are the same code. What the kit's client can't do
 * inside an assistant (stage a chat draft, open a link, download a file) is
 * reported as unavailable there; see docs/parity.md.
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
  /** Whether a chat composer is available to stage a question. Never on App Builder today. */
  canAsk: boolean;
  call<T = unknown>(action: string, input?: Record<string, unknown>, options?: { invocationId?: string }): Promise<T>;
  /** What the person is looking at. Only one selected record's id and title reach the assistant (the kit's bounded selection). */
  context(state: unknown): void;
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
/** Move the view when the person goes Back or Forward. `onMove` receives the `open_view` result for the new place. */
export function useLocationMoves<TData = unknown>(onMove: (data: TData) => void) {
  const follow = useContext(FollowContext);
  if (!follow) throw new Error("useLocationMoves needs a RiAppProvider above this component");
  const handler = useRef(onMove);
  useInsertionEffect(() => { handler.current = onMove; });
  useEffect(() => follow((data) => handler.current(data as TData)), [follow]);
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

const UNAVAILABLE_HERE = "Open People in your browser to do this. It isn't available inside a chat.";
const splitPath = (path: string) => {
  const url = new URL(path, "http://view.local");
  return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
};
const currentTheme = (): Theme => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark") ? "dark" : "light";

/** Selected records go to the assistant as the kit's bounded selection: one record's id and title. */
async function selectionTitle(call: (name: string, input: Record<string, unknown>) => Promise<unknown>, item: { kind: string; id: string }) {
  try {
    const result = await call("get_record_title", { kind: item.kind, id: item.id }) as { title: string | null };
    return result.title;
  } catch { return null; }
}

export interface RiAppProviderProps {
  children?: ReactNode;
  /** Where the view starts. Defaults to the page's own address, or `/` inside an assistant. */
  initialPath?: string;
}

export function RiAppProvider({ children, initialPath }: RiAppProviderProps) {
  useInsertionEffect(() => { installStyles(); }, []);
  const client = useAppClient();
  const embedded = client.embedded;
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
  const callRef = useRef(client.call);
  callRef.current = client.call;

  // Ri gave the view the `data` part of the opener's result. open_view returns { resource, data, scope }.
  const open = useCallback(async (place: string) => {
    const { path, query } = splitPath(place);
    return ((await callRef.current("open_view", { path, query })) as { data: unknown }).data;
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
    try { receive(await open(place), true); setError(null); }
    catch (failure) { setError(errorMessage(failure, "People could not open this place")); }
  }, [open, receive]);

  useEffect(() => {
    const start = initialPath ?? (embedded || typeof window === "undefined" ? "/" : window.location.pathname + window.location.search);
    stack.current = [start];
    let active = true;
    open(start).then((value) => { if (active) { receive(value, false); setError(null); } },
      (failure) => { if (active) setError(errorMessage(failure, "People could not open")); });
    return () => { active = false; };
  }, [open, receive, initialPath, embedded]);

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

  const selection = useRef<ReturnType<typeof createCoalescer<unknown>> | null>(null);
  if (!selection.current)
    selection.current = createCoalescer<unknown>((state) => {
      const selected = (state as { selected?: { kind: string; id: string }[] })?.selected ?? [];
      if (selected.length !== 1) { client.select(null); return; }
      void selectionTitle(callRef.current, selected[0]).then((title) => client.select(title ? { id: selected[0].id, title } : null));
    }, { delay: 150, maxWait: 1000, minInterval: 100 });
  useEffect(() => () => { selection.current?.flush(); client.select(null); }, [client.select]);

  const actions = useMemo(() => ({
    call: async <T,>(action: string, input: Record<string, unknown> = {}, options: { invocationId?: string } = {}) =>
      (await callRef.current<T>(action, options.invocationId ? { ...input, requestId: options.invocationId } : input)) as T,
    context(state: unknown) { selection.current!.push(state); },
    ask: async () => { throw new Error("Asking from People isn't available here. Ask in your chat instead."); },
    openSources: async () => {
      if (embedded) { stack.current.push("/sources"); await moveTo("/sources"); return; }
      window.history.pushState({ people: true }, "", "/sources");
      await moveTo("/sources");
    },
    manageAccess: async () => {
      if (embedded) throw new Error("Choose which accounts People may read on People's page in Ri.");
      window.location.assign("/settings");
    },
    setLocation(path: string, options: { replace?: boolean; push?: boolean } = {}) {
      if (embedded) {
        const top = stack.current.at(-1);
        const samePlace = top && splitPath(top).path === splitPath(path).path;
        if (options.replace || (samePlace && !options.push)) stack.current[stack.current.length - 1] = path;
        else stack.current.push(path);
        return;
      }
      const here = window.location.pathname + window.location.search;
      if (here === path) return;
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
      if (embedded) throw new Error(UNAVAILABLE_HERE);
      window.open(safe, "_blank", "noopener,noreferrer");
    },
    openDirections: async (address: string) => {
      if (embedded) throw new Error(UNAVAILABLE_HERE);
      window.open(directionsUrl(address), "_blank", "noopener,noreferrer");
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
      if (embedded) throw new Error(UNAVAILABLE_HERE);
      if ((file.text === undefined) === (file.base64 === undefined)) throw new Error("Provide either text or base64 content to download");
      const bytes = file.text !== undefined ? new TextEncoder().encode(file.text) : Uint8Array.from(atob(file.base64!), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name.split(/[\\/]/).pop()?.trim() || "export";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  }), [embedded, moveTo]);

  const follow = useCallback<Follow>((listener) => {
    movers.current.add(listener);
    return () => { movers.current.delete(listener); };
  }, []);
  const value = useMemo<RiApp>(() => ({
    data, revision, theme, connected: data !== undefined, error, moves, embedded, canAsk: false, ...actions,
  }), [data, revision, theme, error, moves, embedded, actions]);
  return (
    <RiAppContext.Provider value={value}>
      <FollowContext.Provider value={follow}>
        <LiveRegion>{children}</LiveRegion>
      </FollowContext.Provider>
    </RiAppContext.Provider>
  );
}
