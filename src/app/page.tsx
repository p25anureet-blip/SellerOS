import Link from "next/link"
import { ArrowRightIcon, BoxIcon, SparklesIcon, StoreIcon, TrendingUpIcon } from "lucide-react"
import { Logo } from "@/components/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"

const FEATURES = [
  {
    icon: BoxIcon,
    title: "One product catalogue",
    body: "Products, variants and category-specific attributes in a single source of truth.",
  },
  {
    icon: SparklesIcon,
    title: "AI from product videos",
    body: "Gemini watches your product video and suggests attributes for you to approve.",
  },
  {
    icon: StoreIcon,
    title: "Every channel's format",
    body: "Map attributes to Amazon, Flipkart, Blinkit and more, and export ready-to-upload files.",
  },
  {
    icon: TrendingUpIcon,
    title: "Decisions backed by maths",
    body: "Price and stock-allocation recommendations computed from your sales data.",
  },
]

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild className="hidden sm:inline-flex">
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 pt-16 pb-12 text-center sm:px-6 sm:pt-24">
          <p className="mx-auto mb-4 w-fit rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            Built for Indian e-commerce &amp; quick-commerce sellers
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Your products, every marketplace,{" "}
            <span className="text-primary">one operating system.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-muted-foreground">
            SellerOS keeps your product information in one place, uses AI to fill in the details,
            and prepares listings, prices and stock for each channel you sell on.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/signup">
                Create free workspace <ArrowRightIcon />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">Log in</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-24 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border bg-card p-6 shadow-xs">
              <span className="mb-4 flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Icon className="size-5" />
              </span>
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        SellerOS: a college project demonstration.
      </footer>
    </div>
  )
}
