import React, { useEffect, useState } from 'react'
import { ActivityIndicator } from 'react-native'
import * as Notifications from 'expo-notifications'
import type { Session } from '@supabase/supabase-js'

import { supabase } from './src/lib/supabase'
import { registerNativePush } from './src/lib/notifications'
import { Center } from './src/components/Common'
import { PhoneAuth, ProfileSetup } from './src/screens/AuthScreens'
import { HomeScreen } from './src/screens/HomeScreen'
import { RequestsScreen } from './src/screens/RequestsScreen'
import { PersonScreen } from './src/screens/PersonScreen'
import { GroupsScreen } from './src/screens/GroupsScreen'
import { AccountScreen } from './src/screens/AccountScreen'
import { ArchivesScreen } from './src/screens/ArchivesScreen'
import { ArchivedHistoryScreen } from './src/screens/ArchivedHistoryScreen'
import { loadPeople, type Person } from './src/api/connections'
import type { ArchivedPerson } from './src/api/relationships'

type Screen =
  | { name: 'home' }
  | { name: 'requests' }
  | { name: 'person'; person: Person }
  | { name: 'groups' }
  | { name: 'account' }
  | { name: 'archives' }
  | { name: 'archivedHistory'; archive: ArchivedPerson }

type PendingNotification = { type?: string; connection_id?: string }

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)
  const [profileReady, setProfileReady] = useState<boolean | null>(null)
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [pendingNotification, setPendingNotification] = useState<PendingNotification | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setBooting(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) setScreen({ name: 'home' })
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user.id) { setProfileReady(null); return }
    setProfileReady(null)
    supabase.from('profiles').select('display_name').eq('id', session.user.id).maybeSingle().then(({ data }) => {
      const name = data?.display_name?.trim() || ''
      setProfileReady(!!name && name !== 'New Person')
    })
  }, [session?.user.id])

  useEffect(() => {
    if (!session?.user.id || !profileReady) return
    registerNativePush(session.user.id).catch(() => undefined)
  }, [profileReady, session?.user.id])

  useEffect(() => {
    const consume = (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data as PendingNotification | undefined
      if (data?.type) setPendingNotification(data)
    }
    Notifications.getLastNotificationResponseAsync().then((response) => {
      consume(response)
      if (response) Notifications.clearLastNotificationResponseAsync().catch(() => undefined)
    })
    const sub = Notifications.addNotificationResponseReceivedListener((response) => consume(response))
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!pendingNotification || !session?.user.id || !profileReady) return
    if (pendingNotification.type === 'person_request') {
      setScreen({ name: 'requests' }); setPendingNotification(null); return
    }
    if (pendingNotification.type === 'thought' && pendingNotification.connection_id) {
      loadPeople(session.user.id).then((people) => {
        const person = people.find((p) => p.connectionId === pendingNotification.connection_id)
        if (person) setScreen({ name: 'person', person })
      }).finally(() => setPendingNotification(null))
    }
  }, [pendingNotification, profileReady, session?.user.id])

  if (booting || (session && profileReady === null)) return <Center><ActivityIndicator color="#111" /></Center>
  if (!session) return <PhoneAuth />
  if (!profileReady) return <ProfileSetup userId={session.user.id} onDone={() => setProfileReady(true)} />

  if (screen.name === 'person') return <PersonScreen session={session} person={screen.person} onBack={() => setScreen({ name: 'home' })} onRemoved={() => setScreen({ name: 'home' })} />
  if (screen.name === 'requests') return <RequestsScreen onBack={() => setScreen({ name: 'home' })} />
  if (screen.name === 'groups') return <GroupsScreen session={session} onBack={() => setScreen({ name: 'home' })} />
  if (screen.name === 'account') return <AccountScreen session={session} onBack={() => setScreen({ name: 'home' })} onGroups={() => setScreen({ name: 'groups' })} onArchives={() => setScreen({ name: 'archives' })} />
  if (screen.name === 'archives') return <ArchivesScreen onBack={() => setScreen({ name: 'account' })} onViewHistory={(archive) => setScreen({ name: 'archivedHistory', archive })} />
  if (screen.name === 'archivedHistory') return <ArchivedHistoryScreen userId={session.user.id} archive={screen.archive} onBack={() => setScreen({ name: 'archives' })} />

  return <HomeScreen session={session} onOpenPerson={(person) => setScreen({ name: 'person', person })} onOpenRequests={() => setScreen({ name: 'requests' })} onOpenGroups={() => setScreen({ name: 'groups' })} onOpenAccount={() => setScreen({ name: 'account' })} />
}
