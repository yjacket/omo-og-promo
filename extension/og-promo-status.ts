// User-managed (not OMO): footer label while og-promo (~/.omo/og-promo, task omo-og-promo) has its
// deepseek rung in ~/.omo/omo.jsonc. Read-only; the footer never reaches the model or the prompt cache.
import { readFileSync, watch, type FSWatcher } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const STATUS_KEY = "og-promo"
const RUNG = "\"opengateway/deepseek/deepseek-v4.1-flash-ultrafast"

export function promoStatus(home: string, now = Date.now()): string | undefined {
  let config: string
  try {
    config = readFileSync(join(home, ".omo", "omo.jsonc"), "utf8")
  } catch {
    return undefined // no config: nothing to show
  }
  const on = config.split("\n").some(line => line.includes(RUNG) && !line.trimStart().startsWith("//"))
  if (!on) return undefined
  let until = ""
  try {
    // nextAt in og-promo's state is when the discounted price ends.
    const state = JSON.parse(readFileSync(join(home, ".omo", "og-promo", "state.json"), "utf8"))
    if (typeof state.nextAt === "number" && state.nextAt > now) {
      const end = new Date(state.nextAt)
      until = ` ~${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`
    }
  } catch {
    // missing or unreadable state: show the label without an end time
  }
  return `deepseek 할인${until}`
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
  pi.on("session_shutdown", () => {
    stop()
    ctx = undefined
  })
}
