import { supabase } from '../lib/supabase'

export type Thought = {
  id: string
  connection_id: string
  sender_id: string
  body: string
  created_at: string
}

export type Reaction = {
  thought_id: string
  user_id: string
  emoji: string
  created_at: string
}

export async function loadThoughts(connectionId: string): Promise<Thought[]> {
  const { data, error } = await supabase
    .from('thoughts')
    .select('id,connection_id,sender_id,body,created_at')
    .eq('connection_id', connectionId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as Thought[]
}

export async function loadReactions(thoughtIds: string[]): Promise<Reaction[]> {
  if (!thoughtIds.length) return []
  const { data, error } = await supabase
    .from('reactions')
    .select('thought_id,user_id,emoji,created_at')
    .in('thought_id', thoughtIds)

  if (error) throw error
  return (data ?? []) as Reaction[]
}

export async function shareThought(connectionId: string, senderId: string, body: string) {
  const clean = body.trim().slice(0, 60)
  if (!clean) return null

  const { data, error } = await supabase
    .from('thoughts')
    .insert({ connection_id: connectionId, sender_id: senderId, body: clean })
    .select('id,connection_id,sender_id,body,created_at')
    .single()

  if (error) throw error

  // Notification delivery is best-effort. The Thought itself is already saved.
  supabase.functions.invoke('send-thought-notification', {
    body: { thought_id: data.id },
  }).catch(() => undefined)

  return data as Thought
}

export async function rethinkThought(thoughtId: string) {
  const { error } = await supabase.from('thoughts').delete().eq('id', thoughtId)
  if (error) throw error
}

export async function setReaction(thoughtId: string, userId: string, emoji: string) {
  const { data: existing, error: existingError } = await supabase
    .from('reactions')
    .select('emoji')
    .eq('thought_id', thoughtId)
    .eq('user_id', userId)
    .maybeSingle()

  if (existingError) throw existingError

  if (existing?.emoji === emoji) {
    const { error } = await supabase
      .from('reactions')
      .delete()
      .eq('thought_id', thoughtId)
      .eq('user_id', userId)
    if (error) throw error
    return
  }

  const { error } = await supabase
    .from('reactions')
    .upsert(
      { thought_id: thoughtId, user_id: userId, emoji },
      { onConflict: 'thought_id,user_id' },
    )
  if (error) throw error
}

export async function markConnectionOpened(connectionId: string, userId: string) {
  const { error } = await supabase
    .from('connection_members')
    .update({ last_opened_at: new Date().toISOString() })
    .eq('connection_id', connectionId)
    .eq('user_id', userId)

  if (error) throw error
}
