/**
 * What People's domain code expects from a caller, rebuilt on App Builder.
 *
 * In Ri, People ran inside Ri's app engine and every action received an
 * `AppInvocation` from Ri: who was calling (the owner's view, a chat, the
 * schedule), the accounts Ri had granted, and a way to call Ri's actions.
 * On App Builder the same facts come from the kit's request context
 * (src/runtime.ts builds an invocation from it), so the domain code keeps its
 * shape.
 */

export type AppErrorCode =
  | "invalid_input" | "not_found" | "forbidden" | "revoked" | "unsupported" | "conflict"
  | "busy" | "timeout" | "approval_required" | "approval_denied" | "interrupted" | "app_failed";

export class AppError extends Error {
  /**
   * `httpStatus` is the provider's own status, when a connected service's
   * `not_found` named one: 404 for an item that no longer exists, 410 for one
   * that's gone, such as an expired Calendar sync token.
   */
  constructor(public readonly code: AppErrorCode, message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Who is calling.
 * - `owner-ui`: the person in the app's own web page (no OAuth connection).
 * - `chat`: an assistant connection (a Ri place, Claude, ChatGPT), with the
 *   sources the person chose for it on the consent screen.
 * - `job`: the app's own job runner.
 * - `fixture`: the fictional preview.
 */
export interface AppPrincipal {
  kind: "owner-ui" | "chat" | "workspace" | "job" | "background" | "fixture";
  id: string;
  fixtureAudience?: "user" | "agent";
}

/** One account the hub lends the app, with what it may do there. */
export interface AccountGrant {
  account: string;
  binding: "mail" | "calendar";
  actions: string[];
  /** Whether the app's own job keeps it up to date. */
  automatic: boolean;
}
export interface InvocationAccess {
  protocol: "app-builder-v1";
  actorId: string;
  /** The assistant connection's OAuth client, or null for the owner and jobs. */
  scopeRef: string | null;
  /** What the person chose for this connection on the consent screen. Sources null means all of them, including new ones. */
  chosen: { sources: string[] | null; write: boolean } | null;
  accounts: AccountGrant[];
}

/** Calls People makes outside itself: the hub's tools by Ri's action names. */
export type CapabilityTarget = { binding?: string; account?: string };

export interface AppInvocation {
  id: string;
  principal: AppPrincipal;
  audience: "user" | "agent" | "schedule";
  deadline: number;
  signal: AbortSignal;
  access: InvocationAccess | null;
  capability(name: string, input: unknown, target?: CapabilityTarget): Promise<unknown>;
}
