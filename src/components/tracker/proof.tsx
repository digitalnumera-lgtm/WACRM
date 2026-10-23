'use client'

import { useState } from 'react'
import { ExternalLink, Paperclip } from 'lucide-react'
import { buttonClass } from '@/components/monitoring/ui'
import { Modal } from './tracker-edit'

/**
 * Payment proof stays in Google Drive: this only shows Drive's own preview.
 * The viewer needs to be signed in to a Google account that can open the file.
 */
export function ProofButton({ ids, label = 'Proof', compact }: { ids: string[]; label?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  if (!ids.length) return null
  const id = ids[Math.min(index, ids.length - 1)]
  return <>
    <button type="button" onClick={e => { e.stopPropagation(); setIndex(0); setOpen(true) }} title="See proof"
      className={compact ? 'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground' : buttonClass}>
      <Paperclip size={compact ? 12 : 14} />{label}{ids.length > 1 ? ` (${ids.length})` : ''}
    </button>
    {open && <Modal title={label} onClose={() => setOpen(false)} wide>
      <div className="space-y-3" onClick={e => e.stopPropagation()}>
        {ids.length > 1 && <div className="flex gap-1">{ids.map((_, i) => <button key={i} className={`rounded-full px-3 py-1 text-sm ${i === index ? 'bg-primary text-primary-foreground' : 'bg-muted'}`} onClick={() => setIndex(i)}>File {i + 1}</button>)}</div>}
        <iframe key={id} src={`https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`} title="Proof preview" className="h-[65dvh] w-full rounded-2xl border border-border bg-muted" allow="autoplay" referrerPolicy="no-referrer" />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Kept in Google Drive. Blank? Sign in to the Google account that owns the forms.</span>
          <a className={buttonClass} href={`https://drive.google.com/file/d/${encodeURIComponent(id)}/view`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Open in Drive</a>
        </div>
      </div>
    </Modal>}
  </>
}
