import { IntlProvider } from "@/components/intl-provider";
import Link from 'next/link'

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background px-5 py-12 text-foreground">
    <div className="mx-auto max-w-3xl">
      <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-primary">Numera Digital</p>
      <nav aria-label="Policy pages" className="mb-10 flex flex-wrap gap-5 text-sm underline underline-offset-4">
        <Link href="/privacy">Privacy policy</Link>
        <Link href="/data-deletion">Data deletion requests</Link>
      </nav>
      <article className="space-y-6 text-base leading-7 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_a]:underline [&_a]:underline-offset-4 [&_li]:ml-5 [&_ul]:list-disc">
        <IntlProvider>{children}</IntlProvider>
      </article>
      <footer className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">Contact: <a className="underline" href="mailto:digitalnumera@gmail.com">digitalnumera@gmail.com</a></footer>
    </div>
  </main>
}
