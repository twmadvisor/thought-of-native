import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { styles } from '../theme'

export function Button({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.button, disabled && { opacity: 0.45 }]} onPress={onPress} disabled={disabled}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  )
}

export function Center({ children }: { children: React.ReactNode }) {
  return <View style={styles.center}>{children}</View>
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase()
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
