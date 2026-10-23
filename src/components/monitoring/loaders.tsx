'use client'

// Loading animations adapted from loading-ui (https://www.loading-ui.com, MIT, © 2026 Bartosz Zagrodzki).
// Each screen gets the one that suits it; all are CSS-only except the morphing infinity and the shimmer text.
import { m } from 'motion/react'
import { cn } from '@/lib/utils'

type SpanProps = React.ComponentProps<'span'>

/** Three dots bouncing like someone typing: chats and conversations. */
export function Typing({ className, dots = 3, ...props }: SpanProps & { dots?: number }) {
  return <span role="status" className={cn('inline-flex items-center gap-[12%]', className)} {...props}>
    {Array.from({ length: dots }, (_, i) => <span key={i} aria-hidden="true" className="inline-block aspect-square grow rounded-full bg-current" style={{ animation: 'loading-ui-typing var(--duration, 1s) infinite', animationDelay: `calc(var(--delay, 160ms) * ${i})` }} />)}
    <span className="sr-only">Loading</span>
  </span>
}

/** Bars rising and falling like a live chart: dashboard and reports. */
export function Bars({ className, bars = 4, ...props }: SpanProps & { bars?: number }) {
  return <span role="status" className={cn('inline-flex items-stretch gap-[8%]', className)} {...props}>
    {Array.from({ length: bars }, (_, i) => <span key={i} aria-hidden="true" className="inline-block h-full rounded-[2px] bg-current" style={{ width: `${100 / bars}%`, animation: 'loading-ui-wave-bars var(--duration, 1.2s) ease-in-out infinite', animationDelay: `calc(var(--delay, 0.2s) * ${i})` }} />)}
    <span className="sr-only">Loading</span>
  </span>
}

/** A ring with a sweeping arc: the whole app while it opens. */
export function OrbitRing({ className, ...props }: SpanProps) {
  return <span role="status" className={cn('relative inline-block', className)} style={{ animation: 'loading-ui-orbit-ring-rotation var(--duration, 1s) linear infinite' }} {...props}>
    <span aria-hidden="true" className="absolute inset-0 rounded-full border-2 border-current" style={{ opacity: 0.25 }} />
    <span aria-hidden="true" className="absolute top-1/2 left-1/2 rounded-full border-2 border-transparent border-b-current" style={{ width: '116.667%', height: '116.667%', transform: 'translate(-50%, -50%)' }} />
    <span className="sr-only">Loading</span>
  </span>
}

/** A ring of dots lighting up in turn: settings, contacts, leads, help. */
export function DotsRing({ className, dots = 8, ...props }: SpanProps & { dots?: number }) {
  const scale = 0.2, radius = 0.34
  return <span role="status" className={cn('relative inline-flex aspect-square items-center justify-center [container-type:size]', className)} {...props}>
    <span aria-hidden="true" className="relative block size-full">
      {Array.from({ length: dots }, (_, i) => {
        const angle = (i / dots) * Math.PI * 2
        const x = `${(Math.sin(angle) * radius * 100).toFixed(2)}cqmin`, y = `${(-Math.cos(angle) * radius * 100).toFixed(2)}cqmin`
        return <span key={i} className="absolute top-1/2 left-1/2" style={{ width: `${scale * 100}cqmin`, height: `${scale * 100}cqmin`, transform: `translate(-50%, -50%) translate(${x}, ${y})` }}>
          <span className="block size-full rounded-full bg-current" style={{ animation: 'loading-ui-dots-ring-pulse var(--duration, 1s) linear infinite', animationDelay: `calc(var(--duration, 1s) / ${dots} * ${i - dots})` }} />
        </span>
      })}
    </span>
    <span className="sr-only">Loading</span>
  </span>
}

const circleA = 'M 12 8 C 14.21 8 16 9.79 16 12 C 16 14.21 14.21 16 12 16 C 9.79 16 8 14.21 8 12 C 8 9.79 9.79 8 12 8 Z'
const infinity = 'M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z'
const circleB = 'M 12 16 C 14.21 16 16 14.21 16 12 C 16 9.79 14.21 8 12 8 C 9.79 8 8 9.79 8 12 C 8 14.21 9.79 16 12 16 Z'

/** A circle that flows into an infinity sign and back: Clients (money keeps moving). */
export function MorphingInfinity(props: React.ComponentProps<'svg'>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" role="status" aria-label="Loading" {...props}>
    <m.path d={circleA} animate={{ d: [circleA, infinity, circleB, infinity, circleA] }} transition={{ d: { duration: 5, ease: 'easeInOut', repeat: Infinity, times: [0, 0.25, 0.5, 0.75, 1] } }} />
  </svg>
}

const PICTURE = 'M6.8 21H17.2C18.8802 21 19.7202 21 20.362 20.673C20.9265 20.3854 21.3854 19.9265 21.673 19.362C22 18.7202 22 17.8802 22 16.2V7.8C22 6.11984 22 5.27976 21.673 4.63803C21.3854 4.07354 20.9265 3.6146 20.362 3.32698C19.7202 3 18.8802 3 17.2 3H6.8C5.11984 3 4.27976 3 3.63803 3.32698C3.07354 3.6146 2.6146 4.07354 2.32698 4.63803C2 5.27976 2 6.11984 2 7.8V16.2C2 17.8802 2 18.7202 2.32698 19.362C2.6146 19.9265 3.07354 20.3854 3.63803 20.673C4.27976 21 5.11984 21 6.8 21Z'
const SCENE = 'M4.27209 20.7279L10.8686 14.1314C11.2646 13.7354 11.4627 13.5373 11.691 13.4632C11.8918 13.3979 12.1082 13.3979 12.309 13.4632C12.5373 13.5373 12.7354 13.7354 13.1314 14.1314L19.6839 20.6839M14 15L16.8686 12.1314C17.2646 11.7354 17.4627 11.5373 17.691 11.4632C17.8918 11.3979 18.1082 11.3979 18.309 11.4632C18.5373 11.5373 18.7354 11.7354 19.1314 12.1314L22 15M10 9C10 10.1046 9.10457 11 8 11C6.89543 11 6 10.1046 6 9C6 7.89543 6.89543 7 8 7C9.10457 7 10 7.89543 10 9Z'
const scan = { duration: 2.5, ease: [0.175, 0.885, 0.32, 1] as [number, number, number, number], times: [0, 0.6, 0.6, 1], repeat: Infinity, repeatType: 'mirror' as const, repeatDelay: 0.2 }

/** A picture being scanned: the media library. */
export function AnalyzingImage({ className }: { className?: string }) {
  return <div role="status" aria-label="Loading media" className={cn('relative isolate shrink-0', className)}>
    <m.div initial={{ clipPath: 'inset(0% 0% 0% 0%)' }} animate={{ clipPath: ['inset(0% 0% 0% 0%)', 'inset(0% 105% 0% 0%)', 'inset(0% 105% 0% 0%)', 'inset(0% 0% 0% 0%)'] }} transition={scan} className="absolute inset-0 z-10 bg-[var(--background)]">
      <svg viewBox="0 0 24 24" fill="none" className="size-full"><path d={`${SCENE}M${PICTURE.slice(1)}`} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </m.div>
    <m.div initial={{ transform: 'translateX(1400%)' }} animate={{ transform: ['translateX(1400%)', 'translateX(-80%)', 'translateX(-80%)', 'translateX(1400%)'] }} transition={scan} className="absolute z-10 h-full w-[7%] rounded-full bg-current" />
    <svg viewBox="0 0 24 24" fill="none" className="absolute inset-0 size-full"><path d={PICTURE} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M6 16h2M10 14h2M14 12h2M8 9h2M15 7h2M5 19h3M14 19h3" stroke="currentColor" strokeWidth="1" strokeDasharray="1 1" /></svg>
  </div>
}

/** Text with a light sweeping across it. */
export function TextShimmer({ children, className = '' }: { children: string; className?: string }) {
  return <m.span className={cn('relative inline-block bg-size-[250%_100%,auto] bg-clip-text [-webkit-text-fill-color:transparent] [background-repeat:no-repeat,padding-box]', className)}
    initial={{ backgroundPosition: '100% center' }} animate={{ backgroundPosition: '0% center' }} transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
    style={{ backgroundImage: `linear-gradient(90deg,#0000 calc(50% - ${children.length * 2}px),currentColor,#0000 calc(50% + ${children.length * 2}px)), linear-gradient(color-mix(in oklab, currentColor 45%, transparent), color-mix(in oklab, currentColor 45%, transparent))` }}>
    {children}
  </m.span>
}

export type LoaderKind = 'app' | 'chats' | 'chart' | 'clients' | 'media' | 'settings'

/** A loading screen for one area: the right animation, in the accent colour, with an optional line under it. */
export function ScreenLoader({ kind, label, className = '' }: { kind: LoaderKind; label?: string; className?: string }) {
  const art = { app: <OrbitRing className="size-10" />, chats: <Typing className="w-14" />, chart: <Bars className="h-10 w-12" />, clients: <MorphingInfinity className="size-16" />, media: <AnalyzingImage className="size-14" />, settings: <DotsRing className="size-10" /> }[kind]
  return <div className={cn('flex flex-col items-center justify-center gap-4 py-16 text-[var(--ink-accent,var(--primary))] dark:text-[var(--hl,var(--primary))]', className)}>
    {art}
    {label && <TextShimmer className="text-sm font-medium text-muted-foreground">{label}</TextShimmer>}
  </div>
}
