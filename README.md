# omo-og-promo

While OpenGateway sells `deepseek-v4.1-flash-ultrafast` at 90% off or more, put its rung first in the root `[native]` quick / explore / librarian chains of `~/.omo/omo.jsonc`; take it out again 15 minutes before the window ends.

- `og-promo.mjs`: reads the price schedule from `https://opengateway.ai/api/model-prices` and edits `omo.jsonc` in place (comments and layout kept, written through tmp + rename, previous file kept as `omo.jsonc.before-switch`). Uses `parseJsonc` / `parseJsoncTree` from the omo-routing extension (`~/.omo/agent/extensions/routing.ts`).
- `extension/og-promo-status.ts`: footer status `deepseek 할인 ~HH:MM` while the rung is in `omo.jsonc`. In the same window every typed prompt gets a hidden note (`NUDGE`, via `before_agent_start`) that asks for wide explore/librarian research when planning code work, and for workflow fan-out with self-contained lanes on category quick when implementing it. The system prompt is not touched, so the prompt cache survives the switch.

## Installed copies

| File | Installed at |
| --- | --- |
| `og-promo.mjs` | `~/.omo/og-promo/og-promo.mjs` (writes `state.json` and `og-promo.log` next to it) |
| `extension/og-promo-status.ts` | `~/.omo/agent/extensions/og-promo-status.ts` |

Scheduled task (Windows), hourly at :50 and :01:

```
schtasks /query /tn omo-og-promo /v /fo list
Task To Run: C:\WINDOWS\System32\conhost.exe --headless "C:\Program Files\nodejs\node.exe" "C:\Users\yjack\.omo\og-promo\og-promo.mjs"
```

## Usage

```
node og-promo.mjs [--dry-run] [--config <omo.jsonc>] [--prices <fixture.json>] [--now <iso>] [--state <state.json>] [--log <log file>]
```
