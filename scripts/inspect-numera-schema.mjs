// Read-only schema recovery. Never print tokens or copy deployment secrets.
import { mkdir, writeFile } from 'node:fs/promises'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) throw new Error('Restore SUPABASE_ACCESS_TOKEN through secure environment settings')
const query = `BEGIN READ ONLY;
SELECT json_build_object(
  'columns', (SELECT json_agg(c) FROM (SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'monitoring_%' ORDER BY table_name, ordinal_position) c),
  'constraints', (SELECT json_agg(c) FROM (SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text LIKE 'monitoring_%') c),
  'policies', (SELECT json_agg(p) FROM (SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'monitoring_%') p),
  'functions', (SELECT json_agg(f) FROM (SELECT p.proname, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE '%monitoring%' AND p.prokind = 'f') f),
  'triggers', (SELECT json_agg(t) FROM (SELECT tgrelid::regclass::text AS table_name, tgname, pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text LIKE 'monitoring_%') t),
  'rls', (SELECT json_agg(r) FROM (SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'monitoring_%') r),
  'migration_ledger', (SELECT json_agg(a) FROM numera_migrations.applied a)
) AS recovery_schema;
COMMIT;`
const response = await fetch('https://api.supabase.com/v1/projects/stvjblztwpohvatdalww/database/query', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
})
if (!response.ok) throw new Error(`Supabase schema inspection failed: HTTP ${response.status}`)
const data = await response.json()
await mkdir('/workspace/recovery-artifacts', { recursive: true })
await writeFile('/workspace/recovery-artifacts/numera-schema.json', JSON.stringify(data, null, 2), { mode: 0o600 })
console.log('Read-only schema inspection saved to /workspace/recovery-artifacts/numera-schema.json')
