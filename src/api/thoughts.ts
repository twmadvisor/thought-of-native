import { getConnectionKey } from './e2ee'
import { decryptThought, encryptThought, E2EE_VERSION } from '../lib/e2ee'
import { supabase } from '../lib/supabase'

export type Thought = {
  id: string
  connection_id: string
  sender_id: string
  body: string
  created_at: string
}

type StoredThought = {
  id: string
  connection_id: string
  sender_id: string
  body: string | null
  ciphertext: string | null
  nonce: string | null
  encryption_version: number | null
  created_at: string
}

export type Reaction = {
  thought_id: string
  user_id: string
  emoji: string
  created_at: string
}

export async function loadThoughts(connectionId: string, userId?: string): Promise<Thought[]> {
  const { data, error } = await supabase
    .from('thoughts')
    .select('id,connection_id,sender_id,body,ciphertext,nonce,encryption_version,created_at')
    .eq('connection_id', connectionId)
    .order('created_at', { ascending: true })

  if (error) throw error

  const stored = (data ?? []) as StoredThought[]
  const hasEncrypted = stored.some((thought) => thought.encryption_version !== null)

  let connectionKey: Uint8Array | null = null
  if (hasEncrypted) {
    let resolvedUserId = userId
    if (!resolvedUserId) {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      resolvedUserId = authData.user?.id
    }
    if (!resolvedUserId) throw new Error('Sign in is required to decrypt Thoughts.')
    connectionKey = await getConnectionKey(connectionId, resolvedUserId)
  }

  return stored.map((thought) => {
    if (
      thought.encryption_version === E2EE_VERSION
      && thought.ciphertext
      && thought.nonce
      && connectionKey
    ) {
      return {
        id: thought.id,
        connection_id: thought.connection_id,
        sender_id: thought.sender_id,
        body: decryptThought(
          {
            ciphertext: thought.ciphertext,
            nonce: thought.nonce,
            encryptionVersion: E2EE_VERSION,
          },
          thought.connection_id,
          thought.sender_id,
          connectionKey,
        ),
        created_at: thought.created_at,
      }
    }

    if (thought.encryption_version === null && thought.body !== null) {
      return {
        id: thought.id,
        connection_id: thought.connection_id,
        sender_id: thought.sender_id,
        body: thought.body,
        created_at: thought.created_at,
      }
    }

    throw new Error('This Thought uses an unsupported encryption format.')
  })
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

  const connectionKey = await getConnectionKey(connectionId, senderId)
  const encrypted = encryptThought(clean, connectionId, senderId, connectionKey)

  const { data, error } = await supabase
    .from('thoughts')
    .insert({
      connection_id: connectionId,
      sender_id: senderId,
      body: null,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      encryption_version: encrypted.encryptionVersion,
    })
    .select('id,connection_id,sender_id,created_at')
    .single()

  if (error) throw error

  // Notification delivery is best-effort. The Thought itself is already saved.
  // The notification service receives the Thought id, not the encrypted message body.
  supabase.functions.invoke('send-thought-notification', {
    body: { thought_id: data.id },
  }).catch(() => undefined)

  return { ...data, body: clean } as Thought
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
