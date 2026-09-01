import React from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { initials } from './Common'

export function AvatarCircle({
  name,
  uri,
  size = 76,
}: {
  name: string
  uri?: string | null
  size?: number
}) {
  const radius = size / 2
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#f2f2f2' }}
      />
    )
  }

  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: radius }]}> 
      <Text style={[styles.initials, { fontSize: Math.max(16, size * 0.24) }]}>{initials(name)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.4,
    borderColor: '#111',
    backgroundColor: '#fff',
  },
  initials: { color: '#111', fontWeight: '500' },
})
