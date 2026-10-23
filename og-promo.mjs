#!/usr/bin/env node
// og-promo: the "promo profile" for ~/.omo/omo.jsonc. While OpenGateway's price schedule gives
// deepseek-v4.1-flash-ultrafast at least 90% off, the opengateway rung leads the root [native]
// quick / explore / librarian chains; otherwise those lanes are left on base (rung removed).
// A running OMO session cannot switch OMO_PROFILE, so the profile is applied to the root layer,
// and senpi's config-reload picks the change up once each session is idle.
//
// Usage: node og-promo.mjs [--dry-run] [--config <omo.jsonc>] [--prices <fixture.json>]
//                          [--now <iso>] [--state <state.json>] [--log <log file>]
import { appendFileSync, copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { isDeepStrictEqual, parseArgs } from "node:util"

const HOME = homedir()
const DIR = join(HOME, ".omo", "og-promo")
const PRICES_URL = "https://opengateway.ai/api/model-prices"
const PRICE_MODEL = "deepseek-v4.1-flash-ultrafast"
const MODEL = "opengateway/deepseek/deepseek-v4.1-flash-ultrafast"
const MIN_DISCOUNT = 0.9
// The profile is dropped when the 90% window ends within this lead; hourly checks run at :50 and :01.
const LEAD_MS = 15 * 60_000
// Agent chains skip a string rung with a ":low" suffix (OMO 5.1.10), so they carry the object form.
const LANES = [
  { path: ["[native]", "categories", "quick", "models"], rung: `${MODEL}:low` },
  { path: ["[native]", "agents", "explore", "models"], rung: { model: MODEL, variant: "low" } },
  { path: ["[native]", "agents", "librarian", "models"], rung: { model: MODEL, variant: "low" } },
]

const { values: opts } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    config: { type: "string", default: join(HOME, ".omo", "omo.jsonc") },
    prices: { type: "string" },
    now: { type: "string" },
    state: { type: "string", default: join(DIR, "state.json") },
    log: { type: "string", default: join(DIR, "og-promo.log") },
    extension: { type: "string" },
  },
})

// routing.ts moved from the extensions dir into the omo-routing package (2026-10-16); try the package first.
const ROUTING = opts.extension
  ? [opts.extension]
  : [
      join(HOME, ".omo", "agent", "git", "github.com", "yjacket", "omo-routing", "extension", "routing.ts"),
      join(HOME, ".omo", "agent", "extensions", "routing.ts"),
    ]
const routingPath = ROUTING.find((p) => existsSync(p))
if (!routingPath) {
  log({ error: `routing.ts not found: ${ROUTING.join(", ")}` })
  process.exit(1)
}
const { parseJsonc, parseJsoncTree } = await import(pathToFileURL(routingPath).href)

const isRung = (x) => (typeof x === "string" ? x.split(":")[0] === MODEL : x?.model === MODEL)
const rungText = (rung) =>
  typeof rung === "string"
    ? JSON.stringify(rung)
    : `{ ${Object.entries(rung).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`
const getPath = (obj, path) => path.reduce((cur, key) => (cur && typeof cur === "object" ? cur[key] : undefined), obj)

/** Fraction off the list price, the smaller of the input and output discounts. */
function discountOf(entry, price) {
  const pairs = [
    [entry.inputCostPerToken, price?.inputCostPerToken],
    [entry.outputCostPerToken, price?.outputCostPerToken],
  ]
  if (!pairs.every(([list, eff]) => list > 0 && typeof eff === "number")) return 0
  return Math.min(...pairs.map(([list, eff]) => 1 - eff / list))
}

const isPromo = (discount) => discount >= MIN_DISCOUNT - 1e-6

async function fetchSchedule() {
  let body, serverTime
  if (opts.prices) {
    const fixture = JSON.parse(readFileSync(opts.prices, "utf8"))
    body = fixture.prices
    serverTime = fixture.serverTime
  } else {
    let lastError
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(PRICES_URL, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "og-promo" } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        serverTime = res.headers.get("X-Model-Price-Server-Time") ?? undefined
        body = await res.json()
        break
      } catch (error) {
        lastError = error
        await new Promise((resolve) => setTimeout(resolve, 5_000))
      }
    }
    if (!body) throw lastError
  }
  // Since 2026-10-23 the models sit under `entries` ({ priceVersion, generatedAt, currency, unit, entries }).
  const entry = Object.values(body.entries ?? body).find((e) => e?.modelName === PRICE_MODEL)
  if (!entry) throw new Error(`${PRICE_MODEL} is not in the price list`)
  const pricing = entry.pricing ?? {}
  const nextAt = pricing.next?.at ? Date.parse(pricing.next.at) : null
  return {
    fetchedAt: Date.parse(serverTime ?? "") || Date.now(),
    discountNow: discountOf(entry, pricing.current?.effectivePrice),
    nextAt: Number.isFinite(nextAt) ? nextAt : null,
    discountNext: pricing.next ? discountOf(entry, pricing.next.effectivePrice) : null,
  }
}

/** On only inside a 90% window that still has more than LEAD_MS to run at `now`. */
function wantPromo(schedule, now) {
  if (schedule.nextAt !== null && now >= schedule.nextAt) return false // past the last known change: unknown, stay on base
  if (!isPromo(schedule.discountNow)) return false
  if (schedule.nextAt === null || isPromo(schedule.discountNext ?? 0)) return true
  return schedule.nextAt - now > LEAD_MS
}

/** Text of the JSONC array at `path` split into lines, with the array's offsets. */
function arrayAt(text, path) {
  let node = parseJsoncTree(text)
  for (const key of path) node = node?.members?.find((m) => m.key === key)?.value
  return node?.kind === "array" ? node : undefined
}

/** Put the rung first (on) or drop every rung (off) in one lane, one element per line. */
function editLane(text, lane, on) {
  const node = arrayAt(text, lane.path)
  if (!node) return text
  const chain = getPath(parseJsonc(text), lane.path)
  const present = chain.some(isRung)
  if (on === present) return text
  const body = text.slice(node.start, node.end)
  if (!body.includes("\n")) throw new Error(`${lane.path.join(".")} is written on one line; edit it by hand`)
  const lines = body.split("\n")
  if (on) {
    const indent = lines[1]?.match(/^[ \t]*/)?.[0] ?? ""
    const sep = chain.length ? "," : ""
    lines.splice(1, 0, `${indent}${rungText(lane.rung)}${sep}`)
  } else {
    for (let i = lines.length - 2; i >= 1; i--) {
      const element = lines[i].trim().replace(/,$/, "")
      let value
      try { value = JSON.parse(element) } catch { continue }
      if (!isRung(value)) continue
      const hadComma = lines[i].trimEnd().endsWith(",")
      lines.splice(i, 1)
      if (!hadComma && i > 1) lines[i - 1] = lines[i - 1].replace(/,(\s*)$/, "$1")
    }
  }
  return text.slice(0, node.start) + lines.join("\n") + text.slice(node.end)
}

function expectedConfig(config, on) {
  const next = structuredClone(config)
  for (const lane of LANES) {
    const parent = getPath(next, lane.path.slice(0, -1))
    const chain = parent?.[lane.path.at(-1)]
    if (!Array.isArray(chain)) continue
    if (on && !chain.some(isRung)) parent[lane.path.at(-1)] = [lane.rung, ...chain]
    if (!on) parent[lane.path.at(-1)] = chain.filter((x) => !isRung(x))
  }
  return next
}

function stateOf(config) {
  const lanes = LANES.filter((lane) => Array.isArray(getPath(config, lane.path)))
  const on = lanes.filter((lane) => getPath(config, lane.path).some(isRung)).length
  return on === 0 ? "base" : on === lanes.length ? "promo" : "mixed"
}

function writeAtomically(path, text) {
  const tmp = `${path}.og-promo.tmp`
  writeFileSync(tmp, text, "utf8")
  for (let attempt = 0; ; attempt++) {
    try { renameSync(tmp, path); return } catch (error) {
      if (attempt >= 4 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
    }
  }
}

function log(record) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record })
  console.log(line)
  if (opts["dry-run"]) return
  appendFileSync(opts.log, line + "\n", "utf8")
  const lines = readFileSync(opts.log, "utf8").split("\n").filter(Boolean)
  if (lines.length > 2000) writeFileSync(opts.log, lines.slice(-1000).join("\n") + "\n", "utf8")
}

async function main() {
  let schedule
  let source = "api"
  try {
    schedule = await fetchSchedule()
    if (!opts["dry-run"]) writeFileSync(opts.state, JSON.stringify(schedule, null, 2) + "\n", "utf8")
  } catch (error) {
    source = `state (fetch failed: ${error.message})`
    try { schedule = JSON.parse(readFileSync(opts.state, "utf8")) } catch { schedule = undefined }
  }
  const now = opts.now ? Date.parse(opts.now) : source === "api" ? schedule.fetchedAt : Date.now()
  const on = schedule ? wantPromo(schedule, now) : false

  const text = readFileSync(opts.config, "utf8")
  const config = parseJsonc(text)
  const before = stateOf(config)
  let next = text
  for (const lane of LANES) next = editLane(next, lane, on)
  if (!isDeepStrictEqual(parseJsonc(next), expectedConfig(config, on))) throw new Error("edited omo.jsonc does not match the intended chains; nothing written")
  const after = stateOf(parseJsonc(next))
  const changed = next !== text
  if (changed && !opts["dry-run"]) {
    if (readFileSync(opts.config, "utf8") !== text) throw new Error("omo.jsonc changed during the run; nothing written")
    copyFileSync(opts.config, join(dirname(opts.state), "omo.jsonc.before-switch"))
    writeAtomically(opts.config, next)
  }
  log({
    want: on ? "promo" : "base", before, after, changed, dryRun: opts["dry-run"], source,
    now: new Date(now).toISOString(),
    discountNow: schedule ? Number(schedule.discountNow.toFixed(3)) : null,
    nextAt: schedule?.nextAt ? new Date(schedule.nextAt).toISOString() : null,
    discountNext: schedule?.discountNext == null ? null : Number(schedule.discountNext.toFixed(3)),
  })
}

main().catch((error) => {
  log({ error: error.message })
  process.exitCode = 1
})
