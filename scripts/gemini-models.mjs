// Lists the Gemini models your GEMINI_API_KEY can call with generateContent,
// using the official @google/genai SDK. Run: npm run gemini:models
// The API key is read from .env.local and never printed.
import { GoogleGenAI } from "@google/genai"

try {
  process.loadEnvFile(".env.local")
} catch {
  // Fall back to variables already in the environment.
}
const apiKey = process.env.GEMINI_API_KEY?.trim()
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set in .env.local.")
  process.exit(1)
}
const configured = process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest"
const ai = new GoogleGenAI({ apiKey })

const models = []
try {
  const pager = await ai.models.list({ config: { pageSize: 100 } })
  for await (const model of pager) {
    if (model.supportedActions?.includes("generateContent")) models.push(model)
  }
} catch (error) {
  const message = String(error?.message ?? error)
    .split(apiKey)
    .join("[REDACTED]")
  console.error("Could not list models:", message.slice(0, 300))
  process.exit(1)
}

models.sort((a, b) => a.name.localeCompare(b.name))
console.log(`${models.length} models support generateContent for this key:\n`)
for (const model of models) {
  const id = model.name.replace(/^models\//, "")
  const mark = id === configured ? "  <- GEMINI_MODEL" : ""
  console.log(`  ${id.padEnd(42)} ${model.displayName ?? ""}${mark}`)
}
if (!models.some((model) => model.name === `models/${configured}`)) {
  console.log(`\nWarning: the configured model "${configured}" is not in this list.`)
}
