/**
 * CSV writer (RFC 4180). Fields containing commas, quotes or line breaks are
 * quoted and quotes are doubled. Values that spreadsheet apps would execute as
 * formulas (=, +, -, @ at the start) are prefixed with ' to prevent CSV
 * injection when the file is opened in Excel.
 */

export type CsvValue = string | number | null | undefined

export function escapeCsvField(value: CsvValue): string {
  if (value === null || value === undefined) return ""
  let text = typeof value === "number" ? formatNumber(value) : value
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

export function toCsv(headers: string[], rows: Record<string, CsvValue>[]): string {
  const lines = [headers.map(escapeCsvField).join(",")]
  for (const row of rows) lines.push(headers.map((header) => escapeCsvField(row[header])).join(","))
  return lines.join("\r\n") + "\r\n"
}

/** Triggers a browser download. The BOM makes Excel read ₹ and Hindi text as UTF-8. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
