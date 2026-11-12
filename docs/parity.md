# People: parity with People in Ri

People ran inside Ri as an included app (`apps/people` at Ri commit `3c442810`, on `@ri/app-kit`). It now runs on App Builder as its own MCP server with its own data. This list takes every feature and rule in the old README, AGENTS.md and plugin manifest, and every test, and marks each one:

- **Works**: the same behavior, checked by a test that runs through the kit (see Evidence).
- **Works differently**: available, with the difference said.
- **Can't work**: not possible on the new path today, with why and what would have to change in the kit or in Ri.

Checked on November 12, 2026 against kit `main` `bc2c7f4` (core 0.2.0) and Ri's hub as read from its code (branch `claude/single-path-ri-approval-id`). Ri itself wasn't run.

## The short version

**Almost everything People did works on App Builder: its screens, data, rules, imports, sync, AI features, follow-ups and privacy model, with all of its tests.** These can't work today:

1. **People's view inside Ri can't do owner-only work** (Sources, imports, export, merges, deleting records, navigation). The kit can't tell a tool call made by the view from one made by the model, so those actions are only in People's own page in the browser. Needs app-only tools (MCP Apps `visibility: ["app"]`) in the kit, enforced by Ri.
2. **"Ask Ri", downloads and links don't work inside a chat.** The kit's view client has no way to stage a chat message, open a link or save a file. Needs those host calls in the kit's client (and a download call in Ri's host).
3. **The kit's portable backup can't restore People.** It copies the internal tables SQLite keeps for People's full-text search, and restoring them fails. A database-file restore (what `change` uses for rollback) works. Needs the kit's snapshot to skip FTS5 shadow tables.
4. **Ri can't link to a person, company or opportunity**, and **People's three skills can't ship with it**: MCP has no record registry or deep links, and the kit has no MCP prompts.
5. **People can't run on Cloudflare.** Its records need synchronous SQLite transactions, which D1 doesn't have and the kit doesn't expose. People never ran on Cloudflare, so this loses nothing it had, but it's a limit of the kit for apps like it.

Two things work only through stopgaps that depend on wording rather than structure, and should be fixed in the kit and Ri: finding which accounts Ri lent (K4, R1) and telling "not found" from other hub errors (K5).

What changed shape, and works:

- **Chats → connections.** In Ri the owner chose, per chat, which accounts, collections and imports it could use. Now each assistant connection (each Ri place, Claude, ChatGPT) chooses them on People's consent screen. The same filtering applies to every query.
- **Ri's grant → the hub.** People asks Ri's hub once for Gmail, Calendar and Ri's services. It finds which accounts it was lent by calling Gmail and Calendar, since neither Ri nor the kit has a way to list them (a stopgap, see gaps K4 and R2).
- **Ri's five-minute schedule → People's own job**, every five minutes, run by the kit.
- **Rich view context → the kit's bounded selection**: one selected record's id and title.
- **Ri's demo mode → `pnpm preview`**: the same fictional world, in a disposable data directory.

## Screens

| Feature (from the README) | Status | Notes |
| --- | --- | --- |
| Today: upcoming meetings, chosen follow-ups, waiting on, keep-in-touch reminders, birthdays, a short sourced review queue, says when nothing needs attention | Works | Same screen. Also `show_today` draws it as a card in a chat. |
| People directory: saved views, structured filters, sortable columns, views picker, lists | Works | Same screen and actions. |
| Selection of up to 50 loaded records for pin, list and archive changes | Works | In the screen. The assistant is told about one selected record only (see View context). |
| A person: header with sourced role and company, fields column, Overview (My read, living profile, briefing, commitments), Timeline, Notes, Details with corrections | Works | Same screen. `show_person` draws a short card in a chat that opens the whole app at that person. |
| Personal side: birthday (year optional), where they live, how you met, My read (never written by AI) | Works | |
| Relationships between two people, or a person and a name | Works | |
| Upcoming birthdays on Today | Works | |
| Living profile: cited summary, rewritten from the previous one plus what arrived since, needs extraction, never reads My read | Works | Through Ri's `ri__ai_text` on the hub. Ri answers `unsupported` unless its background harness is Claude, which People shows as extraction unavailable, as before. |
| Profile refresh for key people at most once a day, from the schedule's own accounts | Works | Runs in People's job (below). |
| Update on a person runs the profile from your own records now | Works | |
| Capture from chat ("met Sarah at dinner…"), with stated details, asks when a name matches several or none | Works | `capture_about_person` is an MCP tool. Writes need a connection allowed to make changes. |
| Companies (organizations): current, former and date-uncertain people, linked activity one row per thread, commitments, opportunities, notes | Works | |
| Follow-ups: I owe, Waiting on, Suggestions. Suggestions never become tasks until chosen | Works | `show_follow_ups` draws a card. |
| Create follow-up makes exactly one Ri task, even on retry | Works | Through `ri__create_task` with People's operation id, which Ri keeps per app. |
| Pipelines: optional, named stages with stable ids, opportunities on people or companies, append-only history, integer minor-unit values with explicit currency, board and list, Move to stage menu | Works | |
| Sources: account access, automatic updates, history range, coverage, imports, Extract switch, identity review, excluded senders, collections, export | Works differently | In People's own page only (see the first gap). "Account access" is no longer People's: which accounts People may read is chosen on People's page in Ri (the hub's consent). "Automatic updates" was Ri's per-grant switch: People's job updates every lent account, and Pause per account stays in Sources. "Connect email and calendar" sends you to People's Settings, where "Your accounts through Ri" connects the hub. |
| Add view and Hide view only change navigation | Works | |
| Welcome screen for a new owner with three ways in | Works differently | Same screen. "Connect" opens People's Sources; connecting accounts is in People's Settings (the kit's hub connection), not Ri's Sources. |
| Ask Ri buttons (on a person, company, opportunity) staging an editable chat draft | Can't work | The kit's view client can't stage a chat message (MCP Apps offers `ui/message`, which sends rather than stages, and the kit doesn't expose it). The buttons are hidden. Needs the kit's client to expose a message call, and Ri to stage rather than send. |
| Downloads from the view (export CSV and JSON) | Works differently | In People's own page the export downloads as before. Inside a chat the view says to open People in the browser: the kit's client has no download call (Ri's host had one). The kit's Settings also has "Download my data", which includes People's export (format version 2). |
| Opening links and directions from the view | Works differently | In the browser they open. Inside a chat they can't: the kit's client doesn't expose MCP Apps `ui/open-link`. |
| The view in Ri's dark mode and at every width | Works differently | Inside an assistant the kit puts the host's theme on `<html data-theme>`, which People's styles already follow. People's own page in the browser is always light (nothing sets the theme there). Not checked inside a real host, and not screenshot-tested at every width any more (the Ri packaging test is gone, see Tests). |

## Inputs

| Input | Status | Notes |
| --- | --- | --- |
| Gmail, selected accounts, read only | Works differently | Read through Ri's hub with OAuth: `gmail__get_profile`, `gmail__list_history`, `gmail__search_messages`, `gmail__get_message`, `gmail__read_message`, by name. The kit's mail capability (`mail().search/get`) isn't enough: it has no history cursor and only From/To/Cc/Subject/Date, while People needs List-Id, List-Unsubscribe, Precedence, Auto-Submitted, Message-ID and In-Reply-To. The hub returns those only from `read_message`. Which accounts: whatever the person allows People on its page in Ri. |
| Sent mail, confirmed direct replies and small meetings create people. Bulk, list and no-reply mail is left out by headers first | Works | Same rules on the full messages. |
| Google Calendar: meetings with participants, organizer, recurrence, time zone, cancellations | Works differently | Through `google_calendar__sync_events` and `google_calendar__list_calendars` by name. The kit's calendar capability (`calendar().listEvents`) and Ri's `list_events` have no attendees, organizer, recurrence or sync token, so People can't use them. |
| Meetings with you plus at most eight others create people, larger events are counted, events never imply attendance | Works | |
| CSV, vCard 2.1 to 4.0 and LinkedIn export: previewed before apply, unmapped columns kept, unambiguous birthdays only, imported details never overwrite yours | Works | File choice works in the browser and inside a chat (a file input). Files up to 512 KiB and 5,000 rows. |
| Ri tasks for follow-ups, one per follow-up, Ri owns status | Works | `ri__create_task` and `ri__get_task`. Ri treats them as the person's own data, so no approval is asked. |
| Ri bounded AI (`ai_text`), off until enabled, separate from sync, no call anywhere when off | Works | `ri__ai_text` on the hub. A test checks no call happens with it off. |
| `extract_text` | Works | Requested on the hub as `ri__extract_text`. People's current code doesn't call it (the old app asked for it too). |

## Updating from accounts

| Rule | Status | Notes |
| --- | --- | --- |
| Ri's single five-minute schedule ran People's bounded steps | Works differently | People declares its own job, "Update from your accounts", every five minutes. The kit runs it, shows it in Settings with its last and next run and Run now, and survives restarts. Each run first asks the hub which accounts it lends, then runs People's same bounded steps until nothing is due or 2.5 minutes pass (Ri ran one step per call). |
| One provider page and at most ten new messages per step, current changes before history, fair rotation between accounts | Works | People's own step queue is unchanged. |
| History limited to 30, 90 or 365 days (90 for mail, a year for calendar by default) | Works | |
| An expired history cursor restarts a bounded rescan; deleted messages become unavailable; canceled events stay canceled | Works | The kit's client keeps only the hub's message for a failed call, not its code, so People reads "not found" from the message (gap K5). |
| A revoked account needs reconnecting while others keep syncing | Works differently | When the hub stops lending an account, People shows it as no longer granted. When the whole hub needs reconnecting, the job's run fails with "Ri needs you to connect this app again" and keeps every checkpoint. When Ri is unreachable the run retries later. |
| A step and its records commit together; an interrupted step resumes from its last committed page | Works, better | In Ri the step held a write transaction while it waited on the network. Now it reads first and stores records and checkpoint in one short transaction, because the kit writes to the same file from its own connection. |
| Calls carry which job made them, for Ri's audit log | Works | The kit adds `_meta["app/job"]` and `["app/jobRun"]`. |
| Writes that reach outside wait for approval | Not applicable | People never sends, posts or invites. Its only writes outside itself are Ri tasks, which Ri treats as the person's own data. |

## Identity rules

All work, unchanged, with their tests: email normalization (trim, lower-case only the domain, never strip dots or plus suffixes), exact address joins its person unless a shared inbox, shared role mailboxes are never a person, names, companies and domains only propose a review, a pair kept separate is never proposed again, signature addresses propose an alias with evidence, personal mail domains never imply a company, calendar co-attendance implies no relationship or employer, your corrections win and survive resync and re-extraction, merges record every reference they move, undo previews, lists later references and fails without changes if anything moved, relationships follow merges.

"Your corrections survive backup restore": works for a database-file restore; the kit's portable backup can't restore People yet (gap K2).

## Privacy and access

| Rule | Status | Notes |
| --- | --- | --- |
| Every query, search, count, sort key, snippet, briefing and export filtered by the caller's sources first | Works | Unchanged code. Callers are now: your browser (everything), an assistant connection (its chosen sources) and the job (the accounts Ri lends). |
| A chat sees only the sources the owner chose for it, read or read and write | Works differently | Chosen per connection on People's consent screen (the kit's): accounts, your collections and imports, and whether it may also make changes. Each Ri place connects separately, so each has its own choice. Changed in People's Settings (disconnect and reconnect). People's own "choose what this chat can use" screen is gone. |
| Deleting an import or collection removes it from every chat's scope | Works differently | The kit keeps each connection's choice as made. People ignores chosen sources that no longer exist, so the effect is the same. |
| A cached write is returned on retry only while the caller's access is unchanged | Works | A write with a `requestId` is done once. People's view sends one with each write. |
| Generated briefings cached by exact scope and evidence; an owner briefing never reaches a narrower chat | Works | |
| The schedule generates briefings only from its granted accounts and never sends notes or private opportunities to AI | Works | The job is limited to the lent accounts, as Ri's schedule was. |
| An opportunity is visible only when both it and its pipeline are | Works | |
| Search never indexes a private company name under a shared source; old rows rebuilt once at startup | Works | |
| Personal details and relationships shown only to readers of their collection | Works | |
| Owner-only actions (sources, imports, export, merges, identity review, delete, navigation, pipeline structure, exclusions, collections) | Works differently | Only in People's own page in your browser. Inside Ri's view of People they're unavailable (first gap above). A connection with every source and write access still isn't the owner. |
| Only the owner uses People | Works differently | People is one person's relationships. On a signed-in installation, other accounts are refused. |
| Export: CSV and JSON with stable ids and a format version, never message bodies, not a full backup | Works | From Sources in the browser, and in the kit's "Download my data". |
| Delete imported data keeps your notes and decisions | Works | |

## Limits

All unchanged and enforced by the same code: lists 50 by default and at most 100; selection and bulk changes at most 50 loaded records; imported files 512 KiB and 5,000 rows; chat context at most 20 facts or commitments and 20 interaction references within 16 KiB; AI prompts at most 16,000 characters, marked untrusted, results checked against a strict format with exact passages; list, search and detail under 300 ms at p95 on 10,000 people, 1,000 companies and 100,000 interactions (`test/performance.test.ts`, now on the kit's better-sqlite3 rather than node:sqlite).

## In an assistant

| Feature | Status | Notes |
| --- | --- | --- |
| People's actions available to chats | Works | 40 of People's actions are MCP tools, plus `get_record_title`, the four cards and `open_people` (46 in all), each with an output schema. Owner-only ones aren't (above). |
| The People view opened in Ri (`open_view`, entry points global and thread) | Works differently | `open_people` (added by the kit) opens the whole app full screen. `open_view` stays as the data the screens load. |
| Cards in a chat | Works, new | `show_people`, `show_person`, `show_follow_ups` and `show_today`. Ri drew only the whole view. |
| View context: section, filters and up to 50 selected records, re-resolved for the receiving chat (`describe_view_context`) | Works differently | The kit sends one selected record's id and title (its bounded selection). `get_record_title` gives the title only for records the connection may see. `describe_view_context` remains a tool an assistant can call. Needs a richer selection in the kit, or Ri calling `describe_view_context`, to match. |
| Record types with read actions and paths, so Ri could link to a person, company or opportunity | Can't work | MCP has no record registry or deep links into an app. A card opens the whole app at a record in the same frame. Needs an entry point with a path in the kit and Ri (MCP Apps has none today). |
| Skills: prepare for a meeting, remember about someone, review follow-ups | Can't work as skills | An MCP server can't ship skills, and the kit has no MCP prompts. Their rules are in the tool descriptions. Needs MCP prompts in the kit (and Ri to offer them), or Ri loading skills from an app's repository. The skills are kept in `legacy/skills`. |
| Approval policy on the app's own tools | Works | Ri's connected-app host applies it, as for any MCP server. |

## Data and running

| Feature | Status | Notes |
| --- | --- | --- |
| Records in SQLite with forward-only, immutable migrations | Works differently | The kit's migrations (checksum-checked): People's three Ri migrations, with one statement per chunk, plus one for the tables Ri's kit created at startup. People's code reads and writes them with its own synchronous connection to the kit's `data.sqlite` (gap K1). |
| Evidence text in files in the data directory | Works differently | In the database (`evidence_blobs`), so the kit's backups and `change` snapshots carry it. |
| Backup and restore keep every id and decision | Works differently | A copy of the database file restores fully (that's what `change` snapshots and rolls back). The kit's portable `backup`/`restore` fails on People's full-text index (gap K2). |
| Demo mode with fictional records, no account read | Works differently | `pnpm preview`: a disposable data directory, `PEOPLE_PREVIEW=1` makes your page the fictional preview (seeded on first open, nothing reaches the hub), and `APP_CONNECTORS=fixtures` answers any hub call from `fixtures/connectors.json`. |
| Runs as a Mac service, changed safely | Works | `serve --install`, `change`. Checked with `--service process`. |
| Runs on Cloudflare | Can't work | Gap K1. The Worker entry answers 501 with the reason. |
| Ri starts People on demand | Works differently | People runs on its own as a service; Ri connects to it. |

## Tests

Every old test file is ported and passes through the kit's adapter, except the packaged-view test:

| Old test | Now |
| --- | --- |
| briefing-text, capture, extraction, followups, identity, imports, merge, performance, personal, pipelines, preview, profiles, review-leaks, scopes, sync | Pass. Each call goes through People's kit action as the kit runs it: your browser, a connection with its recorded choice (made with the kit's `createTestConnection`), or the job. Hub calls go to a fake hub that answers with Ri's tool names, `account` argument, choose-account answer and errors as the kit's client reports them. |
| contract | Rewritten for the kit: every action converted, examples still parse, audiences, MCP tools are exactly the agent actions plus the views and `open_people`, every tool has an output schema, job and connectors in the contract. |
| release | Passes. Its two restores use a database copy. A new expected-failure test records the kit backup gap: it starts failing (as unexpectedly passing) when the kit fixes it. |
| view.packaged (Ri packaging, AppEngine, screenshots at widths and dark mode) | Removed with Ri's app engine. Replaced by a browser check of the preview (Today, directory, a person) and `test/kit.test.ts` for the view tools and resource. Width and dark-mode screenshots aren't automated any more. |
| New: kit | The job finding accounts (several by name, one by address), duplicate wake-ups, a hub that's down or revoked, MCP with tokens and per-connection sources, the cards, the view's empty network policy, and the kit's own fixture source. |

## Gaps in the kit

- **K1. No synchronous transactions.** The kit gives apps an async SQL driver with atomic batches only. People's domain code is synchronous SQL in transactions (merge and undo check and apply atomically; a sync step stores records and its checkpoint together). People opens its own better-sqlite3 connection to the kit's `data.sqlite` in the same process (found with `PRAGMA database_list`). It works and is tested, but it's outside the kit's design and makes People Node-only. A kit `platform.transaction(fn)` on Node, documented as Node-only, would make this supported.
- **K2. The portable backup can't restore FTS5.** `snapshotDatabase` copies every table, including `search_fts_*` shadow tables, and `restoreNode` fails with "object name reserved for internal use". The snapshot should skip shadow tables of virtual tables (and their rows), recreate virtual tables from their SQL, and let the app rebuild them.
- **K3. The capability shapes are too thin for People, and the fixture source can't stand in for pass-through tools.** `MailMessage` has no list or reply headers; `CalendarEvent` has no attendees, organizer, recurrence or time zones; neither has an incremental cursor. People passes Ri's tools through by name. The fixture source answers a pass-through tool with one fixed result whatever the arguments, so People's mail and calendar sync can't run under `APP_CONNECTORS=fixtures` (the job leaves the account waiting with the reason). People's tests use their own fake hub with Ri's tool shapes. Adding headers and attendees to the capability shapes, or letting fixtures answer by arguments, would close this.
- **K4. No way to know which accounts the hub lent.** `connectors(ctx).tools()` returns names only, and a call without `account` when several are lent becomes a `SetupRequired` whose message lists them. People reads the list from that message, and for one account asks `gmail__get_profile` and the primary calendar. It works with Ri as built but depends on message wording. The kit should return each tool's allowed accounts (from the `account` parameter's description or a structured answer).
- **K5. Pass-through errors lose their code.** The kit's client turns a hub error into a plain `Error` with the message, dropping `code`. People needs "not found" (expired history, deleted message, expired sync token) and "unsupported" (AI unavailable), and reads them from the message.
- **K6. No app-only tools.** Tools the view needs but the model shouldn't call (People's owner-only actions) can't be declared. MCP Apps has `visibility: ["app"]`, but only the host can enforce it, so Ri would need to as well.
- **K7. The view client lacks host calls.** No message (Ask Ri), open link or download.
- **K8. The selection is one record.** Ri got the section, filters and up to 50 selected records.
- **K9. Connection choices keep sources that were deleted.** People filters them out itself; the kit could drop them when an app says a source is gone.
- **K10. No MCP prompts**, so apps can't offer skills-like workflows.
- **K11. No upgrade command on `main` yet.** See "Kit version" below.

## Gaps in Ri

- **R1. Account identity across Gmail and Calendar.** With one account lent, Ri's tools have no account name, so People uses the Gmail address and the primary calendar's id. With several, People uses Ri's allowed names (an address or a label). If Ri names a connection by label, one Google account's mail and calendar can end up as two sources in People. Ri should give each lent account a stable id, the same across its tools, and a way to list them (K4).
- **R2. `ri__ai_text` needs the Claude harness.** Otherwise extraction, briefings and profiles show as unavailable, as they did in Ri.
- **R3. Ri doesn't run apps any more.** People must be installed as a service (`serve --install`) before Ri can connect it.
- **R4. Not checked against Ri itself.** OAuth from Ri's client, Ri's hub consent with these tools, and Ri's view host were not run (a later session checks every ported app in Ri).

## Kit version

Built from kit `main` at `bc2c7f4` (core 0.2.0, vendored in `vendor/`). Before finishing, `origin/main` was still `bc2c7f4`:
- The refresh-token fix (rotate refresh tokens, revoke a connection when one is reused) is on the kit's `claude/refresh-token-rotation` branch, not on `main`. People doesn't have it.
- There's no upgrade command on `main` (it's on the kit's `claude/app-commands` branch). Until it lands, taking a kit fix means replacing `vendor/app-builder-core-*.tgz` and the lockfile by hand, then `change`.

## Evidence

- `pnpm typecheck`, `pnpm build` and `pnpm test` pass: 18 files, 122 tests, and 1 expected failure (the kit backup gap, K2). The build writes 46 MCP tools to `dist/contract.json`.
- `pnpm exec app-builder serve --install --service process` with a disposable `APP_DATA_DIR` ran resolve, copy, install, typecheck, test, build, rehearse, stop, snapshot and switch, and `/api/health` answered with the new release. (Its first try refused to switch because a test that depended on two records saved in the same millisecond failed in the copy; fixed.) Then `change --json` switched the running app to a later commit with its records kept. No launchd service was installed.
- `scripts/oauth-check.mjs`, a standard MCP client (`@modelcontextprotocol/sdk` 1.32.2), against that running app: 401 with `resource_metadata`, dynamic registration, PKCE S256, People's consent screen in a browser with no sign-in (chose only the "Work" collection and read-only), token with a refresh token, 46 tools; `list_people` returned only the Work person, `show_today` drew its card, and `capture_about_person` was refused: "Ri · Work can read but not make changes."
- A browser check of `pnpm preview`'s fictional world: Today, the directory and a person's page render on the kit's client.
- Hub features are tested two ways: against a fake hub with Ri's tool names and shapes (`test/helpers.ts`), and against the kit's own fixture source (`test/kit.test.ts`), which drives Ri's task services and shows where it can't drive People's sync (K3).
- Not run: Ri itself (its client, its hub's consent, its view host), Claude or ChatGPT, a real Gmail or Calendar account, and People's full view inside an MCP Apps host.
