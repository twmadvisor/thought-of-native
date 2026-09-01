import { StyleSheet, View } from 'react-native'

export function ThoughtDots({ filled = false }: { filled?: boolean }) {
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={[styles.dot, styles.small, filled && styles.filled]} />
      <View style={[styles.dot, styles.medium, filled && styles.filled]} />
      <View style={[styles.dot, styles.large, filled && styles.filled]} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { width: 36, height: 38, position: 'relative' },
  dot: {
    position: 'absolute',
    borderRadius: 99,
    borderWidth: 1.4,
    borderColor: '#111',
    backgroundColor: '#fff',
  },
  small: { width: 6, height: 6, left: 1, bottom: 2 },
  medium: { width: 9, height: 9, left: 13, bottom: 13 },
  large: { width: 12, height: 12, left: 25, bottom: 25 },
  filled: { backgroundColor: '#111' },
})
