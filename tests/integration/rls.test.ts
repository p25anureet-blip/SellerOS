import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  PERMISSION_DENIED,
  adminClient,
  anonClient,
  createTestUser,
  deleteTestUsers,
  type Client,
  type TestUser,
} from "./helpers"

/**
 * Proves the Phase 0 security model against the real hosted database:
 *   - Alice and Bob each own a separate organization.
 *   - Carol is a plain "member" of Alice's organization.
 * Every query below goes through the public API as that user, exactly like the app.
 */

let admin: Client
let alice: TestUser
let bob: TestUser
let carol: TestUser

beforeAll(async () => {
  admin = adminClient()
  alice = await createTestUser(admin, "alice")
  bob = await createTestUser(admin, "bob")
  carol = await createTestUser(admin, "carol")

  const { error } = await admin
    .from("organization_members")
    .insert({ organization_id: alice.organizationId, user_id: carol.id, role: "member" })
  if (error) throw new Error(`Could not add Carol to Alice's org: ${error.message}`)
})

afterAll(async () => {
  await deleteTestUsers(admin, [alice, bob, carol])
})

describe("sign-up trigger", () => {
  it("creates a profile, an organization and an owner membership", async () => {
    const [{ data: profile }, { data: org }, { data: membership }] = await Promise.all([
      admin.from("profiles").select("full_name").eq("id", alice.id).single(),
      admin
        .from("organizations")
        .select("name, created_by, currency")
        .eq("id", alice.organizationId)
        .single(),
      admin
        .from("organization_members")
        .select("role")
        .eq("user_id", alice.id)
        .eq("organization_id", alice.organizationId)
        .single(),
    ])
    expect(profile?.full_name).toBe("Test User ALICE")
    expect(org).toMatchObject({ name: "Org alice", created_by: alice.id, currency: "INR" })
    expect(membership?.role).toBe("owner")
  })
})

describe("tenant isolation (reads)", () => {
  it("shows a user only their own organization", async () => {
    const { data, error } = await bob.client.from("organizations").select("id")
    expect(error).toBeNull()
    expect(data?.map((row) => row.id)).toEqual([bob.organizationId])
  })

  it("hides another organization even when asked for it by id", async () => {
    const { data, error } = await bob.client
      .from("organizations")
      .select("id")
      .eq("id", alice.organizationId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("shows memberships of the user's own organizations only", async () => {
    const { data } = await alice.client
      .from("organization_members")
      .select("organization_id, user_id")
    expect(data?.length).toBe(2) // Alice (owner) + Carol (member)
    expect(data?.every((row) => row.organization_id === alice.organizationId)).toBe(true)

    const { data: bobSees } = await bob.client.from("organization_members").select("user_id")
    expect(bobSees?.map((row) => row.user_id)).toEqual([bob.id])
  })

  it("shows a user only their own profile", async () => {
    const { data } = await alice.client.from("profiles").select("id")
    expect(data?.map((row) => row.id)).toEqual([alice.id])
  })

  it("answers is_org_member() truthfully for the caller only", async () => {
    const own = await alice.client.rpc("is_org_member", { org_id: alice.organizationId })
    const other = await alice.client.rpc("is_org_member", { org_id: bob.organizationId })
    expect(own.data).toBe(true)
    expect(other.data).toBe(false)
  })
})

describe("tenant isolation (writes)", () => {
  it("lets an owner rename their organization and set a GSTIN", async () => {
    const { data, error } = await alice.client
      .from("organizations")
      .update({ name: "Alice Traders", gstin: "27AAPFU0939F1ZV" })
      .eq("id", alice.organizationId)
      .select("name, gstin")
    expect(error).toBeNull()
    expect(data).toEqual([{ name: "Alice Traders", gstin: "27AAPFU0939F1ZV" }])
  })

  it("silently refuses to update another organization", async () => {
    const { data, error } = await bob.client
      .from("organizations")
      .update({ name: "Hacked by Bob" })
      .eq("id", alice.organizationId)
      .select("id")
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: unchanged } = await admin
      .from("organizations")
      .select("name")
      .eq("id", alice.organizationId)
      .single()
    expect(unchanged?.name).not.toBe("Hacked by Bob")
  })

  it("does not let a plain member edit the organization they can see", async () => {
    const { data: visible } = await carol.client
      .from("organizations")
      .select("id")
      .eq("id", alice.organizationId)
    expect(visible).toHaveLength(1)

    const { data } = await carol.client
      .from("organizations")
      .update({ name: "Renamed by Carol" })
      .eq("id", alice.organizationId)
      .select("id")
    expect(data).toEqual([])
  })

  it("blocks changes to protected columns", async () => {
    const { error } = await alice.client
      .from("organizations")
      .update({ created_by: bob.id })
      .eq("id", alice.organizationId)
    expect(error?.code).toBe(PERMISSION_DENIED)
  })

  it("enforces the GSTIN format in the database itself", async () => {
    const { error } = await alice.client
      .from("organizations")
      .update({ gstin: "NOT-A-GSTIN" })
      .eq("id", alice.organizationId)
    expect(error?.code).toBe("23514") // check_violation
  })

  it("blocks creating organizations directly", async () => {
    const { error } = await alice.client.from("organizations").insert({ name: "Shadow org" })
    expect(error?.code).toBe(PERMISSION_DENIED)
  })

  it("blocks deleting an organization", async () => {
    const { error } = await alice.client
      .from("organizations")
      .delete()
      .eq("id", alice.organizationId)
    expect(error?.code).toBe(PERMISSION_DENIED)
  })

  it("blocks joining another organization", async () => {
    const { error } = await bob.client
      .from("organization_members")
      .insert({ organization_id: alice.organizationId, user_id: bob.id, role: "owner" })
    expect(error?.code).toBe(PERMISSION_DENIED)
  })

  it("blocks a member from promoting themselves", async () => {
    const { error } = await carol.client
      .from("organization_members")
      .update({ role: "owner" })
      .eq("user_id", carol.id)
    expect(error?.code).toBe(PERMISSION_DENIED)
  })

  it("blocks editing someone else's profile", async () => {
    const { data } = await bob.client
      .from("profiles")
      .update({ full_name: "Renamed by Bob" })
      .eq("id", alice.id)
      .select("id")
    expect(data).toEqual([])
  })
})

describe("marketplace reference data", () => {
  it("is readable by signed-in users", async () => {
    const { data, error } = await alice.client.from("marketplaces").select("code, channel_type")
    expect(error).toBeNull()
    expect(data?.map((row) => row.code).sort()).toEqual([
      "amazon_in",
      "blinkit",
      "flipkart",
      "meesho",
      "myntra",
      "swiggy_instamart",
      "zepto",
    ])
  })

  it("cannot be changed by users", async () => {
    const { error } = await alice.client
      .from("marketplaces")
      .update({ commission_pct: 0 })
      .eq("code", "amazon_in")
    expect(error?.code).toBe(PERMISSION_DENIED)
  })
})

describe("logged-out visitors", () => {
  const anon = () => anonClient()

  it.each(["organizations", "organization_members", "profiles", "marketplaces"] as const)(
    "cannot read %s",
    async (table) => {
      const { data, error } = await anon().from(table).select("*")
      // Either outright denial or zero rows is acceptable; leaked rows are not.
      if (error) expect(error.code).toBe(PERMISSION_DENIED)
      else expect(data).toEqual([])
    },
  )

  it("cannot call the authorization helpers", async () => {
    const { error } = await anon().rpc("is_org_member", { org_id: alice.organizationId })
    expect(error).not.toBeNull()
  })
})
