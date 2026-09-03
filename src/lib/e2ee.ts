import * as Keychain from 'react-native-keychain'
import {
  crypto_aead_xchacha20poly1305_ietf_decrypt,
  crypto_aead_xchacha20poly1305_ietf_encrypt,
  crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
  crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  crypto_box_SEEDBYTES,
  crypto_box_seal,
  crypto_box_seal_open,
  crypto_box_seed_keypair,
  from_base64,
  randombytes_buf,
  to_base64,
} from 'react-native-libsodium'

export const E2EE_VERSION = 1 as const

const identityService = (userId: string) => `com.thoughtof.app.e2ee.identity.v1.${userId}`

export type EncryptedThoughtPayload = {
  ciphertext: string
  nonce: string
  encryptionVersion: typeof E2EE_VERSION
}

export async function loadIdentitySeed(userId: string): Promise<Uint8Array | null> {
  const saved = await Keychain.getGenericPassword({
    service: identityService(userId),
    cloudSync: true,
  })

  if (!saved) return null
  if (saved.username !== userId) return null

  const seed = from_base64(saved.password)
  return seed.length === crypto_box_SEEDBYTES ? seed : null
}

export async function createIdentitySeed(userId: string): Promise<Uint8Array> {
  const existing = await loadIdentitySeed(userId)
  if (existing) return existing

  const seed = randombytes_buf(crypto_box_SEEDBYTES)
  await Keychain.setGenericPassword(userId, to_base64(seed), {
    service: identityService(userId),
    cloudSync: true,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
  })
  return seed
}

export function publicKeyForIdentitySeed(seed: Uint8Array): string {
  if (seed.length !== crypto_box_SEEDBYTES) throw new Error('Invalid identity seed')
  return to_base64(crypto_box_seed_keypair(seed).publicKey)
}

export function generateConnectionKey(): Uint8Array {
  return randombytes_buf(crypto_aead_xchacha20poly1305_ietf_KEYBYTES)
}

export function sealConnectionKey(connectionKey: Uint8Array, recipientPublicKey: string): string {
  if (connectionKey.length !== crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
    throw new Error('Invalid connection key')
  }
  return to_base64(crypto_box_seal(connectionKey, from_base64(recipientPublicKey)))
}

export function openConnectionKey(envelope: string, identitySeed: Uint8Array): Uint8Array {
  if (identitySeed.length !== crypto_box_SEEDBYTES) throw new Error('Invalid identity seed')
  const keypair = crypto_box_seed_keypair(identitySeed)
  const opened = crypto_box_seal_open(from_base64(envelope), keypair.publicKey, keypair.privateKey)
  if (opened.length !== crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
    throw new Error('Invalid connection-key envelope')
  }
  return opened
}

function thoughtAad(connectionId: string, senderId: string): Uint8Array {
  return new TextEncoder().encode(`thought-of:v${E2EE_VERSION}:${connectionId}:${senderId}`)
}

export function encryptThought(
  body: string,
  connectionId: string,
  senderId: string,
  connectionKey: Uint8Array,
): EncryptedThoughtPayload {
  if (connectionKey.length !== crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
    throw new Error('Invalid connection key')
  }

  const nonce = randombytes_buf(crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  const plaintext = new TextEncoder().encode(body)
  const ciphertext = crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    thoughtAad(connectionId, senderId),
    null,
    nonce,
    connectionKey,
  )

  return {
    ciphertext: to_base64(ciphertext),
    nonce: to_base64(nonce),
    encryptionVersion: E2EE_VERSION,
  }
}

export function decryptThought(
  payload: EncryptedThoughtPayload,
  connectionId: string,
  senderId: string,
  connectionKey: Uint8Array,
): string {
  if (payload.encryptionVersion !== E2EE_VERSION) throw new Error('Unsupported encryption version')
  if (connectionKey.length !== crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
    throw new Error('Invalid connection key')
  }

  const plaintext = crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    from_base64(payload.ciphertext),
    thoughtAad(connectionId, senderId),
    from_base64(payload.nonce),
    connectionKey,
  )

  return new TextDecoder().decode(plaintext)
}
