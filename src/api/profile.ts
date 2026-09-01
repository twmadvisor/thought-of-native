import { supabase } from '../lib/supabase'

export type MyProfile = {
  id: string
  display_name: string
  avatar_path: string | null
  whatsapp_enabled: boolean
}

export async function loadMyProfile(userId: string): Promise<MyProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,display_name,avatar_path,whatsapp_enabled')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data as MyProfile
}

export async function signedAvatar(path: string | null) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, 60 * 60)
  if (error) return null
  return data.signedUrl
}

export async function setMyDisplayName(name: string) {
  const clean = name.trim().slice(0, 40)
  if (!clean) throw new Error('Enter your name.')
  const { error } = await supabase.rpc('set_my_display_name', { p_display_name: clean })
  if (error) throw error
}

export async function setWhatsAppEnabled(userId: string, enabled: boolean) {
  const { error } = await supabase.from('profiles').update({ whatsapp_enabled: enabled }).eq('id', userId)
  if (error) throw error
}

export async function uploadAvatar(userId: string, uri: string, oldPath: string | null) {
  const body = await fetch(uri).then((response) => response.arrayBuffer())
  const path = `${userId}/avatar-${Date.now()}.jpg`
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, body, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (uploadError) throw uploadError
  const { error: profileError } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId)
  if (profileError) {
    await supabase.storage.from('avatars').remove([path])
    throw profileError
  }
  if (oldPath && oldPath !== path) await supabase.storage.from('avatars').remove([oldPath]).catch(() => undefined)
  return path
}
