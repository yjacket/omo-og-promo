> **DEPRECATED - DO NOT USE.** This extension (`omo-og-promo`) is deprecated and must not be installed or used. Replacement: [`omo-routing`](https://github.com/yjacket/omo-routing) (OpenGateway discount policy), which owns the discount footer, the lane nudge, and the policy/reset logic. Disable the old `omo-og-promo` scheduled task and remove this extension before enabling routing in `omo-routing`. This repository is archived and read-only.

# omo-og-promo

The successor implementation lives in `omo-routing`: authored chains and
temporary policies are separate, so editing/resetting a category cannot erase
an active discount. It also owns the discount footer/hint and optional manual
Codex preference with public reset signals. See the routing package's migration
section before upgrading: disable the old `omo-og-promo` scheduled task and
remove this extension before enabling integrated routing. Do not run both
writers. No live task or installation is changed by these source edits.

While OpenGateway sells `deepseek-v4.1-flash-ultrafast` at 90% off or more, put its rung first in the root `[native]` quick / explore / librarian chains of `~/.omo/omo.jsonc`; take it out again 15 minutes before the window ends.

- `og-promo.mjs`: reads the price schedule from `https://opengateway.ai/api/model-prices` and edits `omo.jsonc` in place (comments and layout kept, written through tmp + rename, previous file kept as `omo.jsonc.before-switch`). Uses `parseJsonc` / `parseJsoncTree` from the omo-routing package (`~/.omo/agent/git/github.com/yjacket/omo-routing/extension/routing.ts`, falling back to the old `~/.omo/agent/extensions/routing.ts`; `--extension <path>` overrides both).
- `extension/og-promo-status.ts`: footer status with deepseek's current discount and the time until the price changes (`deepseek 50% ~9h 27m`, `deepseek 90% ~44h`, `~40m`), read from og-promo's `state.json`; just the rate once that time has passed without a newer schedule, nothing without a discount. While the rung is in a root `[native]` lane of `omo.jsonc` (a copy left under `profiles` does not count), once per discount window and session, and again after each compaction, a typed prompt gets a hidden note (`nudge()`, via `before_agent_start`) that asks for wide explore/librarian research when planning code work, and for mass-ulw workflows split into self-contained quick lanes when implementing it. OMO's skill pointers only fire on typed input, so the note names the installed `mass-ulw/SKILL.md` itself (found from `OMO_BIN`); the first typed prompt after the window gets a one-line retraction (`END`). Both are recorded in the session with `details.window`, so a reload does not repeat them. The system prompt is not touched, so the prompt cache survives the switch.

## Install and update

```
omo install git:github.com/yjacket/omo-og-promo
omo update git:github.com/yjacket/omo-og-promo
```

The package loads `extension/og-promo-status.ts`. The scheduled task runs `og-promo.mjs` straight from the package folder, so `omo update` updates both; state and log stay in `~/.omo/og-promo` (`state.json`, `og-promo.log`, `omo.jsonc.before-switch`).

Scheduled task (Windows), hourly at :50 and :01:

```
schtasks /query /tn omo-og-promo /v /fo list
Task To Run: C:\WINDOWS\System32\conhost.exe --headless "C:\Program Files\nodejs\node.exe" "C:\Users\yjack\.omo\agent\git\github.com\yjacket\omo-og-promo\og-promo.mjs"
Start In: C:\Users\yjack\.omo\og-promo
```

## Usage

```
node og-promo.mjs [--dry-run] [--config <omo.jsonc>] [--prices <fixture.json>] [--now <iso>] [--state <state.json>] [--log <log file>]
```
