import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Static safety net for every migration, present and future: a table in the
 * public schema without Row Level Security would be readable by any signed-in
 * user through the Supabase API.
 */

const dir = join(process.cwd(), "supabase", "migrations")
const files = readdirSync(dir).filter((file) => file.endsWith(".sql"))
const sql = files.map((file) => readFileSync(join(dir, file), "utf8")).join("\n")

const created = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(
  (match) => match[1],
)
const secured = new Set(
  [...sql.matchAll(/alter table public\.(\w+) enable row level security/gi)].map(
    (match) => match[1],
  ),
)

describe("database migrations", () => {
  it("are named <timestamp>_<description>.sql", () => {
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/)
  })

  it.each(created)("enable row level security on public.%s", (table) => {
    expect(secured.has(table)).toBe(true)
  })

  it("pin search_path on every SECURITY DEFINER function", () => {
    const definers = [...sql.matchAll(/create or replace function[\s\S]*?\$\$;/gi)]
      .map((match) => match[0])
      .filter((body) => /security definer/i.test(body))
    expect(definers.length).toBeGreaterThan(0)
    for (const body of definers) expect(body).toMatch(/set search_path = ''/i)
  })
})
