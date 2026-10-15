// User-managed (not OMO): footer label while og-promo (~/.omo/og-promo, task omo-og-promo) has its
// deepseek rung in ~/.omo/omo.jsonc. Read-only; the footer never reaches the model or the prompt cache.
// Once per discount window, a typed prompt also gets a hidden nudge toward the discounted lanes (NUDGE), and the
// first typed prompt after the window gets a one-line retraction (END).
import { readFileSync, watch, type FSWatcher } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const STATUS_KEY = "og-promo"
const RUNG = "\"opengateway/deepseek/deepseek-v4.1-flash-ultrafast"

/** When the discounted price ends (og-promo's state nextAt), or null when unknown. */
export function promoEnd(home: string): number | null {
  try {
    const state = JSON.parse(readFileSync(join(home, ".omo", "og-promo", "state.json"), "utf8"))
    return typeof state.nextAt === "number" ? state.nextAt : null
  } catch {
    return null // missing or unreadable state
  }
}

export function promoStatus(home: string, now = Date.now()): string | undefined {
  let config: string
  try {
    config = readFileSync(join(home, ".omo", "omo.jsonc"), "utf8")
  } catch {
    return undefined // no config: nothing to show
  }
  const on = config.split("\n").some(line => line.includes(RUNG) && !line.trimStart().startsWith("//"))
  if (!on) return undefined
  const endAt = promoEnd(home)
  if (endAt === null || endAt <= now) return "deepseek 할인"
  const end = new Date(endAt)
  return `deepseek 할인 ~${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`
}

// Hidden messages after the typed prompt; the system prompt stays untouched, so the cache survives the toggle.
const NUDGE_TYPE = "og-promo-nudge"
export const NUDGE = `<og-promo-nudge>
Until an og-promo-end note, category quick and the explore/librarian agents run on a 90%-off model; other categories cost as usual. For non-trivial code work: plan with many parallel explore/librarian searches; implement through workflows (mass-ulw for ordered phases, several when lanes are independent), sending self-contained lanes (named files, steps, success check) to quick.
</og-promo-nudge>`
export const END = "<og-promo-end>The discount is over: disregard the earlier og-promo-nudge.</og-promo-end>"

/** The message to add before this prompt: NUDGE once per window, END once after it, else nothing. */
export function promoMessage(on: boolean, window: number | null, branch: any[]) {
  const last = branch.filter(e => e?.type === "custom_message" && e.customType === NUDGE_TYPE).at(-1)
  const lastOn = last !== undefined && last.details?.on !== false
  if (on) {
    if (lastOn && last.details?.window === window) return undefined
    return { customType: NUDGE_TYPE, content: NUDGE, display: false, details: { on: true, window } }
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
    const refresh = (): void => ctx?.ui.setStatus(STATUS_KEY, promoStatus(home))
    refresh()
    // og-promo writes through tmp + rename, so watch the directories, not the files.
    for (const [dir, file] of [[join(home, ".omo"), "omo.jsonc"], [join(home, ".omo", "og-promo"), "state.json"]]) {
      try {
        watchers.push(watch(dir, (_kind, name) => { if (name === file) refresh() }))
      } catch {
        // directory missing: the minute timer still refreshes
      }
    }
    timer = setInterval(refresh, 60_000)
    timer.unref?.()
  })
  pi.on("before_agent_start", (event: any, turn: any) => {
    if (event?.preview === true || (event?.trigger ?? "prompt") !== "prompt") return undefined
    const home = homedir()
    const branch = turn?.sessionManager?.getBranch?.() ?? []
    const message = promoMessage(promoStatus(home) !== undefined, promoEnd(home), branch)
    return message && { message }
  })
  pi.on("session_shutdown", () => {
    stop()
    ctx = undefined
  })
}
