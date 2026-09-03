import { supabase } from '../lib/supabase'
import {
  createIdentitySeed,
  generateConnectionKey,
  loadIdentitySeed,
  openConnectionKey,
  publicKeyForIdentitySeed,
  sealConnectionKey,
} from '../lib/e2ee'

export type EncryptionIdentityState =
  | { status: 'ready' }
  | { status: 'recovery_required' }
  | { status: 'key_mismatch' }

export async function ensureMyEncryptionIdentity(userId: string): Promise<EncryptionIdentityState> {
  const { data: remote, error: remoteError } = await supabase
    .from('user_crypto_keys')
    .select('public_key,key_version')
    .eq('user_id', userId)
    .maybeSingle()

  if (remoteError) throw remoteError

  let seed = await loadIdentitySeed(userId)

  if (remote) {
    if (!seed) return { status: 'recovery_required' }
    const localPublicKey = publicKeyForIdentitySeed(seed)
    if (remote.key_version !== 1 || localPublicKey !== remote.public_key) {
      return { status: 'key_mismatch' }
    }
    return { status: 'ready' }
  }

  if (!seed) seed = await createIdentitySeed(userId)
  const publicKey = publicKeyForIdentitySeed(seed)

  const { error: insertError } = await supabase
    .from('user_crypto_keys')
    .insert({ user_id: userId, public_key: publicKey, key_version: 1 })

  if (!insertError) return { status: 'ready' }

  // Another device may have registered the account key at the same time.
  const { data: afterRace, error: raceError } = await supabase
    .from('user_crypto_keys')
    .select('public_key,key_version')
    .eq('user_id', userId)
    .maybeSingle()

  if (raceError) throw raceError
  if (!afterRace) throw insertError
  if (afterRace.key_version !== 1 || afterRace.public_key !== publicKey) {
    return { status: 'key_mismatch' }
  }

  return { status: 'ready' }
}

export async function getConnectionKey(connectionId: string, userId: string): Promise<Uint8Array> {
  const seed = await loadIdentitySeed(userId)
  if (!seed) throw new Error('Encrypted history is not available on this device.')

  const { data: existing, error: existingError } = await supabase
    .from('connection_key_envelopes')
    .select('envelope,key_version')
    .eq('connection_id', connectionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) {
    if (existing.key_version !== 1) throw new Error('Unsupported connection encryption version.')
    return openConnectionKey(existing.envelope, seed)
  }

  const { data: connection, error: connectionError } = await supabase
    .from('connections')
    .select('user_a,user_b,status')
    .eq('id', connectionId)
    .single()

  if (connectionError) throw connectionError
  if (connection.status !== 'active') throw new Error('This connection is not active.')
  if (connection.user_a !== userId && connection.user_b !== userId) throw new Error('Not authorized.')

  const participantIds = [connection.user_a, connection.user_b]
  const { data: publicKeys, error: keyError } = await supabase
    .from('user_crypto_keys')
    .select('user_id,public_key,key_version')
    .in('user_id', participantIds)

  if (keyError) throw keyError
  if (!publicKeys || publicKeys.length !== 2 || publicKeys.some((row) => row.key_version !== 1)) {
    throw new Error('Encryption will be available after both people update Thought Of.')
  }

  const keyByUser = new Map(publicKeys.map((row) => [row.user_id, row.public_key]))
  const userAPublicKey = keyByUser.get(connection.user_a)
  const userBPublicKey = keyByUser.get(connection.user_b)
  if (!userAPublicKey || !userBPublicKey) {
    throw new Error('Encryption will be available after both people update Thought Of.')
  }

  const connectionKey = generateConnectionKey()
  const userAEnvelope = sealConnectionKey(connectionKey, userAPublicKey)
  const userBEnvelope = sealConnectionKey(connectionKey, userBPublicKey)

  const { error: initializeError } = await supabase.rpc('initialize_connection_envelopes', {
    p_connection_id: connectionId,
    p_user_a_envelope: userAEnvelope,
    p_user_b_envelope: userBEnvelope,
  })

  if (initializeError) throw initializeError

  // Reload our envelope. If another device won the initialization race, this uses
  // the connection key that device established instead of the one generated above.
  const { data: saved, error: savedError } = await supabase
    .from('connection_key_envelopes')
    .select('envelope,key_version')
    .eq('connection_id', connectionId)
    .eq('user_id', userId)
    .single()

  if (savedError) throw savedError
  if (saved.key_version !== 1) throw new Error('Unsupported connection encryption version.')
  return openConnectionKey(saved.envelope, seed)
}
