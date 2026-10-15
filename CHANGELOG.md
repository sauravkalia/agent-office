# Changelog

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
