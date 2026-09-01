import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native'
import type { Session } from '@supabase/supabase-js'
import type { Person } from '../api/connections'
import { getReachOutContact, removePerson, setPersonBlocked } from '../api/relationships'
import { Reaction, Thought, loadReactions, loadThoughts, markConnectionOpened, rethinkThought, setReaction, shareThought } from '../api/thoughts'
import { ThoughtDots } from '../components/ThoughtDots'
import { ThoughtBubble } from '../components/ThoughtBubble'
import { EmojiPickerModal } from '../components/EmojiPickerModal'
import { supabase } from '../lib/supabase'
import { styles } from '../theme'

const QUICK = ['😌', '🥰', '❤️', '👀', '👋', '👍']

function formatThoughtTime(iso: string) {
  const date = new Date(iso), now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return time
  const sameYear = date.getFullYear() === now.getFullYear()
  const d = date.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
  return `${d}, ${time}`
}

export function PersonScreen({ session, person, onBack, onRemoved }: { session: Session; person: Person; onBack: () => void; onRemoved: () => void }) {
  const [thoughts, setThoughts] = useState<Thought[]>([])
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeThoughtId, setActiveThoughtId] = useState<string | null>(null)
  const [timestampThoughtId, setTimestampThoughtId] = useState<string | null>(null)
  const [emojiModal, setEmojiModal] = useState(false)
  const [now, setNow] = useState(Date.now())
  const scrollRef = useRef<ScrollView>(null)
  const timestampTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const nextThoughts = await loadThoughts(person.connectionId)
      const nextReactions = await loadReactions(nextThoughts.map((t) => t.id))
      setThoughts(nextThoughts); setReactions(nextReactions)
      await markConnectionOpened(person.connectionId, session.user.id)
    } catch (e: any) { Alert.alert('Could not load Thoughts', e.message) }
  }, [person.connectionId, session.user.id])

  useEffect(() => {
    refresh()
    const tick = setInterval(() => setNow(Date.now()), 500)
    const channel = supabase.channel(`thoughts-${person.connectionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'thoughts', filter: `connection_id=eq.${person.connectionId}` }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, () => refresh())
      .subscribe()
    return () => {
      clearInterval(tick)
      if (timestampTimer.current) clearTimeout(timestampTimer.current)
      supabase.removeChannel(channel)
    }
  }, [person.connectionId, refresh])

  const reactionsByThought = useMemo(() => {
    const map = new Map<string, Reaction[]>()
    reactions.forEach((reaction) => { const list = map.get(reaction.thought_id) ?? []; list.push(reaction); map.set(reaction.thought_id, list) })
    return map
  }, [reactions])

  function revealThought(thoughtId: string) {
    setActiveThoughtId((current) => current === thoughtId ? null : thoughtId)
    setTimestampThoughtId(thoughtId)
    if (timestampTimer.current) clearTimeout(timestampTimer.current)
    timestampTimer.current = setTimeout(() => setTimestampThoughtId(null), 3000)
  }

  async function react(thoughtId: string, emoji: string) {
    try {
      await setReaction(thoughtId, session.user.id, emoji)
      setReactions(await loadReactions(thoughts.map((t) => t.id)))
      setEmojiModal(false)
    } catch (e: any) { Alert.alert('Reaction unavailable', e.message) }
  }

  async function send() {
    if (!text.trim() || busy) return
    const draft = text
    setText(''); setBusy(true)
    try {
      const thought = await shareThought(person.connectionId, session.user.id, draft)
      if (thought) setThoughts((old) => old.some((x) => x.id === thought.id) ? old : [...old, thought])
    } catch (e: any) {
      setText(draft); Alert.alert('Could not share Thought', e.message)
    } finally { setBusy(false) }
  }

  async function rethink(thoughtId: string) {
    try { await rethinkThought(thoughtId); setThoughts((old) => old.filter((t) => t.id !== thoughtId)) }
    catch (e: any) { Alert.alert('Rethink unavailable', e.message) }
  }

  async function reachOut() {
    try {
      const contact = await getReachOutContact(person.personId)
      if (!contact?.phone) throw new Error('Reach Out is unavailable for this person.')
      const buttons: any[] = [
        { text: 'Text / iMessage', onPress: () => Linking.openURL(`sms:${contact.phone}`) },
      ]
      if (contact.whatsapp_enabled) buttons.push({ text: 'WhatsApp', onPress: () => Linking.openURL(`https://wa.me/${contact.phone.replace(/\D/g, '')}`) })
      buttons.push({ text: 'Cancel', style: 'cancel' })
      Alert.alert('Reach Out', `Continue the conversation with ${person.privateName || person.name}.`, buttons)
    } catch (e: any) { Alert.alert('Reach Out', e.message) }
  }

  function confirmRemove() {
    const name = person.privateName || person.name
    Alert.alert(`Remove ${name}?`, 'You will both keep your own private archive of this Thought history for up to one year.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { try { await removePerson(person.connectionId); onRemoved() } catch (e: any) { Alert.alert('Could not remove person', e.message) } } },
    ])
  }

  function confirmBlock() {
    const name = person.privateName || person.name
    Alert.alert(`Block ${name}?`, 'They will not be notified. They can still see you normally, but Thoughts and reactions they send while blocked will not reach you.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: async () => { try { await setPersonBlocked(person.connectionId, true); onRemoved() } catch (e: any) { Alert.alert('Could not block person', e.message) } } },
    ])
  }

  function openOptions() {
    Alert.alert(person.privateName || person.name, 'Manage this connection.', [
      { text: 'Remove from People', onPress: confirmRemove },
      { text: 'Block', style: 'destructive', onPress: confirmBlock },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const activeThought = thoughts.find((t) => t.id === activeThoughtId) ?? null
  const activeReactions = activeThought ? reactionsByThought.get(activeThought.id) ?? [] : []
  const myActiveReaction = activeReactions.find((r) => r.user_id === session.user.id)?.emoji ?? null

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.pageNoBottom} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={onBack}><Text style={styles.back}>‹</Text></Pressable>
          <Text style={styles.heading}>{person.privateName || person.name}</Text>
          <View style={styles.personHeaderActions}><Pressable style={styles.reachButton} onPress={reachOut}><Text style={styles.reachButtonText}>Reach Out</Text></Pressable><Pressable hitSlop={10} onPress={openOptions}><Text style={styles.menuGlyph}>•••</Text></Pressable></View>
        </View>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.history} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
          {thoughts.map((thought) => {
            const outgoing = thought.sender_id === session.user.id
            const rs = reactionsByThought.get(thought.id) ?? []
            const grouped: { emoji: string; count: number; mine: boolean }[] = Array.from(rs.reduce((map, r) => {
              const value = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false }
              value.count += 1; if (r.user_id === session.user.id) value.mine = true; map.set(r.emoji, value); return map
            }, new Map<string, { emoji: string; count: number; mine: boolean }>()).values())
            const rethinkMs = 10000 - (now - new Date(thought.created_at).getTime())
            return (
              <View key={thought.id} style={[styles.thoughtWrap, outgoing ? styles.outgoingWrap : styles.incomingWrap]}>
                <ThoughtBubble thought={thought} outgoing={outgoing} onPress={() => revealThought(thought.id)} />
                {timestampThoughtId === thought.id && <Text style={[styles.thoughtTimestamp, outgoing ? { textAlign: 'right' } : { textAlign: 'left' }]}>{formatThoughtTime(thought.created_at)}</Text>}
                {!!grouped.length && <View style={[styles.reactionStrip, outgoing ? styles.alignRight : styles.alignLeft]}>{grouped.map((g) => (
                  <Pressable key={g.emoji} style={[styles.reactionChip, g.mine && styles.reactionChipMine]} onPress={() => revealThought(thought.id)}>
                    <Text style={styles.reactionEmoji}>{g.emoji}</Text>{g.count > 1 && <Text style={styles.reactionCount}>{g.count}</Text>}
                  </Pressable>
                ))}</View>}
                {outgoing && rethinkMs > 0 && <Pressable onPress={() => rethink(thought.id)} hitSlop={8}><Text style={styles.rethinkLink}>Rethink</Text></Pressable>}
                {activeThoughtId === thought.id && <View style={[styles.reactionPicker, outgoing ? styles.alignRight : styles.alignLeft]}>
                  {QUICK.map((emoji) => <Pressable key={emoji} style={[styles.quickReaction, myActiveReaction === emoji && styles.quickReactionSelected]} onPress={() => react(thought.id, emoji)}><Text style={styles.quickReactionEmoji}>{emoji}</Text></Pressable>)}
                  <Pressable style={styles.quickReaction} onPress={() => setEmojiModal(true)}><Text style={styles.plus}>＋</Text></Pressable>
                </View>}
              </View>
            )
          })}
          {thoughts.length === 0 && <Text style={styles.mutedCentered}>No Thoughts yet.</Text>}
        </ScrollView>
        <View style={styles.composerNative}>
          <TextInput value={text} onChangeText={setText} placeholder="Share a thought…" maxLength={60} style={styles.composerInput} returnKeyType="send" blurOnSubmit={false} onSubmitEditing={send} />
          <Pressable style={styles.sendCircle} onPress={send} disabled={!text.trim() || busy}><ThoughtDots filled={!!text.trim()} /></Pressable>
        </View>
        <Text style={styles.counterNative}>{text.length}/60</Text>
        <EmojiPickerModal visible={emojiModal} onClose={() => setEmojiModal(false)} onPick={(emoji) => activeThought && react(activeThought.id, emoji)} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
