# Agent Office

**A Claude Code mod that turns your session into an office.** Claude is the manager at the desk; every subagent is a member of staff. Hand out work and they get up and go: research sends them to the **Warehouse**, reading to the **Archives**, edits to the **Workshop**, shell commands to the **Server Room**. When a call needs your permission they queue at the **HR Desk**, and when they finish they take a break. A **Supervisor** picks the model for each prompt: Haiku for quick questions, Opus for heavy work, your session model for the rest. Under the office sits the full [Flightdeck](https://github.com/scasella/claude-flightdeck) dashboard (context, cost, permissions, subagents) plus budget alerts and a daily usage log.

Forked from [Flightdeck](https://github.com/scasella/claude-flightdeck) by Stephen Casella (MIT).

```
office · 2 at work                    someone needs your signature
╭─────────────╮ ╭─────────────╮ ╭─────────────╮ ╭─────────────╮
│ Open Plan   │ │ Archives    │ │ Warehouse   │ │ Workshop    │
│             │ │ ☻ Claude ⠹  │ │             │ │             │
╰─────────────╯ ╰─────────────╯ ╰─────────────╯ ╰─────────────╯
· · · · · · · · · · · · · · ›☺O · · · · · · · · · · · · · · · ·
╭─────────────╮ ╭─────────────╮ ╭─────────────╮ ╭─────────────╮
│ Server Rm   │ │ Meeting Rm  │ │ HR Desk     │ │ Break Room  │
│             │ │             │ │ ☺ Olu ?     │ │             │
╰─────────────╯ ╰─────────────╯ ╰─────────────╯ ╰─────────────╯
Olu: pacing outside HR about claude code mods
Claude: squinting at sandbox/notes.txt
```

## Install

Inside Claude Code (2.1.287 or later):

```
/plugin marketplace add sauravkalia/agent-office
/plugin install agent-office@agent-office
/reload-plugins
/office
```

Or load it straight from a clone, for one session:

```sh
git clone https://github.com/sauravkalia/agent-office
claude --plugin-dir ./agent-office
```

Mods are an early-access Claude Code feature and their API can change between releases. If something breaks, see [Troubleshooting](#troubleshooting).

## The office

| Room | Who's there | Sent by |
| --- | --- | --- |
| **Open Plan** | thinking between calls; idle (z) between turns | no tool in flight, `TodoWrite`, anything unlisted |
| **Archives** | reading and searching the code | `Read`, `Grep`, `Glob`, `LSP`, `Skill`, `ToolSearch` |
| **Warehouse** | research | `WebSearch`, `WebFetch`, any `mcp__*` tool |
| **Workshop** | changing files | `Edit`, `Write`, `NotebookEdit` |
| **Server Rm** | running commands | `Bash`, `PowerShell`, `Monitor` |
| **Meeting Rm** | briefing subagents; the architect while advising | `Agent`, `SendMessage`, `Workflow` |
| **HR Desk** (?) | waiting for your signature: a permission prompt is open | a pending `ask` from `tool.check`; `AskUserQuestion` |
| **Break Room** | finished (✓) or failed/stopped (!) | the subagent's `turn.complete` |

Each worker keeps the same name for the session and mutters something about the thing they're working on ("rummaging through aisle 7 for claude code mods", "hammering on src/app.ts"). A failed call is an oops ("blames the intern for…"). The walk is drawn on the surface's own frame clock, so only the office redraws while someone moves. With `motion: off` they teleport. Above the prompt (no fullscreen) the office is one line: `Claude ▸ Workshop · Olu ▸ HR Desk (needs you)`.

## Everything else on the pane

| Panel | Shows | From |
| --- | --- | --- |
| **office** | the main loop as the manager (☻ Claude) and each subagent as staff (☺ Priya, Bob, …), in the room of their current tool call, walking the hallway when it changes; a line of chatter each | `tool.call`, `tool.check`, `agent.spawn`, `turn.complete` |
| **main** | model, effort, permission mode, request count; a context gauge with compactions (⟲); cost and the first two rate-limit windows when your plan reports them, with the time to each reset (↻) from 56 columns; the last main-loop request's time to first token and output tokens per second | `turn.step`, `session.measure`, `session.compact`, `$.session.usage()` |
| **architect** | consults on a timeline, whether one is running, how long the last took; optionally the moment of each consult; the first line of a subagent architect's advice | a spawn of a matching agent type, or a matching server tool in the assistant's rows |
| **gate** | one cell per permission check: green allowed without asking, blue decided by the auto-mode classifier or you and then run, amber pending, red ✗ denied, dim if made inside a subagent. Totals, and a drill-down per tool family with credentials masked | `tool.check`, settled by the `tool.call` around it |
| **agents** | cards side by side while they fit: the task, type, live context and output tokens, steps, a running clock, `max_tokens` in red. Beyond that, swimlanes on one time axis | `agent.spawn`, `turn.step`, `tool.call`, `turn.complete` |
| **loops** | model loops that match no card: workflow agents, compactions, memory forks | `turn.step` ids no card claims |
| **receipt** | the running turn, or the last one: duration, agents, edits, errors, cost added | `turn.start`, `turn.complete` |
| **log** | prompts, spawns, completions, consults, edits, errors and denials; filtered to one agent while you view its transcript | all of the above |

Panels with nothing to show take no room, so a session without subagents shows the office, the main box and the log.

## The team: a supervisor who delegates

Hand the supervisor a task and it splits the work between three teammates that ship with the mod:

```
/agent-office:assign add CSV export to the reports page
```

| Teammate | Agent type | Does | Model | Can edit |
| --- | --- | --- | --- | --- |
| researcher | `agent-office:researcher` | reads the code (and the web if needed), reports findings with `file:line` | Sonnet | no |
| engineer | `agent-office:engineer` | builds from the findings, runs the checks, reports what changed | your session's | yes |
| docs writer | `agent-office:docs-writer` | updates README, docs and changelog to match | Sonnet | docs only |

The supervisor (the main loop) plans first and skips a teammate the task doesn't need, waits for research, pastes the findings into the engineer's brief, then runs docs. It never pushes or opens a PR unless you ask. The office shows the org chart above the floor:

```
                 ☻ Claude · supervisor · Opus 5.5
                ┌────────────────┴───────────────┐
              ☺ Olu                            ☺ Raj
            research                        engineering
             ✓ done                           ⠿ workshop
     Research today.sh style              Build greet.sh
```

and the log says when findings change hands: `supervisor  handed Olu's research to Raj (engineering)`. Any agent type shows on the chart with a role read from its name (`Explore` → research, a `*reviewer` → review, `Plan` → planning). Edit the teammates in [`agents/`](agents) and the supervisor's playbook in [`commands/assign.md`](commands/assign.md).

## The building: every session on this machine

`/office building` (or `b` in the pane) swaps the office for the whole building: each project is a floor, each running Claude Code session a person on it, busy (⠿) or idle (z, with how long). The session you're in is ☻ and marked `(here)`. Below, **gone home** lists sessions closed in the last 3 days with their last prompt. `/office office` or `b` again flips back.

```
building · 9 running · 1 busy · 7 gone home            b: office ▸
╭ daily-dose ──────────────────╮ ╭ Quilt-Discussion ────────────╮
│ ☻ ⠿ What is jev (here) · bg  │ │ ☺ z 8m close-error-observab… │
╰──────────────────────────────╯ ╰──────────────────────────────╯
╭ gone home · last 3 days ──────────────────────────────────────╮
│ sphere-v3-web           23h ago  I did some clicks. Please ch… │
╰───────────────────────────────────────────────────────────────╯
```

Where it looks, every 5 s while the building is on screen (and never otherwise):

- `~/.claude/sessions/*.json`: Claude Code's registry of running sessions (name, folder, busy/idle). The `.key` files next to them are never read.
- `~/.claude/history.jsonl`: your prompt history (project, session, time), re-read only when it changes.

Both are Claude Code's own files, not a documented API, so an update could change them; the pane then says what it couldn't read. It only looks: it can't type into another session. A session that crashed leaves its registry file behind, so it shows as idle for as long as that file stays. `$.fs.read` stops at 4 MB, so once your history file grows past that, closed sessions drop out (running ones still show).

## Supervisor: a model per prompt

Each prompt you type is sorted by its words alone (no model call, no tokens):

| Tier | Sent by | Runs on (default) |
| --- | --- | --- |
| **light** | short questions: "what does…", "list…", "show…", "run…", "rename…" | `claude-haiku-4-5` |
| **standard** | everyday tasks | your session model, untouched |
| **heavy** | "design", "debug", "refactor", "why does…", "migrate", "review", a stack trace, a long brief, plan mode | `claude-opus-5-5` at `high` effort |
| *continue* | "yes", "ok go ahead", "do it" | whatever ran last; a go-ahead never drops a task to Haiku |

Every step of the turn then runs on that model; subagents keep their own. The office header shows the call: `supervisor light (quick question) → Haiku 4.5 · saves ~$0.01`.

**Switching isn't free, and the supervisor knows it.** The prompt cache belongs to one model, and changing effort invalidates it too, so every switch re-sends the whole conversation at the cache-write price. Claude Code's own system prompt and tools are roughly 40k tokens before you type anything, so even an early switch to Opus costs around $0.30 to re-cache. The rules:

- **Downgrades** (to Haiku, or to lower effort) happen only when the estimated saving over the turn beats the re-cache. Early in a session, or after the cache has gone cold (an hour idle), that's usually true. Deep into a long session it usually isn't, and the log says why: `kept Opus 5.5: switching re-caches 150k (~$1.20) to save ~$0.05`.
- **Upgrades** are always taken, because quality comes first, and the re-cache cost is shown.
- Context that won't fit the target (Haiku has 200K) is never switched to.

```
/office route                 # what it runs on now, last decision, switches, estimated saving
/office route light|standard|heavy   # pin a tier for this session
/office route auto|off        # back to routing / leave the session model alone
```

Set the defaults in `/config`: `routing` (`auto`/`off`), `lightModel`, `heavyModel`, `lightEffort`, `heavyEffort`. The savings are estimates (about 800 output tokens per step, 3/8/15 steps for light/standard/heavy turns, list prices); `/office usage` shows what was actually spent.

## Budget alerts

A toast (and a log line) the first time the session's cost passes 50%, 80% and 100% of `costBudgetUsd` ($5 by default), and when context passes 70% and 90%. A jump past several levels raises only the highest. The status line shows `budget N%` from the first level on.

## Daily usage log

Each finished turn updates that session's entry for the day it started: project, model, turns, subagents and cost. It's kept in the plugin's store for 90 days and mirrored to `~/.claude/agent-office/usage/YYYY-MM-DD.json`.

```
/office usage          # today, one row per session
/office usage week     # the last 7 days, one row per day
```

## Use

| Command | Does |
| --- | --- |
| `/office` | open the pane (`/flightdeck` still works as an alias) |
| `/office close` | close it |
| `/office reset` | clear the office, agents, checks, consults, log and the turn |
| `/office usage [today\|week]` | the usage log as a table |
| `/office route [auto\|off\|light\|standard\|heavy]` | show or set the supervisor |
| `/agent-office:assign <task>` | hand a task to the supervisor and its team |
| `/office building` / `/office office` | every session on this machine / back to this session's office (`b` in the pane) |
| `/office layout auto\|compact\|wide\|mini` | override the layout for this session |

Focus the pane with `ctrl+x tab`, then `1`, `2`, … expand an agent card, and `f` `s` `o` open the gate's file, shell or other drill-down.

## What it can reach

It never denies, rewrites or delays a tool call, a prompt or a subagent, and it makes **no** network requests, runs no processes and calls no model. One thing is not watch-only: with `routing: auto`, the **Supervisor rewrites the model and effort of the main loop's requests** (`turn.step`). Set `routing: off` and it goes back to watching only, like Flightdeck.

Compared with upstream, Agent Office adds:

| Adds | Why |
| --- | --- |
| `$.store` get/set/keys/delete | the daily usage log (this plugin's own store) |
| `$.fs.write` to `~/.claude/agent-office/usage/` only | the JSON mirror of the usage log |
| `$.env.get("HOME")` | to find that folder, and the session files below |
| `$.fs.list` / `$.fs.read` / `$.fs.stat` on `~/.claude/sessions/*.json` and `~/.claude/history.jsonl` | the building view, only while it's on screen |
| `$.ui.toast` | budget and context alerts |
| `turn.step` rewrite of `model` / `effort` (main loop only) | the Supervisor |

`claude plugin validate .` prints exactly what it hooks and calls.

## What is inferred, not measured

- **Architect moments.** "Before a plan" means no edits yet this turn, "error repeats" means 2+ main-loop errors in a row, "before done" means edits were made. They are labelled `(inferred)`; turn them off with `moments: false`.
- **Server-side advice is encrypted.** For a server tool such as Claude Code's `advisor`, the pane counts and times the consult but cannot show what it said.
- **Per-agent context is the latest request's whole input** (uncached + cache read + cache write). It is labelled `ctx`, not cost: the API has no per-agent cost.
- **Other loops** can't tell a workflow agent from a compaction fork; both are model loops no card claims.
- **A background agent's first step** can arrive before its card exists, so its usage may show one step late.
- **Request speed.** `ttft` and `tok/s` are timed at the pane's own `turn.step` hook, so they include everything beneath it: other plugins' hooks, the engine, the network and any retry. `tok/s` divides the reported `output_tokens` (thinking included) by the time from the first piece of response to the stop. Measured, not inferred, but not the API's own figures.

## Configure

In `/config`, or under `pluginConfigs["agent-office"].options` in `settings.json`:

| Option | Default | Meaning |
| --- | --- | --- |
| `palette` | `office` | `office` is warm wood and lamplight for dark terminals; `theme` follows your Claude Code theme (use it on light terminals); `pastel` is Flightdeck's fixed colours |
| `panels` | `office,main,agents,gate,architect,receipt,loops,log` | which panels show, in order |
| `routing` | `auto` | the Supervisor: `auto` routes each prompt, `off` keeps the session model |
| `lightModel` / `heavyModel` | `claude-haiku-4-5` / `claude-opus-5-5` | models for light and heavy prompts |
| `lightEffort` / `heavyEffort` | `low` / `high` | effort for light and heavy prompts |
| `costBudgetUsd` | `5` | session budget for alerts; `0` turns cost alerts off |
| `costWarnPct` | `50,80,100` | budget percentages that raise a toast |
| `contextWarnPct` | `70,90` | context-fill percentages that raise a toast |
| `motion` | `while-active` | `off` keeps the office and connectors still |
| `layout` | `auto` | `mini`, `compact`, `wide`, or `auto` |
| `maxCards` | `3` | agent cards side by side before swimlanes (1–6) |
| `openOnStart` | `true` | open the pane when a session starts (terminals ≥ 144 columns) |
| `statusLine` | `true` | context, agents, consults, denials and budget in the status line |
| `architectPattern`, `architectLabel`, `matchDescriptions`, `moments`, `gateLabel` | as Flightdeck | see [upstream](https://github.com/scasella/claude-flightdeck#configure) |

## Troubleshooting

**The pane doesn't appear.** Check `claude --version` is 2.1.287 or later, then `/reload-plugins` and `/office`. Below 144 columns Claude Code won't seat a pane nobody asked for; `/office` opens it at any width. A dim transcript line starting `agent-office:` names the hook that failed.

**Colours look wrong.** On a light terminal set `palette` to `theme`.

**Too much motion.** Set `motion` to `off`.

## How it works

| File | Holds |
| --- | --- |
| [`hooks/register.tsx`](hooks/register.tsx) | the event hooks, state access, and one function per panel |
| [`hooks/office-core.ts`](hooks/office-core.ts) | the office as pure data: tool → room, staff names, quips, the scene |
| [`hooks/office.tsx`](hooks/office.tsx) | the office drawing, a surface module that animates the hallway on its own frame clock |
| [`hooks/usage-core.ts`](hooks/usage-core.ts) | the usage log and its report |
| [`hooks/building-core.ts`](hooks/building-core.ts) | the building: reading the session registry and history, floors and gone-home |
| [`hooks/supervisor-core.ts`](hooks/supervisor-core.ts) | the Supervisor: prompt tiers, prices, and the switch-or-stay decision |
| [`hooks/core.ts`](hooks/core.ts) | Flightdeck's reducers and formatters, plus the alert thresholds |
| [`hooks/rail.tsx`](hooks/rail.tsx), [`hooks/elapsed.tsx`](hooks/elapsed.tsx) | animated connectors and live clocks |
| [`types/index.d.ts`](types/index.d.ts) | the state contract |
| [`tests/`](tests) | pure behaviour, plus drawings mounted on each surface |

## Related projects

Agent Office works alongside these, and owes ideas to them:

- [claude-hud](https://github.com/jarrodwatts/claude-hud): context, limits, tools and agents in your status line. Use both: that's the status line, this is the pane.
- [zoetrope](https://github.com/furkankly/zoetrope): a Claude Code or Codex session as a live flow graph.
- [ccusage](https://github.com/ccusage/ccusage): cost reports from your session logs.
- [awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods): the index of Claude Code mods.

## Develop

```sh
claude --plugin-dir .            # load it; edits hot-reload
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .       # after the first load, which writes .claude-plugin/types/
```

Pull upstream fixes with `git fetch upstream && git merge upstream/main`.

## License

[MIT](LICENSE). Original work © 2026 Stephen Casella; office, alerts and usage log © 2026 Saurav Kalia.
