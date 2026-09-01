import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native'
import type { Session } from '@supabase/supabase-js'
import { createGroup, deleteGroup, Group, loadGroupState, renameDefaultGroup, updateGroup } from '../api/groups'
import { loadPeople, Person } from '../api/connections'
import { Button, Center } from '../components/Common'
import { styles } from '../theme'

export function GroupsScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const [defaultName, setDefaultName] = useState('Your People')
  const [groups, setGroups] = useState<Group[]>([])
  const [memberships, setMemberships] = useState<{ group_id: string; connection_id: string }[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<Group | 'new' | null>(null)
  const [groupName, setGroupName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [state, ps] = await Promise.all([loadGroupState(session.user.id), loadPeople(session.user.id)])
      setDefaultName(state.defaultName); setGroups(state.groups); setMemberships(state.memberships); setPeople(ps)
    } catch (e: any) { Alert.alert('Could not load Groups', e.message) }
    finally { setLoading(false) }
  }, [session.user.id])

  useEffect(() => { refresh() }, [refresh])

  function openEditor(group: Group | 'new') {
    setEditor(group)
    if (group === 'new') { setGroupName(''); setSelected(new Set()) }
    else {
      setGroupName(group.name)
      setSelected(new Set(memberships.filter((m) => m.group_id === group.id).map((m) => m.connection_id)))
    }
  }

  function togglePerson(connectionId: string) {
    setSelected((old) => { const next = new Set(old); next.has(connectionId) ? next.delete(connectionId) : next.add(connectionId); return next })
  }

  async function saveDefault() {
    setBusy(true)
    try { await renameDefaultGroup(session.user.id, defaultName); await refresh() }
    catch (e: any) { Alert.alert('Could not rename group', e.message) }
    finally { setBusy(false) }
  }

  async function saveEditor() {
    if (!editor) return
    setBusy(true)
    try {
      if (editor === 'new') await createGroup(session.user.id, groupName, [...selected])
      else await updateGroup(session.user.id, editor.id, groupName, [...selected])
      setEditor(null); await refresh()
    } catch (e: any) { Alert.alert('Could not save group', e.message) }
    finally { setBusy(false) }
  }

  function confirmDelete(group: Group) {
    Alert.alert(`Delete ${group.name}?`, 'This deletes only your private group. Thought histories are unchanged.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteGroup(session.user.id, group.id); setEditor(null); await refresh() } catch (e: any) { Alert.alert('Could not delete group', e.message) } } },
    ])
  }

  const sortedPeople = useMemo(() => [...people].sort((a, b) => (a.privateName || a.name).localeCompare(b.privateName || b.name)), [people])

  if (loading) return <SafeAreaView style={styles.safe}><Center><ActivityIndicator color="#111" /></Center></SafeAreaView>

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.header}><Pressable onPress={onBack}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.heading}>Manage Groups</Text><View style={{ width: 28 }} /></View>
        <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
          <Text style={styles.groupSectionTitle}>Your all-People group</Text>
          <Text style={styles.smallMuted}>This name is private to you.</Text>
          <View style={styles.groupRenameRow}><TextInput value={defaultName} onChangeText={setDefaultName} maxLength={30} style={[styles.input, { flex: 1 }]} /><Pressable style={styles.smallDarkButton} onPress={saveDefault} disabled={busy}><Text style={styles.smallDarkButtonText}>Save</Text></Pressable></View>
          <View style={styles.groupHeadingRow}><Text style={styles.groupSectionTitle}>Custom groups</Text><Pressable onPress={() => openEditor('new')}><Text style={styles.linkInline}>＋ Group</Text></Pressable></View>
          {groups.length === 0 ? <Text style={styles.smallMuted}>No custom groups yet.</Text> : groups.map((group) => {
            const count = memberships.filter((m) => m.group_id === group.id).length
            return <Pressable key={group.id} style={styles.accountLink} onPress={() => openEditor(group)}><View><Text style={styles.accountLinkText}>{group.name}</Text><Text style={styles.smallMuted}>{count} {count === 1 ? 'person' : 'people'}</Text></View><Text style={styles.accountChevron}>›</Text></Pressable>
          })}
        </ScrollView>
        <Modal visible={!!editor} transparent animationType="slide" onRequestClose={() => setEditor(null)}>
          <View style={styles.modalBackdrop}><View style={[styles.sheet, { maxHeight: '82%' }]}>
            <Text style={styles.heading}>{editor === 'new' ? 'New Group' : 'Manage Group'}</Text>
            <Text style={styles.smallMuted}>Groups are private and never change a person's Thought history.</Text>
            <TextInput value={groupName} onChangeText={setGroupName} maxLength={30} placeholder="Group name" style={styles.input} />
            <ScrollView style={{ maxHeight: 360 }}>
              {sortedPeople.map((person) => { const checked = selected.has(person.connectionId); return (
                <Pressable key={person.connectionId} style={styles.checkRow} onPress={() => togglePerson(person.connectionId)}><Text style={styles.checkMark}>{checked ? '●' : '○'}</Text><Text style={styles.accountLinkText}>{person.privateName || person.name}</Text></Pressable>
              ) })}
            </ScrollView>
            <Button label={busy ? 'Saving…' : 'Save'} onPress={saveEditor} disabled={busy} />
            {editor && editor !== 'new' && <Pressable style={styles.dangerOutline} onPress={() => confirmDelete(editor)}><Text style={styles.dangerText}>Delete group</Text></Pressable>}
            <Pressable onPress={() => setEditor(null)}><Text style={styles.link}>Cancel</Text></Pressable>
          </View></View>
        </Modal>
      </View>
    </SafeAreaView>
  )
}
