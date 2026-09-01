import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native'
import type { ArchivedPerson } from '../api/relationships'
import { loadReactions, loadThoughts, Reaction, Thought } from '../api/thoughts'
import { Center } from '../components/Common'
import { ThoughtBubble } from '../components/ThoughtBubble'
import { styles } from '../theme'

function formatThoughtTime(iso: string) {
  const date = new Date(iso), now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return time
  const sameYear = date.getFullYear() === now.getFullYear()
  const d = date.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
  return `${d}, ${time}`
}

export function ArchivedHistoryScreen({ userId, archive, onBack }: { userId: string; archive: ArchivedPerson; onBack: () => void }) {
  const [thoughts, setThoughts] = useState<Thought[]>([])
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [loading, setLoading] = useState(true)
  const [timestampId, setTimestampId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    ;(async () => {
      try { const ts = await loadThoughts(archive.connection_id); setThoughts(ts); setReactions(await loadReactions(ts.map((t) => t.id))) }
      catch (e: any) { Alert.alert('Could not load archived Thoughts', e.message) }
      finally { setLoading(false) }
    })()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [archive.connection_id])

  const reactionMap = useMemo(() => { const map = new Map<string, Reaction[]>(); reactions.forEach((r) => { const list = map.get(r.thought_id) ?? []; list.push(r); map.set(r.thought_id, list) }); return map }, [reactions])

  function reveal(id: string) { setTimestampId(id); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setTimestampId(null), 3000) }

  if (loading) return <SafeAreaView style={styles.safe}><Center><ActivityIndicator color="#111" /></Center></SafeAreaView>
  return <SafeAreaView style={styles.safe}><View style={styles.page}>
    <View style={styles.header}><Pressable onPress={onBack}><Text style={styles.back}>‹</Text></Pressable><View style={{ alignItems: 'center' }}><Text style={styles.heading}>{archive.person_name}</Text><Text style={styles.smallMuted}>Archived Thoughts</Text></View><View style={{ width: 28 }} /></View>
    <ScrollView contentContainerStyle={styles.history}>
      {thoughts.map((thought) => { const outgoing = thought.sender_id === userId; const grouped = Array.from((reactionMap.get(thought.id) ?? []).reduce((m, r) => { m.set(r.emoji, (m.get(r.emoji) ?? 0) + 1); return m }, new Map<string, number>()).entries()); return (
        <View key={thought.id} style={[styles.thoughtWrap, outgoing ? styles.outgoingWrap : styles.incomingWrap]}>
          <ThoughtBubble thought={thought} outgoing={outgoing} onPress={() => reveal(thought.id)} />
          {timestampId === thought.id && <Text style={[styles.thoughtTimestamp, { textAlign: outgoing ? 'right' : 'left' }]}>{formatThoughtTime(thought.created_at)}</Text>}
          {!!grouped.length && <View style={[styles.reactionStrip, outgoing ? styles.alignRight : styles.alignLeft]}>{grouped.map(([emoji, count]) => <View key={emoji} style={styles.reactionChip}><Text style={styles.reactionEmoji}>{emoji}</Text>{count > 1 && <Text style={styles.reactionCount}>{count}</Text>}</View>)}</View>}
        </View>
      ) })}
      {thoughts.length === 0 && <Text style={styles.mutedCentered}>No archived Thoughts.</Text>}
    </ScrollView>
  </View></SafeAreaView>
}
