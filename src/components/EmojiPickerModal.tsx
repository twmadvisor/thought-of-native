import React from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

const EMOJIS = Array.from('😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🫢 🤫 🤥 😶 🫥 😐 🫤 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 👀 ✨ ⭐️ 🌟 💫 🔥 🎉 🎊 💯 ✅'.split(' '))

export function EmojiPickerModal({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean
  onClose: () => void
  onPick: (emoji: string) => void
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.handle} />
          <Text style={styles.title}>Choose a reaction</Text>
          <ScrollView contentContainerStyle={styles.grid}>
            {EMOJIS.map((emoji, index) => (
              <Pressable key={`${emoji}-${index}`} style={styles.emojiButton} onPress={() => onPick(emoji)}>
                <Text style={styles.emoji}>{emoji}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.25)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '65%', backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, paddingHorizontal: 14, paddingBottom: 28 },
  handle: { width: 42, height: 4, backgroundColor: '#d0d0d0', borderRadius: 99, alignSelf: 'center', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '600', textAlign: 'center', marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingBottom: 24 },
  emojiButton: { width: '12.5%', minWidth: 42, height: 48, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 28 },
})
