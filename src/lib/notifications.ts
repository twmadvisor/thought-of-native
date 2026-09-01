import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { supabase } from './supabase'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export async function registerNativePush(userId: string) {
  if (!Device.isDevice) return null

  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId
  if (!projectId) return null

  const current = await Notifications.getPermissionsAsync()
  let status = current.status
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync()
    status = requested.status
  }
  if (status !== 'granted') return null

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Thoughts',
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
  if (!token) return null

  // An Expo push token identifies this app install. Reassign only this token if the
  // device changes accounts, without deleting the user's registrations on other devices.
  await supabase.from('push_registrations').delete().eq('provider', 'expo').eq('token', token)
  const { error } = await supabase.from('push_registrations').insert({
    user_id: userId,
    provider: 'expo',
    token,
  })
  if (error) throw error
  return token
}

export async function unregisterNativePush(userId: string) {
  if (!Device.isDevice) return
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId
  if (!projectId) return
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
    if (!token) return
    await supabase.from('push_registrations').delete().eq('user_id', userId).eq('provider', 'expo').eq('token', token)
  } catch {
    // Sign-out should still succeed if notification cleanup is unavailable.
  }
}

