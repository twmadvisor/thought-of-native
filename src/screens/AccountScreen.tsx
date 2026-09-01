import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, SafeAreaView, Switch, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import type { Session } from '@supabase/supabase-js'
import { AvatarCircle } from '../components/AvatarCircle'
import { Button, Center } from '../components/Common'
import { loadMyProfile, setMyDisplayName, setWhatsAppEnabled, signedAvatar, uploadAvatar } from '../api/profile'
import { supabase } from '../lib/supabase'
import { unregisterNativePush } from '../lib/notifications'
import { styles } from '../theme'

export function AccountScreen({ session, onBack, onGroups, onArchives }: { session: Session; onBack: () => void; onGroups: () => void; onArchives: () => void }) {
  const [name, setName] = useState('')
  const [avatarPath, setAvatarPath] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [whatsapp, setWhatsapp] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const profile = await loadMyProfile(session.user.id)
      setName(profile.display_name)
      setAvatarPath(profile.avatar_path)
      setAvatarUrl(await signedAvatar(profile.avatar_path))
      setWhatsapp(profile.whatsapp_enabled)
    } catch (e: any) { Alert.alert('Could not load Account', e.message) }
    finally { setLoading(false) }
  }, [session.user.id])

  useEffect(() => { refresh() }, [refresh])

  async function saveName() {
    setBusy(true)
    try { await setMyDisplayName(name); Alert.alert('Saved') }
    catch (e: any) { Alert.alert('Could not save name', e.message) }
    finally { setBusy(false) }
  }

  async function choosePhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) return Alert.alert('Photo access is needed to choose a profile photo.')
    const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.86 })
    if (result.canceled || !result.assets[0]?.uri) return
    setBusy(true)
    try {
      const nextPath = await uploadAvatar(session.user.id, result.assets[0].uri, avatarPath)
      setAvatarPath(nextPath)
      setAvatarUrl(await signedAvatar(nextPath))
    } catch (e: any) { Alert.alert('Could not update photo', e.message) }
    finally { setBusy(false) }
  }

  async function toggleWhatsapp(next: boolean) {
    setWhatsapp(next)
    try { await setWhatsAppEnabled(session.user.id, next) }
    catch (e: any) { setWhatsapp(!next); Alert.alert('Could not save setting', e.message) }
  }

  if (loading) return <SafeAreaView style={styles.safe}><Center><ActivityIndicator color="#111" /></Center></SafeAreaView>

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.header}><Pressable onPress={onBack}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.heading}>Account</Text><View style={{ width: 28 }} /></View>
        <View style={styles.accountPhoto}><AvatarCircle name={name || 'You'} uri={avatarUrl} size={94} /><Pressable onPress={choosePhoto} disabled={busy}><Text style={styles.linkInline}>Change photo</Text></Pressable></View>
        <Text style={styles.settingLabel}>Your name</Text>
        <TextInput value={name} onChangeText={setName} maxLength={40} style={styles.input} />
        <Button label={busy ? 'Saving…' : 'Save name'} onPress={saveName} disabled={busy} />
        <View style={styles.settingRow}><View style={{ flex: 1 }}><Text style={styles.settingTitle}>WhatsApp Reach Out</Text><Text style={styles.smallMuted}>Let your People reach you on WhatsApp.</Text></View><Switch value={whatsapp} onValueChange={toggleWhatsapp} /></View>
        <Pressable style={styles.accountLink} onPress={onGroups}><Text style={styles.accountLinkText}>Manage Groups</Text><Text style={styles.accountChevron}>›</Text></Pressable>
        <Pressable style={styles.accountLink} onPress={onArchives}><Text style={styles.accountLinkText}>Archived People</Text><Text style={styles.accountChevron}>›</Text></Pressable>
        <Text style={styles.privacyAccount}>We never import your contacts.</Text>
        <Pressable style={styles.signOutButton} onPress={async () => { await unregisterNativePush(session.user.id); await supabase.auth.signOut() }}><Text style={styles.signOutText}>Sign out</Text></Pressable>
      </View>
    </SafeAreaView>
  )
}
