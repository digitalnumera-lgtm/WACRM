import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IntlProvider } from "@/components/intl-provider";
import { Funnel_Display, Funnel_Sans } from "next/font/google";

// Auth pages are never indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
};

const sans = Funnel_Sans({ subsets: ["latin"], variable: "--font-funnel-sans", display: "swap" });
const display = Funnel_Display({ subsets: ["latin"], variable: "--font-funnel-display", weight: ["500", "600", "700"], display: "swap" });

function Bubble({ from, children, time }: { from: "customer" | "agent"; children: ReactNode; time: string }) {
  const agent = from === "agent";
  return <div className={`flex ${agent ? "justify-end" : "justify-start"}`}>
    <div className={`max-w-[80%] rounded-3xl px-4 py-2.5 text-[15px] leading-snug ${agent ? "rounded-br-lg bg-[#C0DD11] text-[#121316]" : "rounded-bl-lg bg-white text-[#121316]"}`}>
      {children}<span className="ml-2 align-bottom text-[11px] opacity-50">{time}</span>
    </div>
  </div>;
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className={`numera-auth ${sans.variable} ${display.variable} grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]`}>
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#121316] p-12 text-[#F3F3EE] lg:flex">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static brand file */}
      <div className="flex items-center gap-3"><img src="/brand/numera-logo-white.png" alt="Numera Digital" width={1200} height={347} className="h-10 w-auto" /><span className="rounded-full bg-[#C0DD11] px-2.5 py-0.5 text-xs font-semibold text-[#121316]">CRM</span></div>
      <div className="max-w-lg">
        <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight">Every WhatsApp chat your team has, in one place.</h1>
        <p className="mt-5 max-w-md text-lg leading-relaxed text-[#F3F3EE]/70">See who is waiting for a reply, review chats and voice notes, and track how fast each agent answers.</p>
        <div className="mt-10 space-y-2.5 rounded-[28px] border border-white/10 bg-white/[0.04] p-5" aria-hidden="true">
          <Bubble from="customer" time="4:12 pm">Is the 3-bedroom still available?</Bubble>
          <Bubble from="agent" time="4:14 pm">Yes! Would Saturday at 4 work for a visit?</Bubble>
          <p className="flex items-center gap-2 pt-1 text-xs text-[#F3F3EE]/60"><span className="size-2 rounded-full bg-[#C0DD11]" />Ahmad replied in 2 minutes</p>
        </div>
      </div>
      <p className="text-sm text-[#F3F3EE]/40">Numera Digital</p>
    </aside>
    <main className="flex min-w-0 flex-col">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static brand file */}
      <div className="flex items-center gap-2.5 px-6 pt-6 lg:hidden"><img src="/brand/numera-logo.png" alt="Numera Digital" width={1200} height={347} className="h-8 w-auto" /><span className="rounded-full bg-[#121316] px-2 py-0.5 text-[11px] font-semibold text-[#C0DD11]">CRM</span></div>
      <div className="flex-1"><IntlProvider only={["LoginPage", "SignupPage", "ForgotPasswordPage", "ResetPasswordPage", "Common"]}>{children}</IntlProvider></div>
    </main>
  </div>;
}
