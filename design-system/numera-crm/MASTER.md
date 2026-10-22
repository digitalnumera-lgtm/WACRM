# Numera CRM design system (master)

Source of truth for the CRM workspace (`src/components/monitoring`) and sign-in pages.
Built from the Numera brand, the owner's reference designs, and UI UX Pro Max guidance
(product type "CRM & Client Management": flat + minimal/Swiss, soft UI, micro-interactions;
inbox pattern: clean white + brand primary + priority red + snooze amber).

## Tokens (globals.css → `.monitoring-panel`, `.numera-auth`)
| Role | Light | Dark |
|---|---|---|
| Canvas | `#F0F2EC` + soft radial tints | `#0D0E10` |
| Card | `#FFFFFF` | `#17181B` |
| Ink / primary | `#121316` | `#C0DD11` (lime) |
| Accent | Lime `#C0DD11` (unread badge, focus ring, active nav icon) | same |
| Muted text | `#6B7069` | `#A0A49C` |
| Border | `#E4E7E1` | `#2A2C31` |
| Agent bubble | ink on light | lime on dark |
| Charts | Received `#2A78D6` / Agent replies `#7F9A00` (dark: `#3987E5` / `#86A000`), validated for colour-vision deficiency |
| Status | red = waiting > 1h / urgent, amber = waiting / snoozed, green = done |

## Type
- Funnel Display: page titles, chat name, KPI numbers (`font-display`).
- Funnel Sans: everything else. Minimum 12px for any readable text; body 14px.
- Sentence case everywhere. No all-caps labels, no emoji as icons (Lucide only).

## Shape & spacing
- Radius hierarchy: cards 24px (`crm-card`), list rows / inputs 16px / 12px, chips & buttons full.
- Buttons 36px high (`h-9`), pill shaped; one primary (ink) action per area.
- 8px spacing grid; compact density reduces list row padding only.

## Behaviour
- Visible focus ring (lime), `cursor: pointer` on interactive elements, 150ms colour transitions,
  reduced motion respected.
- One way to do each thing: add/reconnect agent = Connect; mark handled = Done; pin = ⋮ menu.
- Technical tools live under Settings → Advanced and only for roles that manage numbers.
- A failing section shows a retry card instead of blanking the app (SectionBoundary).

## Pre-delivery checklist
Lint/tests/build pass · screenshots at 1440, 820 and 390 px · light and dark checked ·
no emoji icons · contrast ≥ 4.5:1 for text · touch targets ≥ 36px on desktop, 44px on phone nav.
