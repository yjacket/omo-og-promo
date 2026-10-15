// User-managed (not OMO): footer label while og-promo (~/.omo/og-promo, task omo-og-promo) has its
// deepseek rung in ~/.omo/omo.jsonc. Read-only; the footer never reaches the model or the prompt cache.
// While the rung is on, typed prompts also get a hidden nudge toward the discounted lanes (NUDGE).
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

// Appended to typed prompts while the promo is on. The system prompt stays untouched, so the cache survives the toggle.
export const NUDGE = `<og-promo-nudge>
OpenGateway deepseek is 90% off right now, and the quick category plus the explore and librarian agents run on it; every other category costs what it always does. Ignore this note unless this prompt asks for planning or implementing code work beyond a few-line change.
- Planning: before deciding, fan out explore (codebase) and librarian (docs, external code) agents in parallel and gather as much as they can find; prefer several narrow searches over one broad one.
- Implementation: split the work into independent lanes and run them through workflows (mass-ulw for dependency-ordered phases): one workflow per phase, several where lanes are independent; the workflow is one tool among the others, not the whole plan. Route every lane whose brief is explicit and self-contained (named files, numbered steps, a concrete success check) to category quick; keep design decisions and cross-cutting changes on the usual categories.
</og-promo-nudge>`

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
  pi.on("before_agent_start", (event: any) => {
    if (event?.preview === true || (event?.trigger ?? "prompt") !== "prompt") return undefined
    if (promoStatus(homedir()) === undefined) return undefined
    return { message: { customType: "og-promo-nudge", content: NUDGE, display: false } }
  })
  pi.on("session_shutdown", () => {
    stop()
    ctx = undefined
  })
}
