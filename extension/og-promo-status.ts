// User-managed (not OMO): footer label with deepseek's current OpenGateway discount and the time until the price
// changes, from og-promo's schedule (~/.omo/og-promo/state.json, task omo-og-promo). Read-only; the footer never
// reaches the model or the prompt cache. While og-promo has the rung in the root [native] lanes of ~/.omo/omo.jsonc
// (profiles are not looked at), once per discount window (again after a compaction) a typed prompt also gets a hidden
// nudge toward the discounted lanes (nudge()), and the first typed prompt after the window gets a one-line retraction
// (END).
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const STATUS_KEY = "omo-og-promo"
const MODEL = "opengateway/deepseek/deepseek-v4.1-flash-ultrafast"
// The lanes og-promo.mjs toggles, under the root "[native]".
const LANES = [["categories", "quick"], ["agents", "explore"], ["agents", "librarian"]]

type Rung = string | { model?: string }
type Lanes = Record<string, Record<string, { models?: Rung[] } | undefined> | undefined>

/** JSONC text to a value: comments, then trailing commas, removed outside strings. */
function parseJsonc(text: string): unknown {
  const keepStrings = (_match: string, str?: string) => str ?? ""
  const plain = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, keepStrings)
  return JSON.parse(plain.replace(/("(?:\\.|[^"\\])*")|,(?=\s*[}\]])/g, keepStrings))
}

/** True while the rung leads or sits in a root [native] lane; a copy left in a profile does not count. */
export function rungOn(config: string): boolean {
  const native = (parseJsonc(config) as { "[native]"?: Lanes } | null)?.["[native]"]
  return LANES.some(([kind, name]) =>
    (native?.[kind]?.[name]?.models ?? []).some(rung => (typeof rung === "string" ? rung.split(":")[0] : rung?.model) === MODEL))
}

type Schedule = { discountNow: number; nextAt: number | null; discountNext: number | null }

/** og-promo's last price schedule (state.json), or null when missing or unreadable. */
function promoSchedule(home: string): Schedule | null {
  try {
    const state = JSON.parse(readFileSync(join(home, ".omo", "og-promo", "state.json"), "utf8"))
    if (typeof state.discountNow !== "number") return null
    return {
      discountNow: state.discountNow,
      nextAt: typeof state.nextAt === "number" ? state.nextAt : null,
      discountNext: typeof state.discountNext === "number" ? state.discountNext : null,
    }
  } catch {
    return null // missing or unreadable state
  }
}

/** When the current price ends (og-promo's state nextAt), or null when unknown; the nudge's window id. */
export function promoEnd(home: string): number | null {
  return promoSchedule(home)?.nextAt ?? null
}

/** True while og-promo has the rung in a root [native] lane of omo.jsonc. */
export function promoOn(home: string): boolean {
  try {
    return rungOn(readFileSync(join(home, ".omo", "omo.jsonc"), "utf8"))
  } catch {
    return false // no or unparsable config
  }
}

/** deepseek's discount now and the time until the price changes (`deepseek 50% ~9h 27m`); just the rate once that
 * time has passed without a newer schedule; nothing without a discount. */
export function promoStatus(home: string, now = Date.now()): string | undefined {
  const schedule = promoSchedule(home)
  if (!schedule) return undefined
  const changed = schedule.nextAt !== null && schedule.nextAt <= now
  const percent = Math.round(((changed ? schedule.discountNext : schedule.discountNow) ?? 0) * 100)
  if (percent <= 0) return undefined
  if (schedule.nextAt === null || changed) return `deepseek ${percent}%`
  const minutes = Math.floor((schedule.nextAt - now) / 60_000)
  const hours = Math.floor(minutes / 60)
  const left = hours >= 24 ? `${hours}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
  return `deepseek ${percent}% ~${left}`
}

// Hidden messages after the typed prompt; the system prompt stays untouched, so the cache survives the toggle.
const NUDGE_TYPE = "og-promo-nudge"

/** The installed mass-ulw SKILL.md (OMO_BIN is omo-ai/bin/omo.js), or undefined when it cannot be found. */
export function massUlwSkill(env: Record<string, string | undefined> = process.env): string | undefined {
  if (!env.OMO_BIN) return undefined
  const path = join(dirname(env.OMO_BIN), "..", "plugin", "skills", "mass-ulw", "SKILL.md")
  return existsSync(path) ? path : undefined
}

// Skill pointers only fire on typed input, never on extension messages, so the nudge names the skill file itself.
export function nudge(skill = massUlwSkill()): string {
  const read = skill ? ` (read ${skill} with the read tool first and follow it)` : " (read the mass-ulw skill first and follow it)"
  return `<og-promo-nudge>
Until an og-promo-end note, category quick and the explore/librarian agents run on a 90%-off model; other categories and your own direct work cost as usual. For non-trivial code work: plan with many parallel explore/librarian searches; implement through mass-ulw workflows${read}, split into as many self-contained quick lanes (named files, steps, success check) as the work safely allows. Route a lane above quick only with a one-line reason.
</og-promo-nudge>`
}
export const END = "<og-promo-end>The discount is over: disregard the earlier og-promo-nudge.</og-promo-end>"

/** The message to add before this prompt: the nudge once per window and again after a compaction, END once after
 * the window, else nothing. */
export function promoMessage(on: boolean, window: number | null, branch: any[], content = nudge()) {
  const at = branch.findLastIndex(e => e?.type === "custom_message" && e.customType === NUDGE_TYPE)
  const last = at >= 0 ? branch[at] : undefined
  const lastOn = last !== undefined && last.details?.on !== false
  if (on) {
    const compacted = branch.findLastIndex(e => e?.type === "compaction") > at
    if (lastOn && last.details?.window === window && !compacted) return undefined
    return { customType: NUDGE_TYPE, content, display: false, details: { on: true, window } }
  }
  return lastOn ? { customType: NUDGE_TYPE, content: END, display: false, details: { on: false } } : undefined
}

export default function (pi: any): void {
  let ctx: any
  let watchers: FSWatcher[] = []
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = (): void => {
    for (const watcher of watchers) watcher.close()
    watchers = []
    if (timer) clearInterval(timer)
    timer = undefined
  }
  pi.on("session_start", (_event: unknown, next: any) => {
    stop()
    ctx = next
    if (!ctx?.hasUI || typeof ctx.ui?.setStatus !== "function") return
    const home = homedir()
    const refresh = (): void => {
      try {
        ctx?.ui.setStatus(STATUS_KEY, promoStatus(home))
      } catch {
        // ctx went stale after a reload or session switch; session_start rebinds it
      }
    }
    refresh()
    // Watch the directory, not the file, so a state.json that is replaced or recreated is still seen.
    try {
      watchers.push(watch(join(home, ".omo", "og-promo"), (_kind, name) => { if (name === "state.json") refresh() }))
    } catch {
      // directory missing: the minute timer still refreshes
    }
    timer = setInterval(refresh, 60_000)
    timer.unref?.()
  })
  pi.on("before_agent_start", (event: any, turn: any) => {
    if (event?.preview === true || (event?.trigger ?? "prompt") !== "prompt") return undefined
    const home = homedir()
    const branch = turn?.sessionManager?.getBranch?.() ?? []
    const message = promoMessage(promoOn(home), promoEnd(home), branch)
    return message && { message }
  }, { previewSafe: true })
  pi.on("session_shutdown", () => {
    stop()
    ctx = undefined
  })
}
