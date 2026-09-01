import { supabase } from '../lib/supabase'

export type Person = {
  connectionId: string
  personId: string
  name: string
  privateName: string | null
  avatarPath: string | null
  avatarUrl: string | null
  whatsappEnabled: boolean
  unread: boolean
}

type ConnectionRow = { id: string; user_a: string; user_b: string; status: string }
type ProfileRow = { id: string; display_name: string; avatar_path: string | null; whatsapp_enabled: boolean }
type MemberRow = { connection_id: string; private_name: string | null; archived_at: string | null; last_opened_at: string | null }
type IncomingThoughtRow = { connection_id: string; sender_id: string; created_at: string }

export type IncomingRequest = {
  request_id: string
  requester_id: string
  requester_name: string
  requester_avatar_path: string | null
  created_at: string
}

export async function requestPerson(phone: string) {
  const { data, error } = await supabase.functions.invoke('request-person', {
    body: { phone },
  })
  if (error) throw error
  return data as { message: string }
}

export async function loadIncomingRequests(): Promise<IncomingRequest[]> {
  const { data, error } = await supabase.functions.invoke('incoming-person-requests', {
    body: {},
  })
  if (error) throw error
  return (data?.requests ?? []) as IncomingRequest[]
}

export async function respondToRequest(
  requestId: string,
  action: 'accept' | 'not_now' | 'block',
) {
  const { data, error } = await supabase.functions.invoke('respond-person-request', {
    body: { request_id: requestId, action },
  })
  if (error) throw error
  return data as { status: string; connection_id: string | null }
}

export async function loadPeople(userId: string): Promise<Person[]> {
  const { data: connections, error: connectionsError } = await supabase
    .from('connections')
    .select('id,user_a,user_b,status')
    .eq('status', 'active')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)

  if (connectionsError) throw connectionsError
  if (!connections?.length) return []
  const connectionRows = connections as ConnectionRow[]

  const peerIds = connectionRows.map((c) => (c.user_a === userId ? c.user_b : c.user_a))
  const connectionIds = connectionRows.map((c) => c.id)

  const [profilesResult, membersResult, incomingResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id,display_name,avatar_path,whatsapp_enabled')
      .in('id', peerIds),
    supabase
      .from('connection_members')
      .select('connection_id,private_name,archived_at,last_opened_at')
      .eq('user_id', userId)
      .in('connection_id', connectionIds)
      .is('archived_at', null),
    supabase
      .from('thoughts')
      .select('connection_id,sender_id,created_at')
      .in('connection_id', connectionIds)
      .neq('sender_id', userId)
      .order('created_at', { ascending: false }),
  ])

  if (profilesResult.error) throw profilesResult.error
  if (membersResult.error) throw membersResult.error
  if (incomingResult.error) throw incomingResult.error

  const profiles = (profilesResult.data ?? []) as ProfileRow[]
  const memberRows = (membersResult.data ?? []) as MemberRow[]
  const incoming = (incomingResult.data ?? []) as IncomingThoughtRow[]

  const profileById = new Map(profiles.map((p) => [p.id, p]))
  const memberByConnection = new Map(memberRows.map((m) => [m.connection_id, m]))
  const latestIncoming = new Map<string, string>()
  incoming.forEach((row) => {
    if (!latestIncoming.has(row.connection_id)) latestIncoming.set(row.connection_id, row.created_at)
  })

  const avatarPaths = profiles
    .map((p) => p.avatar_path)
    .filter((path): path is string => !!path)
  const avatarUrlByPath = new Map<string, string>()

  if (avatarPaths.length) {
    const { data: signed } = await supabase.storage.from('avatars').createSignedUrls(avatarPaths, 60 * 60)
    signed?.forEach((item, index) => {
      if (item.signedUrl) avatarUrlByPath.set(avatarPaths[index], item.signedUrl)
    })
  }

  return connectionRows.flatMap((c) => {
    const peerId = c.user_a === userId ? c.user_b : c.user_a
    const profile = profileById.get(peerId)
    const member = memberByConnection.get(c.id)
    if (!profile || !member) return []

    const latest = latestIncoming.get(c.id)
    const opened = member.last_opened_at
    const unread = !!latest && (!opened || new Date(latest).getTime() > new Date(opened).getTime())

    return [{
      connectionId: c.id,
      personId: peerId,
      name: profile.display_name,
      privateName: member.private_name,
      avatarPath: profile.avatar_path,
      avatarUrl: profile.avatar_path ? avatarUrlByPath.get(profile.avatar_path) ?? null : null,
      whatsappEnabled: profile.whatsapp_enabled,
      unread,
    }]
  })
}
