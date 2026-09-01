import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Thought } from '../api/thoughts'

function hash(input: string) {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h >>> 0)
}

function shape(id: string) {
  const h = hash(id)
  return {
    tl: 23 + (h % 9),
    tr: 22 + ((h >> 3) % 10),
    br: 23 + ((h >> 6) % 9),
    bl: 22 + ((h >> 9) % 10),
    tail1: 14 + ((h >> 12) % 3),
    tail2: 7 + ((h >> 15) % 3),
  }
}

export function ThoughtBubble({
  thought,
  outgoing,
  onPress,
}: {
  thought: Thought
  outgoing: boolean
  onPress: () => void
}) {
  const s = shape(thought.id)
  return (
    <Pressable onPress={onPress} style={styles.hit}>
      <View
        style={[
          styles.bubble,
          {
            borderTopLeftRadius: s.tl,
            borderTopRightRadius: s.tr,
            borderBottomRightRadius: s.br,
            borderBottomLeftRadius: s.bl,
          },
        ]}
      >
        <Text style={styles.text}>{thought.body}</Text>
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.tailOne,
          { width: s.tail1, height: s.tail1, borderRadius: s.tail1 / 2 },
          outgoing ? styles.tailRightOne : styles.tailLeftOne,
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.tailTwo,
          { width: s.tail2, height: s.tail2, borderRadius: s.tail2 / 2 },
          outgoing ? styles.tailRightTwo : styles.tailLeftTwo,
        ]}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  hit: { position: 'relative', paddingBottom: 15 },
  bubble: {
    borderWidth: 1.5,
    borderColor: '#111',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 60,
  },
  text: { color: '#111', fontSize: 18, lineHeight: 23 },
  tailOne: {
    position: 'absolute',
    bottom: 3,
    borderWidth: 1.4,
    borderColor: '#111',
    backgroundColor: '#fff',
  },
  tailTwo: {
    position: 'absolute',
    bottom: -1,
    borderWidth: 1.3,
    borderColor: '#111',
    backgroundColor: '#fff',
  },
  tailLeftOne: { left: 15 },
  tailLeftTwo: { left: 4 },
  tailRightOne: { right: 15 },
  tailRightTwo: { right: 4 },
})
