import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/layout/page-header"
import { findNavItem } from "@/components/layout/nav-items"

/** Placeholder page for a section that a later roadmap phase builds. */
export function ComingSoon({ href, features }: { href: string; features: string[] }) {
  const item = findNavItem(href)
  const Icon = item.icon

  return (
    <div className="space-y-6">
      <PageHeader title={item.label} description={item.description} />
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Icon className="size-6" />
          </span>
          <div className="space-y-2">
            <Badge variant="secondary">Arriving in Phase {item.phase}</Badge>
            <h2 className="text-lg font-semibold">This section is on the roadmap</h2>
          </div>
          <ul className="grid max-w-md gap-1.5 text-left text-sm text-muted-foreground">
            {features.map((feature) => (
              <li key={feature} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" />
                {feature}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
