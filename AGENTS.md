# People

People keeps one person's relationships: people, companies, conversations, meetings, notes, follow-ups and small pipelines. It was an included app in Ri and now runs on App Builder (core 0.2.2, starter 0.2.0, vendored in `vendor/`; upgraded with the kit's `upgrade --core`) as its own MCP server. `docs/parity.md` lists what works as it did in Ri, what works differently and what can't, and the gaps in the kit and in Ri. Read it before changing how People connects, runs or is shown.

## Commands

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`, `pnpm test` (vitest, disposable data), `pnpm build`
- `pnpm test:host`: builds, then runs People's whole view in the kit's strict MCP Apps test host (Playwright with installed Chrome, one worker, a disposable preview server it stops)
- `pnpm preview`: the fictional preview in a disposable data directory (`PEOPLE_PREVIEW=1`, `APP_CONNECTORS=fixtures`)
- `pnpm dev` with a disposable `APP_DATA_DIR`
- `pnpm exec app-builder serve --install` to run it as the person's service, `pnpm exec app-builder change` to change it. Use `--service process` while developing. Never install a launchd service while developing.
- `node scripts/oauth-check.mjs http://127.0.0.1:<port>/mcp` connects as any MCP client does and uses the tools.

## Layout

- `src/app.ts`: the kit application: actions, views, sources, the job, connectors and migrations, all from `src/people`.
- `src/people/kit.ts`: turns People's actions into kit actions (marking the person's own decisions view-only, `VIEW_ONLY`), and defines the `show_*` views, the job (`update_people`, every five minutes), `get_record_title`, the records a host can open People at and offer in its @ menu, and the sources a connection can be limited to.
- `src/people/runtime.ts`: People's synchronous connection to the kit's `data.sqlite`, who is calling (browser owner, connection, job), write receipts, and the hub (accounts it lends, tool names, errors).
- `src/people/actions/*`: People's actions in the shape they had in Ri, with strict zod (`zod/v3`) input and output, audience, effect and fictional examples.
- `src/people/domain/*`: the records and rules, unchanged from Ri except where `docs/parity.md` says. `migrations.ts` holds the SQL migrations.
- `src/people/view/*`: People's React screens from Ri. `view/kit/*` is Ri's UI kit, with `app.tsx` rewritten onto the kit's client.
- `src/screens.tsx`: the web page, the cards for each `show_*` tool, and the routes. `src/root.tsx` and `src/routes/*` are the kit's.
- `src/lib/*`: the parts of Ri's app kit People used (errors, cursors, settings, the step queue, account checkpoints, mail parsing and sync steps, dates).
- `fixtures/connectors.json`: fictional hub answers for `APP_CONNECTORS=fixtures`.
- `test/*`: People's tests from Ri, run through the kit's adapter, plus `kit.test.ts` for MCP, views, the job and the hub, and `people.browser.spec.ts` for the view in the strict test host (`test/host/*` are copies of the kit's host and OAuth helpers, which the core package doesn't ship).
- `legacy/`: Ri's README, AGENTS.md, plugin manifest and skills, for reference only.

## Who is calling

- **The person's browser** (no OAuth connection) is the owner: every source and every action.
- **An assistant connection** (each Ri place, Claude, ChatGPT) sees the sources chosen on the consent screen: accounts (`account:<address>`), collections (`manual`, `collection:<id>`) and imports (`import:<id>`), read or also write. The kit drops a deleted source from every connection's choice before People sees it.
- **People's view inside a host** calls through that connection. The person's own decisions are view-only (`visibility: ["app"]`): the host keeps them from the model, and the view's call acts as the owner when the connection was given every source. Limited connections stay limited. It's the host's rule (Ri enforces it); a host that ignores visibility would let its model call them, so mark nothing else view-only.
- **The job** sees the accounts the hub lends.

Only the installation's owner uses People. Other signed-in accounts are refused.

## The hub

People reads Gmail and Calendar and uses Ri's tasks and AI through the person's hub (Ri), connected once in Settings. It calls Ri's tools by name (`HUB_TOOLS` in `runtime.ts`), because the kit's mail and calendar capabilities don't carry what People needs. Each job run asks the hub which accounts it lends (`refreshHubAccounts`, reading the kit's structured `choose_account` answer). Hub errors are still told apart by their message until Ri sends `not_found` as a code (dynamismlabs/ri#7). A missing tool shows as "People hasn't been allowed to …". Tests use `test/helpers.ts`'s fake hub with Ri's shapes; the kit's fixture source can't drive People's sync.

## Rules that must not regress

All of Ri's rules still hold (they're in `legacy/AGENTS.ri.md`), with these changes:

- Every read, search, count, sort key, snippet, export and context packet filters by the caller's scope first (`sourceFilter`, `canSee`). The scope comes from `ctx.scopes.resolve`, built in `runtime.ts`.
- Domain code is synchronous. Never await inside `ctx.db.tx`: People's connection and the kit's share one file, and a held write lock blocks the kit. A step reads from the hub first and stores in one transaction after.
- Writes go through `ctx.mutate` with the request id (`requestId` on every action). Updates check `expectedRevision` and return a conflict instead of overwriting.
- AI runs only through `callAi`, only when extraction is on. With it off, no `ri__ai_text` call may happen.
- Append migrations to `src/people/domain/migrations.ts` (`app-0005` next). Applied SQL is immutable and checksum-checked; one statement per `-- statement-breakpoint`.
- Copy: no em or long dashes, avoid semicolons, no sparkle or wand icons.

## Hosting

The Mac (the kit's Node target) only. People's synchronous SQLite can't run on D1, so the Worker entry answers 501. Docker works like the Node service. The data directory is `~/.local/share/people` or `APP_DATA_DIR`. The kit's portable `backup`/`restore` restores People, full-text index included, and so does a stopped copy of `data.sqlite`.
