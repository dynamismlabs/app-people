# People: parity with People in Ri

People ran inside Ri as an included app (`apps/people` at Ri commit `3c442810`, on `@ri/app-kit`). It now runs on App Builder as its own MCP server with its own data. This list takes every feature and rule in the old README, AGENTS.md and plugin manifest, and every test, and marks each one:

- **Works**: the same behavior, checked by a test that runs through the kit (see Evidence).
- **Works differently**: available, with the difference said.
- **Works in hosts**: was browser-only or missing inside a chat, and now works inside a host's view too.
- **Can't work**: not possible on the new path today, with why and what would have to change in the kit or in Ri.

Lines about People's view inside an assistant say what each host did. Ri was checked on November 16, 2026 in a **disposable Ri at f55cdf96** on this Mac, on the web (headless Chromium) and in Ri's desktop app (source Electron), with dummy records only. It was not a Ri Home in everyday use, which runs on another computer. ChatGPT and Claude are still pending. The results are in [Real hosts](#real-hosts), with screenshots in `docs/parity/`.

First checked on November 12, 2026 against kit `main` `bc2c7f4` (core 0.2.0). Updated on November 16, 2026 for core 0.2.2 (kit `main` `1713f6a`, "the full app in every host"), and on November 17, 2026 for kit `main` `ff47742` (still core 0.2.2, with the kit gaps the four ports found fixed in dynamismlabs/mcp-app-builder#10), then for kit `main` `df533b0` (#11 and #12) with Ri's `not_found` from dynamismlabs/ri#7, and for kit `main` `a8e9b5d` (#13), on which People `v0.1.1` was switched. Then for kit `main` `023f92f` (#14 to #17: upgrades built with the service's Node, `transaction(ctx, work)` on Node, Settings inside the view, browser clients and add-only connections), on which People `v0.1.2` moved onto the core's transactions. Then for kit `main` `7b1ba65` (#18: cheap transactions, and `upgrade` installing the new core in the app folder; #19: add-only by scope), for `v0.1.3`. Then for kit `main` `73c5266` (#20 to #25: server instructions, MCP prompts, fixtures that answer by their arguments, token revocation) and `e44b499` (#26: prompt arguments from an app's own zod), for `v0.1.4`. Ri's hub was read from its code; Ri itself wasn't run.

## The short version

**Almost everything People did works on App Builder: its screens, data, rules, imports, sync, AI features, follow-ups and privacy model, with all of its tests.** With core 0.2.2, People's whole app also works inside a host, including the person's own work, which was browser-only before (verified in the test host and in a disposable Ri at f55cdf96 on the web and desktop. ChatGPT and Claude pending):

- **The person's own work inside a host.** Sources, imports, export, identity review, merges, archiving and deleting, navigation and pipeline structure are view-only tools: the host keeps them from the model, and the view's call acts as the owner when the connection was given every source.
- **Opening at a record.** `open_people` takes a path (`/people/<id>`), host links (`openai/deepLink`) move the open app, cards open it at one record, and people and companies are in the host's @ menu.
- **Leaving the frame through the host.** Ask Ri drafts a question in the chat (shown to copy in a host that doesn't draft), export saves files with `ui/download-file`, links open with `ui/open-link`, and Open in browser is always in the header.
- **Settings inside the host.** The header's Settings, and Sources' Connect an account, open the core's Settings in the same frame: the connections and their access, connecting Ri, and People's job. Signing in, the account and downloading data stay in the browser.
- **The wider selection.** The assistant gets the section, its path and filters, the open record, and a bulk selection of up to 50 records.

Still blocked:

1. **A connection limited to some sources can't do the person's own work.** That's People's rule, as in Ri: Sources and merges cover every account, so only a connection with every source acts as the owner. Use Open in browser.
2. **The person's own work is only as safe as the host's visibility rule.** A host that ignores `visibility: ["app"]` would let its model call those tools. Ri enforces it; ChatGPT and Claude are unchecked. A host's rule, not something the app can check (the view and the model share one connection).
3. **People can't run on Cloudflare yet.** Its transactions read their own writes, which the core runs on Node only until an installation's database can live in a Durable Object on Workers (the kit's `docs/transactions-on-workers.md`). People declares `platforms: ["node"]`, so `deploy cloudflare` refuses it. People never ran on Cloudflare, so this loses nothing it had.

People's three skills from Ri are MCP prompts now (K10, closed), and People tells an assistant how its tools fit together when it connects. Its sync runs end to end on the kit's own fixtures (K3's fixture half, closed). The kit's portable backup now restores People, search included (K2, closed). Downloads work inside Ri since dynamismlabs/ri#2 (R5).

Hub errors are told apart by their code now (K5, closed): since dynamismlabs/ri#7 a Gmail or Calendar 404 or 410 reaches People as `not_found` with the provider's status, and Ri's own services say `unsupported` by code. People reads the message only for a hub from before ri#7. Finding which accounts Ri lent reads the kit's structured answer (K4). People's account keys still wait on Ri's stable ids (R1).

What changed shape, and works:

- **Chats → connections.** In Ri the owner chose, per chat, which accounts, collections and imports it could use. Now each assistant connection (each Ri place, Claude, ChatGPT) chooses them on People's consent screen. The same filtering applies to every query.
- **Ri's grant → the hub.** People asks Ri's hub once for Gmail, Calendar and Ri's services. It finds which accounts it was lent by calling Gmail and Calendar: one account answers with its address, several with the names to choose from, which the kit passes on structured (`SetupRequired.accounts`). The kit can also list lent accounts with Ri's stable ids (`accounts()`, `ri__list_accounts`), but People keys accounts by address, so moving to those ids needs a data migration (R1).
- **Ri's five-minute schedule → People's own job**, every five minutes, run by the kit.
- **Ri's view context → the kit's bounded context**: the section, its path and filters, the open record and up to 50 selected records.
- **Ri's demo mode → `pnpm preview`**: the same fictional world, in a disposable data directory.

## Screens

| Feature (from the README) | Status | Notes |
| --- | --- | --- |
| Today: upcoming meetings, chosen follow-ups, waiting on, keep-in-touch reminders, birthdays, a short sourced review queue, says when nothing needs attention | Works | Same screen. Also `show_today` draws it as a card in a chat. |
| People directory: saved views, structured filters, sortable columns, views picker, lists | Works | Same screen and actions. |
| Selection of up to 50 loaded records for pin, list and archive changes | Works | In the screen. The assistant gets the selected records' names and how many (the kit's `selectMany`). Verified in the test host. In Ri it doesn't reach a message from the full screen: Ri drops a screen's context when it closes, and its full screen has no chat beside it (Ri gap R9). ChatGPT and Claude pending. |
| A person: header with sourced role and company, fields column, Overview (My read, living profile, briefing, commitments), Timeline, Notes, Details with corrections | Works | Same screen. `show_person` draws a short card in a chat that opens the whole app at that person (`openFullscreen(path)`). Verified in the test host. In Ri (web and desktop) the person's screen works full screen, and Ri's link opens it at `/people/<id>`. The `show_person` card needs a model's call, which the disposable Ri couldn't make. ChatGPT and Claude pending. |
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
| Sources: account access, automatic updates, history range, coverage, imports, Extract switch, identity review, excluded senders, collections, export | Works differently | In People's own page, and inside a host for a connection with every source: its tools are view-only and the view acts as the owner (verified in the test host, and in Ri on the web and desktop, where export and import ran from the view). A connection limited to some sources gets "sees only part of People" and Open in browser. "Account access" is no longer People's: which accounts People may read is chosen on People's page in Ri (the hub's consent). "Automatic updates" was Ri's per-grant switch: People's job updates every lent account, and Pause per account stays in Sources. "Connect email and calendar" leads to People's Settings, where "Your accounts through Ri" connects the hub; inside a host it opens Settings in the browser. |
| Add view and Hide view only change navigation | Works | |
| Welcome screen for a new owner with three ways in | Works differently | Same screen. "Connect" opens People's Sources; connecting accounts is in People's Settings (the kit's hub connection), not Ri's Sources, and inside a host that opens in the browser. |
| Ask Ri buttons (on a person, company, opportunity) staging an editable chat draft | Works in hosts | The kit's `AskInChat`: a draft in the chat (`ui/message` with `openai/message` `send: false`) in a host that drafts, as Ri does; the question to copy in one that doesn't; nothing in the browser, where there's no chat. Verified in the test host (draft never sent, and the copy fallback). In Ri, web and desktop: Ask Ri put the question in the main chat's draft, unsent, and Ri said where ("People wrote a message for you. It's in your main chat's draft, ready when you are."). ChatGPT and Claude pending. |
| Downloads from the view (export CSV and JSON) | Works in hosts that save files | In the browser, a download. Inside a host with `ui/download-file`, the file goes to the host embedded (verified in the test host). Ri has it since dynamismlabs/ri#2. In Ri, web and desktop: export showed Ri's card ("People wants to save people-people.csv (387 bytes)", Save and Don't save), and Save wrote the file. ChatGPT and Claude pending. The kit's Settings also has "Download my data", which includes People's export (format version 2). |
| Opening links and directions from the view | Works in hosts | Through the host's `ui/open-link` (`client.openLink`); where a host can't or refuses, the address shows to copy. People's screens open few links; Open in browser is the main one and is verified in the test host. In Ri it opened `http://127.0.0.1:4311/people/<id>` in a browser tab on the web, and in the system browser from the desktop app. ChatGPT and Claude pending. |
| The view in Ri's dark mode and at every width | Works differently | Inside an assistant the kit puts the host's theme on `<html data-theme>`, which People's styles already follow. People's own page in the browser is always light (nothing sets the theme there). In Ri, which has only a dark theme, People follows it on the web and desktop. One flaw: Open in browser at the top right is dark green on near black and hard to read. It fits 390 px wide with no sideways scroll, and fills the desktop window (1396 by 807 px). Light inside a host is unchecked, since Ri has no light theme. ChatGPT and Claude pending. |

## Inputs

| Input | Status | Notes |
| --- | --- | --- |
| Gmail, selected accounts, read only | Works differently | Read through Ri's hub with OAuth: `gmail__get_profile`, `gmail__list_history`, `gmail__search_messages`, `gmail__get_message`, `gmail__read_message`, by name. The kit's mail capability (`mail().search/get`) isn't enough: it has no history cursor and only From/To/Cc/Subject/Date, while People needs List-Id, List-Unsubscribe, Precedence, Auto-Submitted, Message-ID and In-Reply-To. The hub returns those only from `read_message`. Which accounts: whatever the person allows People on its page in Ri. |
| Sent mail, confirmed direct replies and small meetings create people. Bulk, list and no-reply mail is left out by headers first | Works | Same rules on the full messages. |
| Google Calendar: meetings with participants, organizer, recurrence, time zone, cancellations | Works differently | Through `google_calendar__sync_events` and `google_calendar__list_calendars` by name. The kit's calendar capability (`calendar().listEvents`) and Ri's `list_events` have no attendees, organizer, recurrence or sync token, so People can't use them. |
| Meetings with you plus at most eight others create people, larger events are counted, events never imply attendance | Works | |
| CSV, vCard 2.1 to 4.0 and LinkedIn export: previewed before apply, unmapped columns kept, unambiguous birthdays only, imported details never overwrite yours | Works | In the browser, and inside a host: a file input in the sandboxed frame, then the preview and Import (verified in the test host. In Ri, web and desktop, the file chooser opened from the sandboxed frame, and a dummy CSV previewed and imported. ChatGPT and Claude pending.). Files up to 512 KiB and 5,000 rows. |
| Ri tasks for follow-ups, one per follow-up, Ri owns status | Works | `ri__create_task` and `ri__get_task`. Ri treats them as the person's own data, so no approval is asked. |
| Ri bounded AI (`ai_text`), off until enabled, separate from sync, no call anywhere when off | Works | `ri__ai_text` on the hub. A test checks no call happens with it off. |
| `extract_text` | Works | Requested on the hub as `ri__extract_text`. People's current code doesn't call it (the old app asked for it too). |

## Updating from accounts

| Rule | Status | Notes |
| --- | --- | --- |
| Ri's single five-minute schedule ran People's bounded steps | Works differently | People declares its own job, "Update from your accounts", every five minutes. The kit runs it, shows it in Settings with its last and next run and Run now, and survives restarts. Each run first asks the hub which accounts it lends, then runs People's same bounded steps until nothing is due or 2.5 minutes pass (Ri ran one step per call). |
| One provider page and at most ten new messages per step, current changes before history, fair rotation between accounts | Works | People's own step queue is unchanged. |
| History limited to 30, 90 or 365 days (90 for mail, a year for calendar by default) | Works | |
| An expired history cursor restarts a bounded rescan; deleted messages become unavailable; canceled events stay canceled | Works | People reads the hub's `not_found` code and the provider's status (K5). Gmail's expired history (404) rescans and a deleted message (404) becomes unavailable. Calendar restarts its window only for an expired sync token (410): a missing calendar (404) fails the step and keeps the token. A hub from before dynamismlabs/ri#7 sends these as `provider_error`, and People reads the status from its message instead. Both are tested (`test/sync.test.ts`), and Gmail's 404 and Calendar's 410 also run on the kit's fixture source (`test/fixtures.test.ts`). |
| A revoked account needs reconnecting while others keep syncing | Works differently | When the hub stops lending an account, People shows it as no longer granted. When the whole hub needs reconnecting, the job's run fails with "Ri needs you to connect this app again" and keeps every checkpoint. When Ri is unreachable the run retries later. |
| A step and its records commit together; an interrupted step resumes from its last committed page | Works, better | In Ri the step held a write transaction while it waited on the network. Now it reads first and stores records and checkpoint in one short transaction, because the kit writes to the same file from its own connection. |
| Calls carry which job made them, for Ri's audit log | Works | The kit adds `_meta["app/job"]` and `["app/jobRun"]`. |
| Writes that reach outside wait for approval | Not applicable | People never sends, posts or invites. Its only writes outside itself are Ri tasks, which Ri treats as the person's own data. |

## Identity rules

All work, unchanged, with their tests: email normalization (trim, lower-case only the domain, never strip dots or plus suffixes), exact address joins its person unless a shared inbox, shared role mailboxes are never a person, names, companies and domains only propose a review, a pair kept separate is never proposed again, signature addresses propose an alias with evidence, personal mail domains never imply a company, calendar co-attendance implies no relationship or employer, your corrections win and survive resync and re-extraction, merges record every reference they move, undo previews, lists later references and fails without changes if anything moved, relationships follow merges.

"Your corrections survive backup restore": works for a database-file restore and, since kit `ff47742`, for the kit's portable backup (`test/release.test.ts`).

## Privacy and access

| Rule | Status | Notes |
| --- | --- | --- |
| Every query, search, count, sort key, snippet, briefing and export filtered by the caller's sources first | Works | Unchanged code. Callers are now: your browser (everything), an assistant connection (its chosen sources) and the job (the accounts Ri lends). |
| A chat sees only the sources the owner chose for it, read or read and write | Works differently | Chosen per connection on People's consent screen (the kit's): accounts, your collections and imports, and whether it may also make changes. Each Ri place connects separately, so each has its own choice. Changed in People's Settings (disconnect and reconnect). People's own "choose what this chat can use" screen is gone. |
| Deleting an import or collection removes it from every chat's scope | Works | The kit drops a deleted source from every connection's choice and saves that, so a choice left empty sees nothing (kit `ff47742`). People no longer filters connections' choices itself. Tested over MCP (`test/kit.test.ts`, a deleted import) and by the replay test in `test/review-leaks.test.ts`, whose calls now get their connection from the kit's own sign-in. |
| A cached write is returned on retry only while the caller's access is unchanged | Works | A write with a `requestId` is done once. People's view sends one with each write. |
| Generated briefings cached by exact scope and evidence; an owner briefing never reaches a narrower chat | Works | |
| The schedule generates briefings only from its granted accounts and never sends notes or private opportunities to AI | Works | The job is limited to the lent accounts, as Ri's schedule was. |
| An opportunity is visible only when both it and its pipeline are | Works | |
| Search never indexes a private company name under a shared source; old rows rebuilt once at startup | Works | |
| Personal details and relationships shown only to readers of their collection | Works | |
| Owner-only actions (sources, imports, export, merges, identity review, delete, navigation, pipeline structure, exclusions, collections) | Works in hosts | View-only tools (MCP Apps `visibility: ["app"]`): the host keeps them from the model and refuses the model's call, and the view's call acts as the owner when the connection was given every source. Writes still need a connection that may write. A limited connection is refused ("sees only part of People"). It's the host's rule: Ri enforces it, and a host that ignores it would let its model call them. Verified in the test host (model refused, view allowed, limited connection refused). In Ri, the model's path refused `delete_record`, `merge_people` and `export_records` ("This tool is not available to this caller."), and the view's archive, export and import went through. ChatGPT and Claude pending. |
| Only the owner uses People | Works differently | People is one person's relationships. On a signed-in installation, other accounts are refused. |
| Export: CSV and JSON with stable ids and a format version, never message bodies, not a full backup | Works | From Sources, in the browser or a host that saves files, and in the kit's "Download my data". |
| Delete imported data keeps your notes and decisions | Works | |

## Limits

All unchanged and enforced by the same code: lists 50 by default and at most 100; selection and bulk changes at most 50 loaded records; imported files 512 KiB and 5,000 rows; chat context at most 20 facts or commitments and 20 interaction references within 16 KiB; AI prompts at most 16,000 characters, marked untrusted, results checked against a strict format with exact passages; list, search and detail under 300 ms at p95 on 10,000 people, 1,000 companies and 100,000 interactions (`pnpm test:perf`, now in the core's transactions on the kit's own better-sqlite3 connection rather than node:sqlite, and checked by query plan in `pnpm test`).

## In an assistant

| Feature | Status | Notes |
| --- | --- | --- |
| People's actions available to chats | Works | 71 MCP tools, each with an output schema: 44 the model sees (People's actions, the four cards and `open_people`) and 27 view-only (the person's own work, `open_view`, `get_record_title`, and the kit's `search_mentions`, `read_settings` and `change_settings`). |
| The People view opened in Ri (`open_view`, entry points global and thread) | Works differently | `open_people` (added by the kit) opens the whole app full screen, at a path when given (`/people/<id>`, `/companies/<id>`, `/opportunities/<id>` or a section), and the open app follows host links. `open_view` stays as the data the screens load, now view-only. Verified in the test host. In Ri, web and desktop: Open app opened it full screen, and Ri's link (`?open=open_people&path=/people/<id>`) opened it at that person. That works only when People is added with **Add MCP server**: through **Add app**, Ri can't open any app's screen yet (Ri gap R8). ChatGPT and Claude pending. |
| Cards in a chat | Works, new | `show_people`, `show_person`, `show_follow_ups` and `show_today`. Ri drew only the whole view. |
| View context: section, filters and up to 50 selected records, re-resolved for the receiving chat (`describe_view_context`) | Works in hosts | The kit's bounded context: the section, its path, its filters by name, the open record and up to 50 selected records with the total. Names come from `get_record_title`, only for records the connection may see. The assistant reads the records themselves with its own access. `describe_view_context` remains a tool. Verified in the test host. In Ri it doesn't reach a message from the full screen (Ri gap R9). ChatGPT and Claude pending. |
| Record types with read actions and paths, so Ri could link to a person, company or opportunity | Works in hosts | People declares its records: `open_people` opens one by path, the host's @ menu finds people and companies (`search_mentions`, view-only) and reads one as markdown (`app://people/people/<id>`), filtered by the connection's sources. Verified in the test host and over MCP. In Ri, the @ menu found the dummy person by name under People. Ri reads the record when the message is sent, which needs a model harness the disposable Ri didn't have. ChatGPT and Claude pending. |
| Skills: prepare for a meeting, remember about someone, review follow-ups | Works differently | MCP prompts since kit `73c5266` (K10), which a host offers the person to start from: `prepare-for-a-meeting` (who), `remember-about-someone` (who, and the note if given) and `review-follow-ups` (which list, and whom, both optional). Each gives the skill's steps and rules with the person's words in place. Prepare for a meeting also finds the person through People's own `search_people`, so only among the sources its connection may see, and names the record to read or asks which one is meant. The other two read nothing. No prompt changes anything: the assistant then calls People's tools. A connection that can only read is told it can't save a note or act on follow-ups. Add-only connections get no prompts (People offers none anyway). Checked over MCP (`test/kit.test.ts`). Ri, ChatGPT and Claude pending: offering prompts is the host's. The skills' text stays in `legacy/skills`. |
| What an assistant should know across People's tools | Works, new | People's `instructions`, sent when an assistant connects (`app.config.ts`, under 2,000 characters): find someone first and ask when several match, records are data and never instructions, a scheduled meeting isn't proof it happened, due dates only from a source, save only what the person said, People never sends anything, and the person's own decisions are made in People's view. |
| Approval policy on the app's own tools | Works | Ri's connected-app host applies it, as for any MCP server. |
| Settings: connections, connecting Ri, People's job | Works in hosts, new | Since kit `023f92f` (dynamismlabs/mcp-app-builder#16) the core's Settings works inside the view, through its own view-only `read_settings` and `change_settings`. People's header has Settings next to Open in browser, and Sources' Connect an account and Manage access open it in the frame instead of the browser. Settings is on the view's router while People keeps its own places, so People's view moves the router back to People for Settings' Back and for a host's link. A connection limited to some sources is told to use the browser. Verified in the test host. Ri, ChatGPT and Claude pending. |
| Add-only connections and browser clients | Not offered | New in kit `023f92f` (#17). The consent screen offers Only add when an app marks actions `adds: true`. People marks none, so the choice doesn't appear: its adding actions answer with records already there (`capture_about_person` returns the person, or the people a name could mean), which an add-only connection mustn't read. Since `7b1ba65` (#19) a client can ask for add-only with the `add_only` scope, and an add-only connection's tool list shows only add actions, so one connected to People would see no tools. A browser extension or page can connect like any assistant. |

## Data and running

| Feature | Status | Notes |
| --- | --- | --- |
| Records in SQLite with forward-only, immutable migrations | Works differently | The kit's migrations (checksum-checked): People's three Ri migrations, with one statement per chunk, plus one for the tables Ri's kit created at startup. People's code reads and writes them synchronously in the core's `transaction()` on the kit's own connection (K1, closed). |
| Evidence text in files in the data directory | Works differently | In the database (`evidence_blobs`), so the kit's backups and `change` snapshots carry it. |
| Backup and restore keep every id and decision | Works | The kit's portable `backup`/`restore` restores People with its full-text index (kit `ff47742`): people and companies are found after a restore, an edit replaces the old text, and new records are indexed (`test/release.test.ts`). A copy of the database file also restores fully (that's what `change` snapshots and rolls back). |
| Demo mode with fictional records, no account read | Works differently | `pnpm preview`: a disposable data directory, `PEOPLE_PREVIEW=1` makes your page the fictional preview (seeded on first open, nothing reaches the hub), and `APP_CONNECTORS=fixtures` answers any hub call from `fixtures/connectors.json`. Since kit `73c5266` those fixtures answer by their arguments, so People's sync reads a fictional mailbox and calendar from them end to end (K3). |
| Runs as a Mac service, changed safely | Works | `serve --install`, `change`. Checked with `--service process`. |
| Runs on Cloudflare | Can't work yet | The core's `transaction()` runs on Node only, so People declares `platforms: ["node"]` and `deploy cloudflare` refuses it. The kit's build still makes a Worker, whose entry answers 501 with the reason. |
| Ri starts People on demand | Works differently | People runs on its own as a service; Ri connects to it. |

## Tests

Every old test file is ported and passes through the kit's adapter, except the packaged-view test:

| Old test | Now |
| --- | --- |
| briefing-text, capture, extraction, followups, identity, imports, merge, personal, pipelines, preview, profiles, review-leaks, scopes, sync | Pass. Each call goes through People's kit action as the kit runs it: your browser, a connection with its recorded choice (made with the kit's `createTestConnection`), or the job. Hub calls go to a fake hub that answers with Ri's tool names, `account` argument, choose-account answer and errors as the kit's client reports them. A missing item and `unsupported` go through the kit's own client, as today's Ri or one from before dynamismlabs/ri#7 answers them. |
| performance | Split in two, so that machine load can't stop a change or an install. `pnpm test` (`test/performance.test.ts`) runs every call the latency budget covers at release volume and checks the query plans. No call may read a whole large table: a scan without an index, an automatic index, or a whole-index walk that doesn't stop at a LIMIT. And how each call reads the large tables, index by index, must match a committed snapshot. Two tests show each check notices a dropped index, and deleting `persons_name` or the participant indexes from People's migrations fails the gate. `pnpm test:perf` (`test/performance.perf.ts`) times the same calls against p95 under 300 ms. It prints the load average and reports "not measured" above one per core. The old record-open plan check matched table names, so it missed aliased scans (`SCAN ip`). The new one reads the aliases. |
| contract | Rewritten for the kit: every action converted, examples still parse, audiences, MCP tools are exactly the agent actions plus the views, `open_people`, `search_mentions` and the core's Settings tools (view-only), every tool has an output schema, job and connectors in the contract, and every read handler is synchronous, so each runs as one transaction. The prompts are the skills in `legacy/skills`, and the copy rules cover the instructions and every prompt's title and description. |
| release | Passes. Two restores use a database copy, and one uses the kit's portable backup, search included (an expected failure until kit `ff47742`). |
| view.packaged (Ri packaging, AppEngine, screenshots at widths and dark mode) | Removed with Ri's app engine. Replaced by `test/people.browser.spec.ts` (`pnpm test:host`), which drives the whole view in the kit's strict MCP Apps test host, and `test/kit.test.ts` for the view tools and resource. Width and dark-mode screenshots aren't automated any more (the test host is light only). |
| New: kit | The job finding accounts (several by name, one by address), duplicate wake-ups, a hub that's down or revoked, MCP with tokens and per-connection sources, the cards, the view's empty network policy, view-only tools acting as the owner only for a connection with every source, the @ menu and record reads by connection, `open_people` at a path, a deleted import leaving connections' choices, the kit's own fixture source for Ri's services, the server instructions, and the prompts: their arguments, a person found only among the connection's sources, a read-only connection refused, and nothing changed. |
| New: fixtures | People's whole sync on the kit's fixture source, as `APP_CONNECTORS=fixtures` serves it (`test/fixtures.test.ts`): finding the account, both backfill pages, history with a newsletter left out from its headers alone, Calendar's full scan and then two sync tokens, and three runs with nothing duplicated. A second test answers in code to expire Gmail's history (404) and a sync token (410) once each: the mail rescans, the calendar restarts, and nothing is duplicated. With bulk labels no longer skipped, the first test fails. |
| New: transactions | A thrown error rolls back the whole of a mail page's ingestion, a merge, an undo and deleting what an account brought in. Each test makes one late statement fail with a temporary trigger that fires only once the step's earlier writes are in, then finds People's tables exactly as before, and the same step succeeding after. A failed merge or undo saves no write receipt. All four fail if the partial writes are committed before the error is thrown. |
| New: people.browser.spec (strict test host) | Settings inside the host (from the header and from Sources, removing a connection, asking before removing the view's own, Back, a host link, and a limited connection sent to the browser). Opening at a person, Open in browser, Ask Ri as a draft, a host link moving the app, archiving and importing a file from the view, export through the host, filters and a bulk selection in the context, a card opening the app at one person, a host without drafts, links or files, and a connection limited to one collection. The view reached nothing on the network. One export click is dispatched to the button, since the test host doesn't deliver real clicks to the bottom band of a full-screen frame (K12). |

## Gaps in the kit

- **K3. The capability shapes are too thin for People.** `MailMessage` has no list or reply headers; `CalendarEvent` has no attendees, organizer, recurrence or time zones; neither has an incremental cursor. So People passes Ri's tools through by name. Adding headers and attendees to the capability shapes would let People use them. The fixture half is closed (below).
- **K12. The kit's test host misses clicks at the bottom of a full-screen frame.** In `browser-host.ts` with Chrome, a real mouse click about 80 px from the bottom of a sandboxed frame made full screen doesn't reach the frame at all (no pointer events inside it), while clicks above it do. People's test dispatches its one click there. Worth checking whether real Chromium hosts (Ri's desktop app) behave the same.
- **The test host isn't in the core package.** `packages/core/test/browser-host.ts` and the OAuth helper are copied into `test/host/`; shipping them (or a `testHost()` export) would keep apps' host tests in step with the kit's.

Closed by kit `main` `73c5266` (core 0.2.2, dynamismlabs/mcp-app-builder#22 to #24) and `e44b499` (#26), each shown by a People test:
- **K3, the fixture half. The fixture source answered a pass-through tool with one result whatever the arguments,** so People's sync couldn't run under `APP_CONNECTORS=fixtures`. A tool's fixture now has `cases` matched by its arguments, or an `answer` in code, and a call with no answer fails and names its arguments. `fixtures/connectors.json` answers each Gmail message by id, each history page by start position, each backfill page by token and each Calendar sync token, and `test/fixtures.test.ts` runs the job on it. The fixtures give every tool explicitly: the kit's `mail` section serves `gmail__search_messages` with its own matcher, which doesn't read People's `(in:sent OR …) after:` query.
- **K10. No MCP prompts.** `definePrompt` (#23) lets an app offer prompts with text arguments. People's three skills are prompts (`src/people/prompts.ts`), and its `instructions` (#22) say what no single tool's description does. On `73c5266` the build refused every prompt with arguments, because it loads the app with its own copy of zod and checked the arguments with `instanceof` (K23). `e44b499` checks zod's type name instead, so People's prompts build as written.

Closed by kit `main` `ff47742` (core 0.2.2, dynamismlabs/mcp-app-builder#10), each shown by a People test:
- **K2. The portable backup couldn't restore FTS5.** A snapshot now leaves out the index's internal tables and writes its rows back with their rowids. People's `release` test restores from the kit's backup and searches (it was an expected failure until this core, and it made the upgrade stop at `checks_failed` by passing).
- **K4. No structured account choice.** Ri's `choose_account` answer reaches People as `SetupRequired` with `code` and `accounts`, so People no longer reads names from the message (`test/kit.test.ts`, several accounts by name). The kit's `accounts()` (Ri's `ri__list_accounts`, merged in dynamismlabs/ri#4) isn't used yet: People keys an account by its address, and moving to Ri's stable ids needs a data migration (R1).
- **K9. Connection choices kept deleted sources.** The core drops them when a connection is used or listed, and saves the pruned choice. People's own filter on connections is gone, and a deleted import leaving two connections' choices is tested over MCP. People still filters the saved choice it reads to recheck queued work, which the kit only prunes on the connection's next use.

Closed by kit `main` `df533b0` (core 0.2.2, dynamismlabs/mcp-app-builder#11 and #12) with dynamismlabs/ri#7:
- **K5. Pass-through errors lost their code.** The kit keeps Ri's `code`, and `ConnectorError.httpStatus` carries the provider's status. People reads `not_found` and `unsupported` by code. Only Calendar's 410 restarts a window. The message is read only for a hub from before ri#7 (`provider_error`, "provider error 404 for …"). `test/sync.test.ts` runs history expiry and Calendar's 410 and 404 against both hubs, and `test/extraction.test.ts` gets Ri's `unsupported` in its own words, which don't say "unsupported". Each test fails with its branch of the change removed. Before this, Ri's `unsupported` from its model service reached People as a failure, not as extraction being unavailable.

Resolved by kit `main` `7b1ba65` (dynamismlabs/mcp-app-builder#18), measured:
- **K14. Each of the core's transactions cost about 100 times a cached statement.** Through `023f92f`, `transaction()` built a new handle, with its own Drizzle instance, for every transaction, and statements weren't kept between transactions: about 14 µs for one statement in its own transaction, against 0.14 µs for a cached statement on People's old connection. Now the Drizzle instance, the statements and BEGIN, COMMIT and ROLLBACK are made once per connection, and a statement in its own transaction costs about 2.6 µs. With each statement its own transaction, `list_people`'s first page is 3.3–3.5 ms at p95 instead of 16 ms.
  - **People keeps running each synchronous read action as one transaction (`invoke` in `src/people/kit.ts`),** because it still clearly helps where a call runs many statements. In two alternating `pnpm test:perf` runs each way, p95 without it against with it:
    - paging 100 per page: 6.9 and 6.5 ms against 3.9 and 4.2 (v0.1.1: 4.2)
    - the chat's search: 6.8 and 6.5 ms against 3.2 and 2.6 (v0.1.1: 2.5)
    - the first page by name: 3.5 and 3.3 ms against 2.4 and 2.0 (v0.1.1: 2.3)
    - the next meeting filter: 4.9 and 4.9 ms against 3.8 and 3.3 (v0.1.1: 3.7)
  - The differences between rounds of the same setup were at most 0.7 ms on these calls. With the wrapper, every call is within noise of v0.1.1. Each read also sees one state of the records. Everything stays far under the 300 ms budget either way.

Closed by kit `main` `023f92f` (dynamismlabs/mcp-app-builder#15), shown by People's tests:
- **K1. No synchronous transactions.** People opened its own better-sqlite3 connection to the kit's `data.sqlite` (found with `PRAGMA database_list`) and ran its transactions there with its own `BEGIN IMMEDIATE` wrappers. The core's `transaction(ctx, work)` now runs them on the installation's own connection with the same rules: rollback when the work throws, synchronous work only, and a nested call joins without a savepoint. People's `Db` runs every statement through it, and its stores in `src/lib` take the transaction from `Db`. The private connection, its pragmas (`busy_timeout`, `synchronous = NORMAL`) and its closing are gone. `test/transactions.test.ts` shows a thrown error rolling back ingestion, merge, undo and source deletion. Workers still can't run it, the kit's step 2.

Closed by kit `main` `a8e9b5d` (dynamismlabs/mcp-app-builder#12 and #13), shown by a run:
- **K13. `change` and `upgrade` didn't refresh the service definition.** Since #12 the switch rewrites the launchd plist when it differs from what `serve --install` would write, and #13 stops launchd throttling the service. The `upgrade` that switched `local.people` to `887754c` rewrote it. `plutil -p ~/Library/LaunchAgents/local.people.plist` afterwards shows `"NODE_ENV" => "production"` beside `APP_DATA_DIR` and `APP_LOG_TIMESTAMPS`, `"ProcessType" => "Interactive"`, and the Node at `~/.nvm/versions/node/v24.2.0/bin/node`. Before it, the plist had only the two variables.

Closed by core 0.2.2 (kit `main` `1713f6a`):
- **K6. App-only tools:** `visibility: ["app"]`, enforced by Ri.
- **K7. Host calls in the view client:** drafts, links, files, Open in browser.
- **K8. The selection was one record:** now section, path, filters and up to 50 records.
- **Record links:** `open_<app>` at a path, host deep links and the @ menu.
- **K11. Upgrades:** `upgrade --core` moved People from 0.2.0 to 0.2.2, with refresh-token rotation.

## Gaps in Ri

- **R1. Account identity across Gmail and Calendar.** With one account lent, Ri's tools have no account name, so People uses the Gmail address and the primary calendar's id. With several, People uses Ri's allowed names (an address or a label). If Ri names a connection by label, one Google account's mail and calendar can end up as two sources in People. Ri now lists lent accounts with a stable `acc_` id each (`ri__list_accounts`, dynamismlabs/ri#4), which the kit returns from `accounts()`. People hasn't moved to those ids yet: its sources are keyed by address, so it needs a data migration that maps each saved account to Ri's id.
- **R2. `ri__ai_text` needs the Claude harness.** Otherwise extraction, briefings and profiles show as unavailable, as they did in Ri.
- **R3. Ri doesn't run apps any more.** People must be installed as a service (`serve --install`) before Ri can connect it.
- **R4. Checked against a disposable Ri, not one in everyday use.** OAuth from Ri's client and Ri's view host ran in a disposable Ri at f55cdf96 ([Real hosts](#real-hosts)). Ri's hub consent with People's tools and a real Gmail account were not run.
- **R5. Downloads in Ri.** Fixed by dynamismlabs/ri#2: export inside Ri saves through Ri's card.
- **R6. Visibility must stay enforced.** People's owner work inside a host relies on Ri keeping view-only tools from its model and refusing the model's calls to them.

- **R7. Ri refuses a server whose tool takes an input named `account`.** Ri's engine reserves `account` and refused People's whole server ("action \"app_people.configure_source\" input declares a reserved field \"account\""), so Ri couldn't add People at all. People's tools now take `sourceAccount` (commit 5ff66bd, with a contract test). Ri should skip or rename that one tool rather than refuse the server.
- **R8. Ri can't open a screen of an app added with Add app.** Ri publishes its tools as `app_people.<tool>` but Open app, the view's calls, the @ search and settings build `mcp.<slug>.<tool>` ("unknown action \"mcp.people_at_ri.open_people\""). Adding People with Add MCP server works around it.
- **R9. A full-screen app's selection never reaches a message in Ri.** Ri drops a view's context when the view closes, and a full-page screen has no chat beside it.
- **R10. Ri has only a dark theme,** so People's light theme inside Ri can't be seen.

## Real hosts

Checked on November 16, 2026. "Ri" is a **disposable Ri at f55cdf96** (Ri's current `main`) on this Mac, with dummy records, not a Ri Home in everyday use. People ran as the installed service at `http://127.0.0.1:4311` (release 5ff66bd). Ri connected it through People's consent screen ("Connect Ri to People?", all sources, changes allowed). Full-screen checks used **Add MCP server**, because Ri's Add app path can't open screens yet (R8). Screenshots: `docs/parity/ri-*.png`.

| Check | Ri on the web | Ri's desktop app | ChatGPT | Claude |
| --- | --- | --- | --- | --- |
| Connect, `open_people` and the tools listed | Works: consent, token, 69 tools including `open_people` and `search_mentions` | Same connection | Pending | Pending (desktop set up, waits on a restart) |
| Every screen (Today, People, a person, Follow-ups, Sources) | Works | Works (person, Sources) | Pending | Pending |
| Person-only actions from the view (archive, export, import) | Work | Work (export, import) | Pending | Pending |
| The model can't call them | Refused: `delete_record`, `merge_people`, `export_records` | Same Ri server | Pending | Pending |
| Links out and Open in browser | Open in browser opens `/people/<id>` in a new tab | Opens in the system browser | Pending | Pending |
| Saving files | Ri's card, then saved (`people-people.csv`) | Same, saved through Electron's download | Pending | Pending |
| Picking files | Chooser opens in the frame, dummy CSV imported | Chooser opens | Pending | Pending |
| Ask drafts | In the main chat's draft, unsent | Same | Pending | Pending |
| Opening at a record | `?open=open_people&path=/people/<id>` opens the person | Same | Pending | Pending |
| The @ menu | Finds the dummy person | Not checked | Pending | Pending |
| Selection reaching the next message | Doesn't (R9) | Doesn't (R9) | Pending | Pending |
| Light and dark | Dark only in Ri (R10). People follows it; Open in browser is low contrast | Same | Pending | Pending |
| Phone and desktop widths | 390 px fits, no sideways scroll; 1396 px | Window is at least 800 px wide, 390 px emulated | Pending | Pending |
| View size and load time | View 1,159,739 bytes. Warm reload 0.6 s, open by link 4.8 s (Ri's dev server) | Warm reload 2.1 s under heavy load | Pending | Pending |

Load times are from Ri's development server on a heavily loaded Mac (load average 150 to 250), so they're upper bounds. Ri on the web needed no model; the disposable Ri had no model harness, so anything that needs the model to act (cards from `show_*`, reading an @ item at send) wasn't checked.

Small things seen, not fixed: Open in browser at the top right is hard to read in a dark host (dark green on near black), and an imported file's label uses the UTC date ("people-dummy.csv, November 17, 2026" for an import on the evening of November 16 in Denver, while the Imported column says Nov 16).

## Kit version

Core 0.2.2 from kit `main` `e44b499` (dynamismlabs/mcp-app-builder#20 to #26), vendored in `vendor/`. Two upgrades, both with the kit's own CLI on the installed `local.people` and the service's Node 24.2.0:
- To `73c5266` (#20 to #25), run by the kit's session: it switched to its own commit `1e55833` and merged it into `main`. People's fixtures (`e9c73d4`) and instructions (`fcd6b21`) then switched with `change`, to release `fcd6b216b04e`. The prompts waited on a branch, because that core's build refused prompts with arguments (K10).
- To `e44b499` (#26), `upgrade --core <packed tarball> --health-timeout 300 --json` passed every step, switched to its own commit `9329c79` (was `fcd6b21`), merged it into `main` and installed the new core in the app folder. With the prompts merged (`86a46bd`), `change --json --health-timeout 300` passed every step, its tests included, and switched `local.people` to `86a46bd54228` (was `9329c794d290`). `/api/health` answers with that release, and `/mcp` without a token answers 401. The plist kept its definition-version comment, `NODE_ENV=production`, `ProcessType` Interactive and Node 24.2.0.

On kit `7b1ba65` (#18 and #19), the upgrade ran with the kit's own new CLI (`node ~/dynamism/app-builder/packages/core/bin/app-builder.mjs upgrade --core <packed tarball> --health-timeout 300 --json`) on the installed `local.people`, with the service's Node:
- It passed every step and switched to `c75273f` (was `fe9f392`), the upgrade's own commit.
- It rewrote the service definition, which was out of date. The plist now starts with `<!-- app-builder service definition 1 -->` and still has `NODE_ENV=production`, `ProcessType` Interactive and Node 24.2.0.
- It merged into `main` and installed the new core in the app folder (#18). So `node_modules` had the new `transaction()` without a separate install.
- After People's two commits (the dependency drop and K14), `change --json --health-timeout 300` passed every step with 138 tests and switched `local.people` to `e47fff6` (was `c75273f`). `/api/health` answers with release `e47fff6d522a`, and `/mcp` without a token answers 401. The plist kept its definition-version comment, `NODE_ENV=production`, `ProcessType` Interactive and Node 24.2.0.

On kit `023f92f` (#14 to #17), `pnpm exec app-builder upgrade --core <packed tarball> --health-timeout 300 --json` on the installed `local.people` built with the service's own Node (#14) and stopped at `checks_failed`. The contract test lists the exact tool set, and the core had added `read_settings` and `change_settings`. The upgrade's commit (`62b0a31`) fast-forwarded `main`. After the Settings, transaction and test commits, `change --json --health-timeout 300` passed resolve, copy, install, typecheck, test (138 passed), build, rehearse, stop, snapshot and switch: `local.people` runs release `fe9f3923c344` at `http://127.0.0.1:4311`, `/api/health` answers with it, and `/mcp` without a token answers 401. The plist still has `NODE_ENV=production`, `ProcessType` Interactive and Node 24.2.0.

On kit `a8e9b5d` (#13: no launchd throttling, a measured health wait, never restoring twice), the kit session's `upgrade` switched `local.people` cleanly to `887754c`, carrying People's `v0.1.1` work through `b7ea18f`. People `v0.1.0` (`17ac728`) was on kit `bbbb340`.

On kit `df533b0`: `pnpm exec app-builder upgrade --core <packed tarball> --json`, run on the installed `local.people`, stopped at `checks_failed`. All three failures were timing:
- The two latency tests missed 300 ms at p95 (432 and 1952 ms), with the Mac's load average about 200.
- The duplicate wake-up test crossed into the next five-minute slot, because it started from the clock. It's fixed in `eadb10f`.

The upgrade's commit (`11d713b`: the new tarball, the lockfile and the build skill) was merged by hand. `change --json` then stopped at `checks_failed` on the two latency tests alone (1010 and 998 ms), with the load average 290–510. Every other test passed in the copy, and the service stayed on `17ac728` until the switch above. The latency budget has since moved to `pnpm test:perf`, out of the gate ([Tests](#tests)).

On kit `ff47742`: `upgrade --core ~/dynamism/app-builder` stopped at `checks_failed` because the expected-failure backup test passed (K2). Its commit (`9256926`) was merged by hand, the test made a normal one, and `change --json` switched the service. Nothing was reinstalled.

Earlier: the kit's `upgrade --core` moved People from 0.2.0 to core 0.2.2 at kit `1713f6a` (run from the kit checkout's CLI, since 0.2.0 predates `upgrade`), before People was installed.

The service definition: through `ff47742` only `serve --install` wrote the launchd plist, so `local.people`, installed with an earlier core, ran without `NODE_ENV=production` until the `887754c` switch rewrote it (K13). Callers never see stacks either way, which the core enforces.

## Evidence

November 18, kit `e44b499` (People `v0.1.4`):
- `pnpm typecheck` and `pnpm build` pass. The build writes 71 MCP tools (27 view-only) and 3 prompts to `dist/contract.json`. On `73c5266` the build stopped at "The prompt prepare-for-a-meeting's argument person must be text": it loads the app with its own zod, and People's `z.string()` wasn't an `instanceof` the core's `ZodString`, though its type name was `ZodString`.
- `pnpm test` passes 20 files and 143 tests, at a load average of about 3 on 16 cores. `pnpm test:host` passes 4.
- With `relevant()`'s bulk-label check removed, `test/fixtures.test.ts` fails: the newsletter's body is read, and with no answer for it in the fixtures, it's recorded as gone. With the prompt's search run without its connection, the prompt test fails: it finds the person the connection can't see.
- The two switches are in [Kit version](#kit-version).
- Not run: Ri, ChatGPT or Claude offering the prompts, and a real Gmail or Calendar account.

November 17, kit `7b1ba65` (People `v0.1.3`):
- `pnpm typecheck` passes after dropping People's direct `better-sqlite3` and `@types/better-sqlite3`, which only the core uses now: its server bundle imports the core, which brings its own, and `onlyBuiltDependencies` still builds it. `pnpm test` passes 19 files and 138 tests, and `pnpm test:host` passes 4.
- A statement in its own core transaction costs about 2.6 µs (20,000 runs, twice), down from 14.1 µs on `023f92f`. A cached statement on its own is 0.14 µs.
- `pnpm test:perf` with and without the per-read transaction, alternating, two runs each, at load averages of 7.8 to 10.4 on 16 cores. All four were measured and passed. The calls that differ are in K14. With it, the person's calls at p95 were:
  - the first page by name 2.4 and 2.0 ms, each sort 7.5 and 7.8 ms, paging 3.9 and 4.2 ms
  - filtered by company, list and last exchange 29.3 and 27.7 ms, next meeting 3.8 and 3.3 ms, follow-up 4.9 and 3.6 ms
  - search 9.5 and 8.3 ms, `get_person` 0.6 and 0.3 ms, the timeline 1.5 and 1.4 ms
  - `list_organizations` 2.1 and 1.4 ms, `get_organization` 0.7 and 0.6 ms, `get_today` 6.5 and 5.0 ms
- The narrower chat's, p95 with it: by name 22.7 and 20.1 ms, by last exchange 27.6 and 25.2 ms, search 3.2 and 2.6 ms, `get_person` 2.9 and 2.2 ms.

November 17, kit `023f92f` (People `v0.1.2`, release `fe9f392`):
- `pnpm typecheck` passes. `pnpm test` passes 19 files and 138 tests, and so did the gate in `change`.
- `pnpm test:host` passes 4 tests in the strict test host. With the view's navigate put back to People's own, the new Settings test failed at Back to People: the view stayed on Settings.
- `test/transactions.test.ts`: with `Db.tx` changed to commit the work's partial writes and then throw, all four tests failed.
- `pnpm test:perf` at a load average of about 5 on 16 cores, both groups measured and passed.
  - With each statement its own transaction, the person's calls at p95 were: the first page by name 16 ms, each sort 18.8 ms, paging 27.9 ms, filtered 30.4 ms, `list_organizations` 11.8 ms. The narrower chat's were 34.8 ms by name and 40.1 ms by last exchange (K14).
  - With each synchronous read as one transaction, the person's calls at p95 were: the first page by name 2.2 ms, each sort 8.5 ms, paging 4.4 ms, filtered by company, list and last exchange 28.5 ms, next meeting 3.7 ms, follow-up 4.1 ms, search 9.5 ms, `get_person` 0.7 ms, the timeline 1.7 ms, `list_organizations` 2.2 ms, `get_organization` 0.9 ms, `get_today` 6.3 ms.
  - The narrower chat's, p95: by name 23.2 ms, by last exchange 26.4 ms, search 5.4 ms, `get_person` 2.9 ms.
- A statement in the core's `transaction()` costs about 14 µs, against 0.14 µs for a cached statement and 4 µs for a bare `BEGIN IMMEDIATE` and `COMMIT` around it (20,000 runs each, on the core's Node platform).
- Not run: Ri, ChatGPT or Claude with the new Settings view, and a real Gmail or Calendar account.

November 17, before tagging `v0.1.1` (release `887754c`, kit `a8e9b5d`):
- `pnpm test:perf` at the default limit, at a load average of 11.1–11.6 on 16 cores, on the installed core: both groups were measured and passed.
  - The person's calls, p95: the first page by name 2.3 ms, each sort 7.5 ms, paging 4.2 ms, filtered by company, list and last exchange 27.4 ms, next meeting 3.7 ms, follow-up 4.2 ms, search 8.4 ms, `get_person` 0.3 ms, the timeline 1.8 ms, `list_organizations` 1.7 ms, `get_organization` 0.6 ms, `get_today` 5.1 ms.
  - The narrower chat's, p95: by name 19.5 ms, by last exchange 24.5 ms, search 2.5 ms, `get_person` 1.6 ms.
- The plist after the switch, quoted in K13.

November 17, the latency budget out of the gate:
- `pnpm test:perf` at a load average of 18–20 on 16 cores, with `PERF_MAX_LOAD=2`: every timed call's p95 was at most 30.4 ms (the filtered owner list), and the narrower chat's slowest was 29.5 ms. At the default limit the same machine reported "not measured" at 16.7. The 432–1952 ms failures in the gate were the machine, at load averages of 200–510.
- `test/performance.test.ts` passed three runs in a row with the same plan snapshot. With `persons_name` replaced in People's migrations, the snapshot test and its self-check failed. With both participant indexes replaced, the full-scan check, the snapshot and the record-open check failed (`SCAN interaction_participants`).

November 17, kit `df533b0`:
- `pnpm typecheck` passes. `pnpm test` passes 129 of 131 tests in 18 files. The two failures are the latency tests (587 and 1126 ms at p95), with the load average 170–290.
- Each part of the K5 change was removed in turn and its tests rerun: reading `not_found` by code, reading `unsupported` by code, the `provider_error` fallback, and Calendar keeping its token on a 404. Each removal failed exactly the tests for that part, and the unchanged code passed them.
- Not run: Ri itself, a real Gmail or Calendar account, and `pnpm test:host` (no view code changed).

November 17, kit `ff47742`:
- `pnpm typecheck` passes, and `pnpm test` passes 18 files and 128 tests, with no expected failures left.
- The upgrade's own check failed only on the pinned backup test passing. After the merge, `change --json` passed resolve, copy, install, typecheck, test (128 passed), build, rehearse, stop, snapshot and switch: `local.people` runs release `3e3ba43` on core 0.2.2 at `http://127.0.0.1:4311`, `/api/health` answers with it, and `/mcp` without a token answers 401.
- Removing People's own deleted-source filter was checked against the tests: with the kit's sign-in skipped in the test helper, the replay test after a deleted import fails, and with it, it passes.
- `pnpm test:host` wasn't rerun: no view code changed.

November 16, installed and checked in Ri:
- Installed as this Mac's service: `PORT=4311 APP_HOST=127.0.0.1 APP_URL=http://127.0.0.1:4311 pnpm exec app-builder serve --install HEAD --json` passed every step (launchd, `local.people`, data in `~/.local/share/people`). Then `change HEAD --json` switched it to 5ff66bd, the `sourceAccount` fix. `status --json` reports it running on core 0.2.2.
- `pnpm typecheck` and `pnpm test` pass after the fix: 18 files, 126 tests, and 1 expected failure. The new contract test fails on the old code.
- The Ri checks in [Real hosts](#real-hosts), driven with Playwright in Ri's web app and its source Electron app. The dummy records were removed afterwards, and the disposable Ri's two connections were disconnected in People's Settings.

November 16, core 0.2.2:
- `pnpm typecheck`, `pnpm build` and `pnpm test` pass: 18 files, 125 tests, and 1 expected failure (the kit backup gap, K2). The build writes 69 MCP tools to `dist/contract.json`, 25 of them view-only.
- `pnpm test:host`: 3 tests pass in the kit's strict MCP Apps test host, with Chrome, one worker and a disposable preview server that Playwright stops.

November 12, core 0.2.0:
- `pnpm typecheck`, `pnpm build` and `pnpm test` passed: 18 files, 122 tests, and 1 expected failure. The build wrote 46 MCP tools.
- `pnpm exec app-builder serve --install --service process` with a disposable `APP_DATA_DIR` ran resolve, copy, install, typecheck, test, build, rehearse, stop, snapshot and switch, and `/api/health` answered with the new release. (Its first try refused to switch because a test that depended on two records saved in the same millisecond failed in the copy; fixed.) Then `change --json` switched the running app to a later commit with its records kept. No launchd service was installed.
- `scripts/oauth-check.mjs`, a standard MCP client (`@modelcontextprotocol/sdk` 1.32.2), against that running app: 401 with `resource_metadata`, dynamic registration, PKCE S256, People's consent screen in a browser with no sign-in (chose only the "Work" collection and read-only), token with a refresh token, 46 tools; `list_people` returned only the Work person, `show_today` drew its card, and `capture_about_person` was refused: "Ri · Work can read but not make changes."
- A browser check of `pnpm preview`'s fictional world: Today, the directory and a person's page render on the kit's client.
- Hub features are tested two ways: against a fake hub with Ri's tool names and shapes (`test/helpers.ts`), and against the kit's own fixture source (`test/kit.test.ts`), which drives Ri's task services and shows where it can't drive People's sync (K3).
- Not run: Ri itself (its client, its hub's consent, its view host), Claude or ChatGPT, and a real Gmail or Calendar account.
