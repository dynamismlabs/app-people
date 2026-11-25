# People

People keeps one person's relationships: people, companies, conversations, meetings, notes, follow-ups and small pipelines. It was an included app in Ri and now runs on App Builder (core 0.2.11, starter 0.2.0, vendored in `vendor/`; upgraded with the kit's `upgrade --core`) as its own MCP server. `docs/parity.md` lists what works as it did in Ri, what works differently and what can't, and the gaps in the kit and in Ri. Read it before changing how People connects, runs or is shown.

## Commands

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`, `pnpm test` (vitest, disposable data), `pnpm build`
- `pnpm test:perf`: the latency budget, p95 under 300 ms at release volume (`test/performance.perf.ts`). Run it on a quiet machine before a release. It says "not measured" when the load average is above one per core (`PERF_MAX_LOAD`).
- Keep wall-clock assertions out of `pnpm test`: it's the gate every `change` and `serve --install` must pass, on whatever machine runs it. `test/performance.test.ts` checks the query plans of the calls the budget covers instead. A plan change fails its snapshot. Look at the new plan, then run `pnpm test -u` if it's fine.
- `pnpm test:host`: builds, then runs People's whole view in the kit's strict MCP Apps test host (Playwright with installed Chrome, one worker, a disposable preview server it stops)
- `pnpm preview`: the fictional preview in a disposable data directory (`PEOPLE_PREVIEW=1`, `APP_CONNECTORS=fixtures`)
- `pnpm dev` with a disposable `APP_DATA_DIR`
- `pnpm exec app-builder serve --install` to run it as the person's service, `pnpm exec app-builder change` to change it. Use `--service process` while developing. Never install a launchd service while developing.
- `node scripts/oauth-check.mjs http://127.0.0.1:<port>/mcp` connects as any MCP client does and uses the tools.

## Layout

- `src/app.ts`: the kit application: actions, views, prompts, sources, the job, connectors and migrations, all from `src/people`.
- `app.config.ts`: the id, port and `platforms`, and `instructions`, what an assistant should know across People's tools (sent at MCP initialize, at most 2,000 characters). Put there only what no tool's description says.
- `src/people/kit.ts`: turns People's actions into kit actions (marking the person's own decisions view-only, `VIEW_ONLY`), and defines the `show_*` views, the job (`update_people`, every five minutes), `get_record_title`, the records a host can open People at and offer in its @ menu, and the sources a connection can be limited to.
- `src/people/prompts.ts`: People's three skills from Ri (`legacy/skills`) as MCP prompts: Prepare for a meeting, Remember something about someone, Review follow-ups.
- `src/people/runtime.ts`: People's context on the kit's `data.sqlite`, who is calling (browser owner, connection, job), write receipts, and the hub (accounts it lends, tool names, errors).
- `src/people/domain/context.ts`: `Db`, People's synchronous SQL on the core's `transaction()` (the installation's own connection). There is no other connection to the database.
- `src/people/actions/*`: People's actions in the shape they had in Ri, with strict zod (`zod/v3`) input and output, audience, effect and fictional examples.
- `src/people/domain/*`: the records and rules, unchanged from Ri except where `docs/parity.md` says. `migrations.ts` holds the SQL migrations.
- `src/people/view/*`: People's React screens from Ri. `view/kit/*` is Ri's UI kit, with `app.tsx` rewritten onto the kit's client.
- `src/screens.tsx`: the web page, the cards for each `show_*` tool, and the routes. `src/root.tsx` and `src/routes/*` are the kit's.
- `src/lib/*`: the parts of Ri's app kit People used (errors, cursors, settings, the step queue, account checkpoints, mail parsing and sync steps, dates).
- `fixtures/connectors.json`: the fictional hub `APP_CONNECTORS=fixtures` serves (and `change` checks with): a mailbox and calendar People's sync reads end to end, and Ri's services. Its Gmail and Calendar tools answer by their arguments (`cases`: one message per id, a history page per start position, a backfill page per token, one answer per sync token). `test/fixtures.test.ts` runs the job on it.
- `test/*`: People's tests from Ri, run through the kit's adapter, plus `kit.test.ts` for MCP, views, prompts, the job and the hub, `fixtures.test.ts` for the sync on the kit's fixture source, and `people.browser.spec.ts` for the view in the strict test host (`test/host/*` are copies of the kit's host and OAuth helpers, which the core package doesn't ship).
- `legacy/`: Ri's README, AGENTS.md, plugin manifest and skills, for reference only.

## Who is calling

- **The person's browser** (no OAuth connection) is the owner: every source and every action.
- **An assistant connection** (each Ri place, Claude, ChatGPT) sees the sources chosen on the consent screen: accounts (`account:<address>`), collections (`manual`, `collection:<id>`) and imports (`import:<id>`), read or also write. The kit drops a deleted source from every connection's choice before People sees it. A Ri that installed People on this computer can instead grant itself a connection with the host key (the core's host grant, `host-key` in the data directory): that connection always has every source. Never read, copy or commit the key.
- **People's view inside a host** calls through that connection. The person's own decisions are view-only (`visibility: ["app"]`): the host keeps them from the model, and the view's call acts as the owner when the connection was given every source. Limited connections stay limited. It's the host's rule (Ri enforces it); a host that ignores visibility would let its model call them, so mark nothing else view-only.
- **The job** sees the accounts the hub lends.

Only the installation's owner uses People. Other signed-in accounts are refused.

## The hub

People reads Gmail and Calendar and uses Ri's tasks and AI through the person's hub (Ri), connected once in Settings. It calls Ri's tools by name (`HUB_TOOLS` in `runtime.ts`), because the kit's mail and calendar capabilities don't carry what People needs. Each job run asks the hub which accounts it lends (`refreshHubAccounts`, reading the kit's structured `choose_account` answer). Hub errors are told apart by the code the kit keeps (`ConnectorError`): `not_found` with the provider's `httpStatus` (only Calendar's 410, an expired sync token, restarts a window) and Ri's `unsupported`. The message is read only for a hub from before dynamismlabs/ri#7, which sent a provider's 404 or 410 as `provider_error`. A missing tool shows as "People hasn't been allowed to …". Most tests use `test/helpers.ts`'s fake hub with Ri's shapes, which answers a missing item and `unsupported` through the kit's own client (`hub.beforeRi7` answers as a Ri from before ri#7). `test/fixtures.test.ts` runs the whole sync on the kit's own fixture source instead, from `fixtures/connectors.json`, with expiry from a tool's `answer`. A call the fixtures have no answer for fails and names its arguments, so when the sync starts calling with new arguments, add a case.

## Rules that must not regress

All of Ri's rules still hold (they're in `legacy/AGENTS.ri.md`), with these changes:

- Every read, search, count, sort key, snippet, export and context packet filters by the caller's scope first (`sourceFilter`, `canSee`). The scope comes from `ctx.scopes.resolve`, built in `runtime.ts`.
- Domain code is synchronous. `ctx.db.tx` is the core's `transaction()`: work that returns a promise is refused and rolled back, and nothing else runs on the installation's connection until it ends. A step reads from the hub first and stores in one transaction after. A statement outside `tx` is a transaction of its own, so a synchronous read action runs as one (`invoke` in `kit.ts`). Keep read handlers synchronous (a contract test checks), and never open a better-sqlite3 connection of your own to `data.sqlite`.
- A prompt's `messages` runs as the connection, and the core doesn't filter what it reads. Read only through People's own handlers (`run` in `kit.ts`, as "Prepare for a meeting" calls `search_people`), never a query of your own, and change nothing. Say why a prompt can't be prepared by throwing an `Error` with a message for the person. Add-only connections get no prompts or instructions (People has no add actions anyway).
- Writes go through `ctx.mutate` with the request id (`requestId` on every action). Updates check `expectedRevision` and return a conflict instead of overwriting.
- AI runs only through `callAi`, only when extraction is on. With it off, no `ri__ai_text` call may happen.
- Append migrations to `src/people/domain/migrations.ts` (`app-0005` next). Applied SQL is immutable and checksum-checked; one statement per `-- statement-breakpoint`.
- Copy: no em or long dashes, avoid semicolons, no sparkle or wand icons.

## Hosting

The Mac (the kit's Node target) only. People's transactions read their own writes (the core's `transaction()`), which D1 can't run yet, so `app.config.ts` declares `platforms: ["node"]` and `deploy cloudflare` refuses People. The kit's build still makes a Worker, whose entry answers 501. Docker works like the Node service. The data directory is `~/.local/share/people` or `APP_DATA_DIR`. The kit's portable `backup`/`restore` restores People, full-text index included, and so does a stopped copy of `data.sqlite`.
