import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Atomic writes backed by the SQL functions in scripts/14_atomic_ops.sql.
 * Before that migration is applied, each helper falls back to the old
 * read-then-write path (warning once) so the app keeps working.
 */

let admin: SupabaseClient | null = null
function getAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || '')
  }
  return admin
}

const warned = new Set<string>()
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  // PGRST202: function not found in schema cache; 42883: undefined_function
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message || '')
}
function warnOnce(fn: string) {
  if (warned.has(fn)) return
  warned.add(fn)
  console.warn(`[atomic] SQL function ${fn} missing — run scripts/14_atomic_ops.sql. Using non-atomic fallback.`)
}

type Vars = Record<string, unknown>

/** Merges `patch` into email_recipients.variables. Returns the merged object. */
export async function mergeRecipientVariables(recipientId: string, patch: Vars): Promise<Vars> {
  const db = getAdmin()
  const { data, error } = await db.rpc('merge_recipient_variables', { p_recipient_id: recipientId, p_patch: patch })
  if (!error) return (data as Vars) || patch
  if (!isMissingFunction(error)) throw new Error(error.message)

  warnOnce('merge_recipient_variables')
  const { data: row } = await db.from('email_recipients').select('variables').eq('id', recipientId).single()
  const variables = { ...((row?.variables as Vars) || {}), ...patch }
  const { error: updateError } = await db
    .from('email_recipients')
    .update({ variables, updated_at: new Date().toISOString() })
    .eq('id', recipientId)
  if (updateError) throw new Error(updateError.message)
  return variables
}

/** Merges the same `patch` into many recipients. Returns the number of rows updated. */
export async function mergeRecipientVariablesBulk(recipientIds: string[], patch: Vars): Promise<number> {
  if (recipientIds.length === 0) return 0
  const db = getAdmin()
  let total = 0
  for (let i = 0; i < recipientIds.length; i += 500) {
    const ids = recipientIds.slice(i, i + 500)
    const { data, error } = await db.rpc('merge_recipient_variables_bulk', { p_ids: ids, p_patch: patch })
    if (!error) {
      total += Number(data) || 0
      continue
    }
    if (!isMissingFunction(error)) throw new Error(error.message)
    warnOnce('merge_recipient_variables_bulk')
    for (const id of ids) {
      await mergeRecipientVariables(id, patch)
      total++
    }
  }
  return total
}

/** Counts one open for a recipient (opened_at keeps the first open). */
export async function incrementOpen(recipientId: string, now: string): Promise<void> {
  const db = getAdmin()
  const { error } = await db.rpc('increment_open', { p_recipient_id: recipientId, p_now: now })
  if (!error) return
  if (!isMissingFunction(error)) throw new Error(error.message)

  warnOnce('increment_open')
  const { data: row } = await db
    .from('email_recipients')
    .select('opened_at, open_count')
    .eq('id', recipientId)
    .single()
  if (!row) return
  await db
    .from('email_recipients')
    .update({ open_count: (row.open_count || 0) + 1, opened_at: row.opened_at || now, last_opened_at: now })
    .eq('id', recipientId)
}
