import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Modal, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native'
import type { Session } from '@supabase/supabase-js'
import { ThoughtDots } from '../components/ThoughtDots'
import { AvatarCircle } from '../components/AvatarCircle'
import { Button, Center } from '../components/Common'
import { IncomingRequest, Person, loadIncomingRequests, loadPeople, requestPerson } from '../api/connections'
import { GroupState, loadGroupState } from '../api/groups'
import { supabase } from '../lib/supabase'
import { styles } from '../theme'

export function HomeScreen({ session, onOpenPerson, onOpenRequests, onOpenGroups, onOpenAccount }: {
  session: Session
  onOpenPerson: (person: Person) => void
  onOpenRequests: () => void
  onOpenGroups: () => void
  onOpenAccount: () => void
}) {
  const [people, setPeople] = useState<Person[]>([])
  const [incoming, setIncoming] = useState<IncomingRequest[]>([])
  const [groups, setGroups] = useState<GroupState>({ defaultName: 'Your People', groups: [], memberships: [] })
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [requestMessage, setRequestMessage] = useState('')
  const [requestedPhone, setRequestedPhone] = useState('')

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try {
      const [nextPeople, nextIncoming, nextGroups] = await Promise.all([
        loadPeople(session.user.id), loadIncomingRequests(), loadGroupState(session.user.id),
      ])
      setPeople(nextPeople); setIncoming(nextIncoming); setGroups(nextGroups)
      setSelectedGroupId((current) => current && nextGroups.groups.some((g) => g.id === current) ? current : null)
    } catch (e: any) {
      Alert.alert('Could not load thought of', e.message ?? 'Please try again.')
    } finally { setLoading(false) }
  }, [session.user.id])

  useEffect(() => {
    refresh(true)
    const channel = supabase.channel(`people-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'thoughts' }, () => refresh(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'connections' }, () => refresh(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, () => refresh(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_memberships' }, () => refresh(false))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [refresh, session.user.id])

  const visiblePeople = useMemo(() => {
    if (!selectedGroupId) return people
    const allowed = new Set(groups.memberships.filter((m) => m.group_id === selectedGroupId).map((m) => m.connection_id))
    return people.filter((person) => allowed.has(person.connectionId))
  }, [groups.memberships, people, selectedGroupId])

  const currentTitle = selectedGroupId ? groups.groups.find((g) => g.id === selectedGroupId)?.name || groups.defaultName : groups.defaultName

  async function submitRequest() {
    if (!phone.trim()) return
    setRequesting(true); setRequestMessage('')
    const target = phone.trim()
    try { await requestPerson(target); setRequestMessage('Request sent.'); setRequestedPhone(target) }
    catch { setRequestMessage('Request sent.'); setRequestedPhone(target) }
    finally { setPhone(''); setRequesting(false) }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.homeTitle}>{currentTitle}</Text>
          <View style={styles.headerActions}>
            <Pressable style={styles.requestButton} onPress={onOpenRequests}><Text style={styles.small}>Requests</Text><View style={{ transform: [{ scale: 0.7 }] }}><ThoughtDots filled={incoming.length > 0} /></View></Pressable>
            <Pressable style={styles.headerAccount} onPress={onOpenAccount}><Text style={styles.small}>Account</Text></Pressable>
          </View>
        </View>
        <View style={styles.groupStripWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupStrip}>
            <Pressable style={[styles.groupChip, !selectedGroupId && styles.groupChipActive]} onPress={() => setSelectedGroupId(null)}><Text style={[styles.groupChipText, !selectedGroupId && styles.groupChipTextActive]}>{groups.defaultName}</Text></Pressable>
            {groups.groups.map((group) => <Pressable key={group.id} style={[styles.groupChip, selectedGroupId === group.id && styles.groupChipActive]} onPress={() => setSelectedGroupId(group.id)}><Text style={[styles.groupChipText, selectedGroupId === group.id && styles.groupChipTextActive]}>{group.name}</Text></Pressable>)}
            <Pressable style={styles.groupChip} onPress={onOpenGroups}><Text style={styles.groupChipText}>＋ Group</Text></Pressable>
          </ScrollView>
          <Pressable onPress={onOpenGroups} hitSlop={8}><Text style={styles.manageGroups}>Manage</Text></Pressable>
        </View>
        {loading ? <Center><ActivityIndicator color="#111" /></Center> : people.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.heading}>Your People is empty</Text>
            <Text style={styles.mutedCentered}>Add someone by phone number. We never import your contacts.</Text>
            <Button label="Add someone" onPress={() => setAddOpen(true)} />
          </View>
        ) : visiblePeople.length === 0 ? (
          <View style={styles.empty}><Text style={styles.smallMuted}>No People in this group yet.</Text></View>
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.peopleGrid} showsVerticalScrollIndicator={false}>
              {visiblePeople.map((person) => {
                const name = person.privateName || person.name
                return (
                  <Pressable key={person.connectionId} style={styles.personTile} onPress={() => onOpenPerson(person)}>
                    <View style={styles.personGraphic}>
                      <View style={styles.avatarPosition}><AvatarCircle name={name} uri={person.avatarUrl} size={78} /></View>
                      <View style={styles.personDots}><ThoughtDots filled={person.unread} /></View>
                    </View>
                    <Text style={styles.personName} numberOfLines={1}>{name}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>
            <Pressable style={styles.addOutline} onPress={() => setAddOpen(true)}><Text style={styles.small}>Add someone</Text></Pressable>
          </>
        )}
        <Modal transparent animationType="slide" visible={addOpen} onRequestClose={() => setAddOpen(false)}>
          <View style={styles.modalBackdrop}><View style={styles.sheet}>
            <Text style={styles.heading}>Add someone</Text>
            <Text style={styles.smallMuted}>Enter their exact phone number.</Text>
            <TextInput value={phone} onChangeText={setPhone} placeholder="Phone number" keyboardType="phone-pad" style={styles.input} />
            <Button label={requesting ? 'Sending…' : 'Send request'} onPress={submitRequest} disabled={requesting} />
            {!!requestMessage && <Text style={styles.notice}>{requestMessage}</Text>}
            {!!requestMessage && !!requestedPhone && <Pressable style={styles.secondaryButton} onPress={() => Linking.openURL(`sms:${requestedPhone}?&body=${encodeURIComponent('I’m using Thought Of to stay a little closer between conversations. Join me: https://twmadvisor.github.io/thought-of-site/')}`)}><Text style={styles.secondaryButtonText}>Text them</Text></Pressable>}
            <Pressable onPress={() => { setAddOpen(false); setRequestMessage(''); setRequestedPhone('') }}><Text style={styles.link}>Done</Text></Pressable>
          </View></View>
        </Modal>
      </View>
    </SafeAreaView>
  )
}
