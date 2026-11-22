import type { Metadata } from "next"
import { AiProductAgent } from "./ai-product-agent"

export const metadata: Metadata = { title: "AI Product Agent" }

export default function AiAgentPage() {
  return <AiProductAgent />
}
