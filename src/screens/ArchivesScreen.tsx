import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native'
import { ArchivedPerson, deleteMyArchive, loadArchivedPeople, requestReconnect, setPersonBlocked } from '../api/relationships'
import { Center } from '../components/Common'
import { styles } from '../theme'

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ArchivesScreen({ onBack, onViewHistory }: { onBack: () => void; onViewHistory: (archive: ArchivedPerson) => void }) {
  const [rows, setRows] = useState<ArchivedPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [requested, setRequested] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setRows(await loadArchivedPeople()) }
    catch (e: any) { Alert.alert('Could not load archives', e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  function deleteArchive(item: ArchivedPerson) {
    Alert.alert(`Delete your archive with ${item.person_name}?`, 'This deletes only your copy. It cannot be undone, and the other person’s archive is unaffected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete archive', style: 'destructive', onPress: async () => { try { await deleteMyArchive(item.connection_id); await refresh() } catch (e: any) { Alert.alert('Could not delete archive', e.message) } } },
    ])
  }

  if (loading) return <SafeAreaView style={styles.safe}><Center><ActivityIndicator color="#111" /></Center></SafeAreaView>

  return (
    <SafeAreaView style={styles.safe}><View style={styles.page}>
      <View style={styles.header}><Pressable onPress={onBack}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.heading}>Archived People</Text><View style={{ width: 28 }} /></View>
      <Text style={styles.archiveIntro}>Your archive is private. The other person cannot see whether you keep or delete yours.</Text>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        {rows.length === 0 ? <View style={styles.empty}><Text style={styles.smallMuted}>No archived People.</Text></View> : rows.map((item) => (
          <View key={item.connection_id} style={styles.archiveCard}>
            <Text style={styles.archiveName}>{item.person_name || 'Archived Person'}</Text>
            <Text style={styles.smallMuted}>Archive kept until {dateLabel(item.archive_expires_at)}</Text>
            <View style={styles.archiveActions}>
              {item.history_available && <Pressable style={styles.pill} onPress={() => onViewHistory(item)}><Text>View history</Text></Pressable>}
              {!item.blocked_by_me && <Pressable style={styles.pill} disabled={requested.has(item.connection_id)} onPress={async () => { try { await requestReconnect(item.connection_id); setRequested((old) => new Set(old).add(item.connection_id)) } catch (e: any) { Alert.alert('Could not reconnect', e.message) } }}><Text>{requested.has(item.connection_id) ? 'Request sent' : 'Reconnect'}</Text></Pressable>}
              <Pressable style={styles.pill} onPress={async () => { try { await setPersonBlocked(item.connection_id, !item.blocked_by_me); await refresh() } catch (e: any) { Alert.alert('Could not update block', e.message) } }}><Text>{item.blocked_by_me ? 'Unblock' : 'Block'}</Text></Pressable>
              <Pressable style={styles.dangerPill} onPress={() => deleteArchive(item)}><Text style={styles.dangerText}>Delete archive</Text></Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </View></SafeAreaView>
  )
}
