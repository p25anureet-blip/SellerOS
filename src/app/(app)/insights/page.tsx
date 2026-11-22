import type { Metadata } from "next"
import { PricingCalculator } from "./pricing-calculator"

export const metadata: Metadata = { title: "Pricing" }

export default function PricingPage() {
  return <PricingCalculator />
}
