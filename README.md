# People

Your relationships, conversations and follow-ups in one place.

People is a lightweight personal and professional relationship app. It works with twenty important contacts or thousands of professional ones, with one set of records and no setup decisions. It starts with people, conversations and meetings. Companies, saved views, lists and small opportunity pipelines grow the same experience when they help.

It runs on your Mac as its own app with its own data, and any assistant can use it over MCP: Ri, Claude, ChatGPT. Ri can lend it your Gmail, Calendar, tasks and model. It used to be built into Ri; `docs/parity.md` says what changed.

## What it does

- **Today** shows upcoming meetings, chosen follow-ups, what you are waiting on, keep-in-touch reminders, upcoming birthdays and a short sourced review queue. When nothing needs attention it says so.
- **People** is a fast directory with saved views, filters, sortable columns, lists and selection of up to 50 records for pin, list and archive changes.
- **A person** has a header with sourced role and company, a fields column and sections: Overview (My read, the living profile, the briefing and commitments), Timeline, Notes and Details with corrections.
- **The personal side** is written by you: a birthday, where someone lives, how you met, and **My read**, your own take that AI never writes. **Relationships** link two people or a person and a name.
- **The living profile** is a short cited summary rewritten from the previous one plus whatever arrived since. It needs Extract relationship context, never reads My read and never guesses private traits.
- **Capture from chat**: tell an assistant "met Sarah at dinner, she is raising a seed round" and it lands on Sarah as a note in your words.
- **Companies**, **Follow-ups** (I owe, Waiting on, Suggestions, one Ri task per follow-up) and optional **Pipelines**.
- **Sources** keeps account updates, history range, coverage, imports, the Extract switch, identity review, excluded senders, collections and export together.

## In an assistant

Add `http://127.0.0.1:<port>/mcp` as an MCP server. Each assistant connection (each Ri place, Claude, ChatGPT) gets People's consent screen and chooses which accounts, collections and imports it may see, and whether it may also make changes. People filters everything it returns by that choice.

- Data tools: People's actions, such as `search_people`, `get_person`, `get_relationship_context`, `capture_about_person`, `list_commitments` and `create_follow_up`.
- Cards: `show_people`, `show_person`, `show_follow_ups` and `show_today`.
- `open_people` opens the whole app, at a path when given.

The whole app works inside a host that supports MCP Apps: `open_people` can open at a person (`/people/<id>`), people and companies are in the host's @ menu, and **Open in browser** is always in the header. Sources, imports, export, merges and deleting records are view-only there: the host keeps them from the model, and only a connection given every source may use them.

## Your accounts

In People's Settings, under "Your accounts through Ri", connect Ri once and choose in Ri which accounts and tools People may use. People's job ("Update from your accounts", every five minutes) reads them on its own: Gmail and Calendar, read only, through Ri. Nothing is sent or changed. Relationship extraction, briefings and profiles use Ri's model only when you turn Extract on.

## Run it

```sh
pnpm install --frozen-lockfile
pnpm preview
```

`pnpm preview` opens a fictional preview with invented people in a disposable data directory. Nothing reads an account.

To run it for real, commit and run `pnpm exec app-builder serve --install`. It checks the commit in a separate copy, then runs it as your service with data in `~/.local/share/people`. Change it later with `pnpm exec app-builder change`.

## Limits

- Lists return 50 rows by default and at most 100. Selection and bulk changes cover at most 50 records.
- Imported files up to 512 KiB and 5,000 rows.
- Context for chat is at most 20 facts or commitments and 20 interaction references, within 16 KiB.
- AI prompts are at most 16,000 characters, mark source text as untrusted, and results are checked against a strict format with exact passages.
- List, search and detail stay under 300 ms at p95 on 10,000 people, 1,000 companies and 100,000 interactions. `pnpm test:perf` measures that on a quiet machine. `pnpm test` checks that these calls read the large tables through indexes, which doesn't depend on the machine.

## Development

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:perf   # the latency budget, on a quiet machine before a release
```

All tests use fictional people and a fake hub. Nothing here is evidence of live Gmail, Calendar, Ri or AI behavior. See AGENTS.md for the layout and rules.
