import { supabase } from '../lib/supabase'

export type Group = { id: string; name: string; created_at: string }
export type GroupMembership = { group_id: string; connection_id: string }
export type GroupState = { defaultName: string; groups: Group[]; memberships: GroupMembership[] }

export async function loadGroupState(userId: string): Promise<GroupState> {
  const [prefs, groups, memberships] = await Promise.all([
    supabase.from('user_preferences').select('default_group_name').eq('user_id', userId).maybeSingle(),
    supabase.from('groups').select('id,name,created_at').eq('owner_id', userId).order('created_at', { ascending: true }),
    supabase.from('group_memberships').select('group_id,connection_id').eq('owner_id', userId),
  ])
  if (prefs.error) throw prefs.error
  if (groups.error) throw groups.error
  if (memberships.error) throw memberships.error
  return {
    defaultName: prefs.data?.default_group_name || 'Your People',
    groups: (groups.data ?? []) as Group[],
    memberships: (memberships.data ?? []) as GroupMembership[],
  }
}

export async function renameDefaultGroup(userId: string, name: string) {
  const clean = name.trim().slice(0, 30)
  if (!clean) throw new Error('Enter a group name.')
  const { error } = await supabase.from('user_preferences').upsert(
    { user_id: userId, default_group_name: clean },
    { onConflict: 'user_id' },
  )
  if (error) throw error
}

export async function createGroup(userId: string, name: string, connectionIds: string[]) {
  const clean = name.trim().slice(0, 30)
  if (!clean) throw new Error('Enter a group name.')
  const { data, error } = await supabase
    .from('groups')
    .insert({ owner_id: userId, name: clean })
    .select('id')
    .single()
  if (error) throw error
  if (connectionIds.length) {
    const rows = connectionIds.map((connection_id) => ({ group_id: data.id, connection_id, owner_id: userId }))
    const { error: membershipError } = await supabase.from('group_memberships').insert(rows)
    if (membershipError) throw membershipError
  }
  return data.id as string
}

export async function updateGroup(userId: string, groupId: string, name: string, connectionIds: string[]) {
  const clean = name.trim().slice(0, 30)
  if (!clean) throw new Error('Enter a group name.')
  const { error: groupError } = await supabase.from('groups').update({ name: clean }).eq('id', groupId).eq('owner_id', userId)
  if (groupError) throw groupError
  const { error: deleteError } = await supabase.from('group_memberships').delete().eq('group_id', groupId).eq('owner_id', userId)
  if (deleteError) throw deleteError
  if (connectionIds.length) {
    const rows = connectionIds.map((connection_id) => ({ group_id: groupId, connection_id, owner_id: userId }))
    const { error } = await supabase.from('group_memberships').insert(rows)
    if (error) throw error
  }
}

export async function deleteGroup(userId: string, groupId: string) {
  const { error } = await supabase.from('groups').delete().eq('id', groupId).eq('owner_id', userId)
  if (error) throw error
}
