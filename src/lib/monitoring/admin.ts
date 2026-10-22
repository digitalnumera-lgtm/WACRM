import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// One service-role client per server process (it holds no user session).
let client: SupabaseClient | null = null

export function monitoringAdmin(): SupabaseClient {
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return client
}
