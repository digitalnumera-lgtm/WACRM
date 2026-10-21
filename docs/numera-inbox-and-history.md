# Numera waCRM — new inbox, Connect number and Meta history (release guide)

Prepared 21 October 2026. Branch: `work/numera-crm-handoff`. Nothing here is live until it is merged into `main` (Hostinger deploys `main` automatically).

## What this release adds

- **Chatwoot-style inbox:** full-screen three-panel layout; Open / Waiting / Unread / Snoozed / Resolved / All tabs with counts; filters (number, agent, lead stage, label, priority); newest/oldest sort; keyboard `j`/`k` and `/`.
- **Conversation actions:** Resolve/Reopen, Snooze, Mark unread, Priority. Opening a chat marks it reviewed in the CRM (never a WhatsApp read receipt).
- **Labels** (Settings → Labels) and **contact panel** (editable name/email/company/city/notes, the same customer's chats with other agents, lead history).
- **Private notes** shown inline in the chat; the composer is notes-only while management replies are switched off.
- **Waiting tab and agent performance report** (response times, unanswered chats, Pakistan-time activity heatmap).
- **Connect number:** Meta's Embedded Signup popup for WhatsApp Business app numbers (coexistence). The agent keeps using the phone app.
- **Meta history import:** contacts and up to 6 months of chats, requested automatically within Meta's 24-hour window, filed under original dates without showing as unread. Progress per number on Business numbers.
- **Permanent media storage:** images, voice notes, videos and documents are copied to a private Supabase Storage bucket after they arrive (and when first viewed) and served from there.

## Release steps (in order)

1. **Run the database update once.** Supabase → project `stvjblztwpohvatdalww` → SQL Editor → New query → paste the whole of `supabase/numera/001_inbox_workflow.sql` → Run. It only adds tables, one view and one private bucket; re-running is harmless. It was tested twice on a mock schema.
2. **Meta settings** (app `1121820883867005`):
   - Facebook Login for Business → Settings: JavaScript SDK login ON; allowed domain and valid OAuth redirect URI = the CRM's HTTPS address.
   - App settings → Basic → App domains: the CRM domain.
   - Webhooks subscribed: `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`.
   - Embedded Signup configuration ID `1502267518467039` (built into the code; override with `NEXT_PUBLIC_META_ES_CONFIG_ID` if a new configuration is created).
3. **Merge** `work/numera-crm-handoff` into `main` on GitHub and wait for the Hostinger build to show Completed/Current.
4. **Settings → Meta access:** paste the permanent system-user token, select all numbers, verify. This restores media loading.
5. **Test Connect number on one number first** (Business numbers → Connect a WhatsApp number). Approve on the phone and allow chat history. Watch the progress card. Confirm WabaCRM's state for that number before doing the rest.

## Important limits

- Meta shares history **once per connection** and only for the **last 180 days**; group chats are excluded.
- History media arrives as placeholders; Meta sends the files separately only for media from roughly the last 14 days. Placeholders read “WhatsApp did not share the file itself.”
- Each sync request is allowed once, within **24 hours** of connecting. A failed request can be retried from the progress card inside that window; afterwards the number must be reconnected.
- If the phone declines history sharing, the card says so (Meta error 2593109).
- Embedded Signup v2/v3 were deprecated by Meta on 15 October 2026; the configuration decides the version. The code sends `featureType: whatsapp_business_app_onboarding`; override all extras with `NEXT_PUBLIC_META_ES_EXTRAS` (JSON) if Meta changes them.
- Before the SQL update is run, the inbox falls back to the previous list and shows a notice; labels, tabs and contact details stay disabled.

## Where the code lives

| Area | Files |
| --- | --- |
| Inbox UI | `src/components/monitoring/{workspace,inbox-list,conversation,contact-panel,labels,ui}.tsx` |
| Connect popup / progress | `src/components/monitoring/connect-number.tsx` |
| Inbox APIs | `src/app/api/monitoring/{route,counts,labels,contacts/profile,threads/[id]/labels}` |
| Connect APIs | `src/app/api/monitoring/connect/{route,sync,status}` |
| History parsing / storing | `src/lib/monitoring/{history-sync,history-store,ingest}.ts` |
| Media archive | `src/lib/monitoring/media-archive.ts`, media route |
| Database update | `supabase/numera/001_inbox_workflow.sql` |
