# Lockout Drill

**If your phone disappeared today, which accounts could you still get back into?**

Lockout Drill is a single-page, offline prototype. You describe each account only by *method type* (authenticator app on phone, SMS code, passkey, backup codes and where they are stored, recovery email, memorized passphrase). Press **Lose my phone** to see how many accounts you would be locked out of, the dependency chain behind each one (for example `Bank ← SMS ← Phone`), and which fixes rescue the most accounts.

- No secrets: it never asks for passwords, IDs, phone numbers, email addresses, or recovery codes.
- Nothing leaves your device. No sign-up. No cost. Works offline.
- Unknown stays **Unknown** — it is never shown as safe.

> Status: prototype built for SafeSpace Hacks (build window October 17 – November 22, 2026). It is a model of your setup, not proof that recovery will work. Some services offer other recovery paths.

## Try it
Open `index.html` in a browser and press **Try the sample student** (a fictional student with 9 accounts).

## Tests
Requires Node.js 22 or later. No install step or third-party dependencies.

```sh
npm test
npm run build
```

`core.mjs` is the sole source for the pure calculation, public input validation,
tool contracts and fictional sample. It has no DOM, I/O, clock or randomness.
`scripts/build.mjs` embeds it between `<!-- core:start -->` and
`<!-- core:end -->` in `index.html`, removing only the module export. The build
also generates `schema/inventory.schema.json` and `examples/mika.json`. Commit
these generated files after changing the core; do not edit them directly.
The generated HTML still opens as one standalone offline file, including via
`file://`, without loading any modules or other files.

On **2026-11-17**, all **54 tests passed, with 0 failures**, both before and after
the README changes, on Node **v26.13.0**. The test files are unchanged. Full logs
and commands are in `RESULTS_BEFORE.txt` and `RESULTS_AFTER.txt`. The tests cover
CLI input and errors, MCP lifecycle and tools, Unknown, conditional ranking,
input bounds, shared-core parity and reproducible artifacts. UI tests use an
in-memory DOM double, which does not verify rendering, native dialogs or
assistive technology. The automated suite exercises the MCP server directly;
integration with an external MCP application has not been tested. The November
17 checks used Node.js only; the earlier browser review is described below.

## Inventory format

See [`schema/inventory.schema.json`](schema/inventory.schema.json) (JSON Schema
2020-12) and [`examples/mika.json`](examples/mika.json), the fictional student
Mika's nine accounts. The root is an array of accounts:

```json
[
  {"id":"mail","name":"Main email","methods":[{"kind":"authenticator"}]},
  {"id":"portal","name":"School portal","methods":[
    {"kind":"email","dependency":"mail","secondFactor":"none"}
  ]}
]
```

Each account requires a unique local `id`, a fictional `name` and a `methods`
array. `unverified: true` records an unresolved alternate route. There are no
password, token, recovery-code, phone-number, email-address or secret-value
fields. Additional fields are rejected at every object boundary. Use nicknames
and local IDs only; text validation cannot detect every secret someone might
put in a nickname. Inputs and errors are never logged to disk by the interfaces.

| Method `kind` | Optional metadata |
| --- | --- |
| `authenticator`, `sms`, `phone_passkey`, `passphrase`, `unknown` | No method-specific fields |
| `backup` | `store`: `phone`, `printed`, `device`, `unknown`; `independent` |
| `email` | `dependency`: local account ID; `secondFactor`: `phone`, `none`, `unknown` |
| `device_passkey` | `exists`, `independent` |
| `manager` | `store`: `phone`, `device`, `unknown`; `independent`; `unlock`: `memorized`, `phone`, `account`, `unknown`; `dependency` |
| `other` | `supported`, `independent` |

`exists`, `independent` and `supported` accept `true`, `false` or `"unknown"`.
All methods also accept boolean `confirmed`; `false` makes that route Unknown.
Omitted facts, empty methods, missing dependency targets and unresolved cycles
remain Unknown unless another complete modeled route succeeds. Invalid types,
unsupported fields and enum values are errors rather than silently discarded.
Limits: 200 accounts, 16 methods per account, IDs of 1–48 ASCII letters/digits/
underscores/hyphens, nicknames of 1–64 characters, 1 MiB of CLI input or per MCP
message. Duplicate IDs are checked by the core in addition to the schema.

## CLI

```sh
node cli.mjs analyze examples/mika.json --lose phone --json
node cli.mjs fixes examples/mika.json --json
cat examples/mika.json | node cli.mjs analyze - --lose phone --json
cat examples/mika.json | node cli.mjs fixes --json
node cli.mjs --help
```

Omitting the filename, or using `-`, reads standard input. `analyze` defaults to
`--lose phone`; phone loss is the only supported scenario. Omit `--json` for
readable text. All calculations call `core.mjs`; neither interface makes network
requests, persists inventory or changes real accounts.

With `--json`, stdout contains one JSON object. Success exits **0**; input,
validation and usage errors exit **2** and always return JSON, even without
`--json`:

```json
{"ok":false,"error":{"code":"INVALID_JSON","message":"Input must be valid JSON."}}
```

Error codes are `USAGE`, `INPUT_ERROR`, `INPUT_TOO_LARGE`, `INVALID_JSON`,
`INVALID_INVENTORY` and `INVALID_ARGUMENTS`. Error messages do not echo input
values or file paths.

| Command | Success result |
| --- | --- |
| `analyze` | `{ok:true, scenario:"phone", counts:{locked,available,unknown}, accounts:[{id,name,status,chain,paths:[{text,status}],explanation}]}` |
| `fixes` | `{ok:true, scenario:"phone", counts:{locked,available,unknown}, fixes:[{id,title,targets,rescued,countsAfter:{locked,available,unknown},conditional:true,assumptions:[string]}]}` |

The shape notation above is descriptive; counts are integers, IDs and messages
are strings, and `status` is exactly `Available`, `Locked out` or `Unknown`.
Mika's analysis gives **7 locked, 1 available, 1 unknown**. Her fixes rank as
backup codes off phone (**3**), another-device passkey (**2**), and independent
recovery (**1**).

Fixes are sorted by descending `rescued`, measured against the same original
phone-loss inventory, including dependent accounts. Ties keep proposal order
(backup, passkey, independent). Proposals without targets are omitted.
These are **conditional simulations**, assuming the stated recovery path works;
no service support or access is verified. Unknown becoming Available is not
counted as a rescue. Do not sum counts across overlapping fixes. The UI supports
cumulative application of fixes and undo. Proposals cover these three method
patterns only; an empty list is not proof of safety.

## MCP (local stdio)

Start with Node 22:

```sh
node mcp/server.mjs
```

Configure a local MCP client to launch `node` with the absolute path to
`mcp/server.mjs` as its sole argument. There is no HTTP listener or dependency
installation. The server implements the tools-only subset of MCP **2025-11-25**
using [newline-delimited UTF-8 JSON-RPC over stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
It handles `initialize`, `notifications/initialized`, `ping`, `tools/list` and
`tools/call`; it advertises no resources, prompts, sampling or subscriptions.
Unsupported requested protocol versions negotiate to `2025-11-25`; clients must
check that version. Close stdin to stop the server. Stdout is protocol JSON only.

| Tool | Input object | Output |
| --- | --- | --- |
| `analyze_lockout` | `{inventory: Account[], lose?: "phone"}` | Same analysis object as CLI `analyze` |
| `suggest_fixes` | `{inventory: Account[]}` | Same fixes object as CLI `fixes` |

Both tools require `inventory` inline; they accept no file paths or URLs.
`tools/list` provides full `inputSchema` and `outputSchema` objects and marks both
tools read-only, idempotent and closed-world. Successful calls return the object
in `structuredContent` and the identical JSON as a text content item, with
`isError:false`, following the [MCP tools contract](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

Example request after initialization:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"analyze_lockout","arguments":{"inventory":[{"id":"bank","name":"Bank","methods":[{"kind":"sms"}]}],"lose":"phone"}}}
```

Invalid tool arguments or inventories return `isError:true` with a text content
item containing `{ok:false,error:{code,message}}`. They omit `structuredContent`
because the advertised output schemas describe success. Protocol errors use
JSON-RPC codes: `-32700` invalid JSON, `-32600` invalid/oversized request,
`-32601` unknown method, `-32602` invalid protocol parameters or unknown tool,
and `-32002` use before initialization. Notifications receive no responses.
Oversized messages are discarded through the next newline so later messages
can still be processed. Calls are sequential and local, without background jobs.

Only submit fictional data for the hackathon. The server itself never transmits
data outside stdio; an agent client controls what it sends to its own model or
services, so the server cannot promise that a separately configured client is
offline.

## Work within the build window (2026-10-17–2026-11-22)

The first single-page prototype was built on **2026-11-12**. On **2026-11-13**,
the shared calculation core, reproducible inline build, CLI, local MCP server,
metadata schema, Mika JSON example, Node package scripts and additional tests
were added. Both dates fall within the hackathon build window.

No pre-existing third-party work is included in the project.

## Built with
Plain HTML, CSS and JavaScript in one file. No external requests, fonts, or libraries.

## Review on November 13, 2026

The generated `index.html` was reviewed in a headless Chromium browser at desktop
(1440 px) and mobile (390 px) widths, from the first screen through the sample
flow, with no network requests observed and no page errors.

## Credits and AI assistance
- I used OpenAI Codex to generate code and tests, and Anthropic Claude for
  planning, review and browser checks. I selected the project and its design
  direction from options explored with AI assistance.
- All sample data is fictional.
