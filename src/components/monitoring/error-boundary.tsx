'use client'

import { Component, type ReactNode } from 'react'

/** Keeps the rest of the CRM usable when one section fails to render. */
export class SectionBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(previous: { resetKey?: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return <div role="alert" className="crm-card flex flex-col items-start gap-3 p-6">
      <p className="font-medium">This section couldn’t load.</p>
      <p className="text-sm text-muted-foreground">The rest of the CRM still works. Try again, or refresh the page.</p>
      <button className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => this.setState({ failed: false })}>Try again</button>
    </div>
  }
}
