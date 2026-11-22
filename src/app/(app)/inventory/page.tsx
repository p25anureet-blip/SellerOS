import type { Metadata } from "next"
import { AllocationPlanner } from "./allocation-planner"

export const metadata: Metadata = { title: "Inventory" }

export default function InventoryPage() {
  return <AllocationPlanner />
}
