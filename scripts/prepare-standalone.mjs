import { cp, mkdir } from 'node:fs/promises'

// Next's standalone output deliberately omits these assets. Ship them beside
// server.js so a normal npm start serves the complete application.
await mkdir('.next/standalone/.next', { recursive: true })
await cp('.next/static', '.next/standalone/.next/static', { recursive: true, force: true })
await cp('public', '.next/standalone/public', { recursive: true, force: true })
