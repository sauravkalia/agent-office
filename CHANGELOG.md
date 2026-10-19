# Changelog

## 0.12.0

- **Supervisor: three tiers.** Quick questions go to Haiku 5.5, everyday tasks to Sonnet 5.5 (the new `standardModel` setting; `session` keeps the old behaviour), and heavy work to Opus 5.5 at high effort. Before, everything but quick questions stayed on the session model. Quick questions mostly stayed there too, because switching to Haiku 4.5 never paid for re-caching Claude Code's ~50k tokens of context.
- Prices per model version (Haiku 5.x is $0.10/$0.50, a tenth of Haiku 4.5). The supervisor also remembers which models and efforts it used in the last hour, so going back to one only pays for what's new. After a heavy turn on Opus, the next everyday prompt can drop back to Sonnet.
- **Work board** under the department office (and the text office): per department, the task, the repo, what its tab is doing right now, and `+N queued`. It replaces the one-line ticker that cut off at ~50 columns.
- **Repo detection:** a department in a folder of several repos says which one it's in, from file paths, `cd`/`git -C`, and paths in shell commands. Until then, the repo named in the brief is used. Shown on the board and as a tag on the desk in the pixel office.
- **Toasts** when a department starts on a task and when it finishes.
- Replies close a department's **oldest** open task (it answers in order). Tasks answered together in one reply close once its tab is idle.

## 0.11.1

- **Fills the pane:** the department office spans every column at the largest whole-number scale, and spare width goes into wider desks and rooms, so there's no empty strip on the right. It resizes with the pane. Before, it was sized from the assumed 7x17 cell, so on bigger cells the terminal showed it at its own small size.
- **Measures the cell size** (`cellPx: auto`, the new default) by reading the terminal's window size with one `python3` call; a large Retina cell is assumed until that lands. `cellPx: WxH` still overrides.
- **Name plates:** every desk carries its department's name and state in the art. The detached label rows under the picture are gone; one line lists the tasks in flight.

## 0.11.0

- **Department office** (pixel mode with departments): a person per department at their own desk, HQ in the middle, and shared rooms with their names on the door (Archives, Warehouse, Server Rm, Workshop). People walk to HQ to collect a brief and carry it back, go to the room their session is working in, and bring a ✓ to HQ's in-tray (confetti) when they reply. Plus a 4-step eased walk, breathing, blinking, typing, coffee steam, bubbles that pop in, a red flash on failing commands, and window light that follows your clock.
- **Sharp pixels:** drawn at a whole-number scale into whole terminal cells (`cellPx`, default `7x17`), so the terminal never stretches it. That stretching was why 0.10 looked blurry. A real deflate keeps sharp frames around 20 KB.
- Every tab writes a tiny status file (`~/.claude/agent-office/status/<session>.json`) naming the room it's working in; HQ reads the running departments' files every 2 s.

## 0.10.0

- **Pixel office** (opt-in): `/office pixel` or `p` draws the office as original pixel art. It's an inline picture in kitty, Ghostty and WezTerm, animated with `$.ui.blit` while someone works or walks, and an SVG in the desktop app. Terminals that can't show pictures keep the text office unchanged; detection comes from the terminal's environment and is confirmed when a blit is refused. `officeStyle: pixel` makes it the default. The art is drawn in code, so no sprite files are copied.

## 0.9.4

- Fix: running `/agent-office:assign` inside a department's own folder (e.g. the Sphere tab in `~/Documents/GitHub`) said that department was "not running". HQ now counts as that department's desk and does the work itself.

## 0.9.3

- The per-prompt model routing line now reads **model** (it read "supervisor", which is the HQ boss that hands out work).

## 0.9.2

- Sphere Dev is one session opened in `~/Documents/GitHub`, covering the web and backend Sphere repos, instead of one session per repo.

## 0.9.1

- The Quilt-Discussion department is labelled **Quilt Discussion**.

## 0.9.0

- **Departments**: the supervisor hands a task to a long-running session you keep open for that area (PR reviews, Sphere repos, discussion, social, daily dose) with `SendMessage`, instead of spawning a new subagent each time. `/agent-office:assign` adds the live roster to the task; the HQ office shows each department's session, busy or idle, with its last task and reply. Configure in `/config` → Departments; preview with `/office departments`.

## 0.8.1

- **reviewer** teammate and a review path in `/agent-office:assign`: PR reviews go to read-only reviewers (split by area on big PRs), findings come back ranked with draft inline comments, nothing is posted until you agree.

## 0.8.0

- **The team**: three teammate agents ship with the mod (`researcher`, `engineer`, `docs-writer`) and `/agent-office:assign <task>` hands a task to the supervisor, who plans it, runs research, passes the findings to the engineer and has docs updated, without pushing or opening PRs unless asked.
- **Org chart** above the office floor: the supervisor and up to four teammates with their role, status and task; the log notes each handoff.

## 0.7.0

- **The building**: `/office building` (or `b`) shows every Claude Code session on the machine, a floor per project with running sessions busy or idle, and the sessions closed in the last 3 days under "gone home" with their last prompt. Reads `~/.claude/sessions/*.json` and `~/.claude/history.jsonl` every 5 s while on screen; never the `.key` files.

## 0.6.0

- **Supervisor**: each prompt you type is classified locally as light, standard or heavy, and the main loop runs on Haiku, your session model or Opus (high effort) to match. Downgrades happen only when the saving beats the cost of re-caching the conversation; upgrades always happen. `/office route` shows or pins it; `routing: off` turns it off. Shown in the office header and the session log.

## 0.5.0 (Agent Office, forked from Flightdeck 0.4.0)

- **The office**: the main loop as the manager and each subagent as named staff, in the room of their current tool call (Warehouse for research, Archives for reading, Workshop for edits, Server Room for commands, HR Desk while a permission prompt waits, Break Room when done), walking the hallway as it changes, with a line of chatter each.
- **Budget alerts**: toasts when session cost passes `costWarnPct` of `costBudgetUsd`, or context passes `contextWarnPct`.
- **Daily usage log**: per-session turns, agents and cost, filed by day in the plugin store and `~/.claude/agent-office/usage/`; `/office usage [today|week]`.
- **office palette** (default) and the office panel first.
- Renamed to `agent-office`; `/office`, with `/flightdeck` kept as an alias. Searches show their query in the log.

## 0.4.0

- The main box shows the time left until each rate-limit window resets (`5h ▰▱▱▱▱ 19% ↻3h10m`), from the `resetsAt` the session already reports. Below 56 columns the gauges stay as they were. ([#3](https://github.com/scasella/claude-flightdeck/pull/3), thanks @vihrea1337)
- The main box shows the last main-loop request's time to first token and decode speed (`last req  ttft 0.8s · 60 tok/s`), timed as its response streams past. ([#1](https://github.com/scasella/claude-flightdeck/issues/1))
- The session log has a one-row gap above it, in both layouts. ([#2](https://github.com/scasella/claude-flightdeck/issues/2))

## 0.3.2

- A background architect's advice is read from its `SubagentHandback` tool call, where the report actually arrives, with the hand-back text as a fallback. Bold markers no longer leak into the advice line.
- README: no longer promises that counters survive every update; a change to the state's shape may reset them once.

## 0.3.1

- The main box shows the model and effort as soon as a request starts, not after the first one finishes.
- Advice from a background architect agent (such as `fable-advisor`) now reaches the architect's `»` line; it arrives as a hand-back message, not as the agent's own answer.
- New README media showing the Flightdeck header; plainer wording about opening on start.
- More gate tests (24 in all).

## 0.3.0

First public release.

- Panels: main vitals (context, compactions, cost, rate limits), architect timeline, permission gate strip with per-family drill-down, agent cards and swimlanes, other loops, turn receipt, session log.
- Layouts: docked one- or two-column, and an 8-row inline summary for the main screen. Cards fall back to swimlanes when they don't fit.
- Theme colours by default, with a `pastel` palette option.
- Animated connectors and live clocks as surface modules, only while work flows.
- Works on the terminal, desktop app, VS Code and mobile surfaces.
- Config for the architect pattern, labels, panels, layout, card limit, motion, moments, palette, opening on start and the status line.
- `/clear` and `/flightdeck reset` start the pane fresh; reads tolerate missing or older fields.
