import { supabase } from '../lib/supabase'

export type ArchivedPerson = {
  connection_id: string
  person_id: string
  person_name: string
  archived_at: string
  archive_expires_at: string
  history_available: boolean
  blocked_by_me: boolean
}

export async function removePerson(connectionId: string) {
  const { error } = await supabase.rpc('remove_person', { p_connection_id: connectionId })
  if (error) throw error
}

export async function setPersonBlocked(connectionId: string, blocked: boolean) {
  const { error } = await supabase.rpc('set_person_block', { p_connection_id: connectionId, p_blocked: blocked })
  if (error) throw error
}

export async function loadArchivedPeople(): Promise<ArchivedPerson[]> {
  const { data, error } = await supabase.rpc('get_archived_people')
  if (error) throw error
  return (data ?? []) as ArchivedPerson[]
}

export async function requestReconnect(connectionId: string) {
  const { error } = await supabase.rpc('request_reconnect', { p_connection_id: connectionId })
  if (error) throw error
}

export async function deleteMyArchive(connectionId: string) {
  const { error } = await supabase.rpc('delete_my_archive', { p_connection_id: connectionId })
  if (error) throw error
}

export async function getReachOutContact(personId: string): Promise<{ phone: string; whatsapp_enabled: boolean } | null> {
  const { data, error } = await supabase.rpc('get_connected_person_contact', { p_target_user_id: personId })
  if (error) throw error
  return (data?.[0] ?? null) as { phone: string; whatsapp_enabled: boolean } | null
}
