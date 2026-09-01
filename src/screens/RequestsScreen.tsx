import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, SafeAreaView, Text, View } from 'react-native'
import { IncomingRequest, loadIncomingRequests, respondToRequest } from '../api/connections'
import { Center } from '../components/Common'
import { styles } from '../theme'

export function RequestsScreen({ onBack }: { onBack: () => void }) {
  const [requests, setRequests] = useState<IncomingRequest[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setRequests(await loadIncomingRequests())
    } catch (e: any) {
      Alert.alert('Could not load requests', e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function respond(item: IncomingRequest, action: 'accept' | 'not_now' | 'block') {
    try {
      await respondToRequest(item.request_id, action)
      if (action === 'accept') {
        Alert.alert(`${item.requester_name} has been added to your People`)
      }
      await refresh()
    } catch (e: any) {
      Alert.alert('Request unavailable', e.message ?? 'Please try again.')
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable onPress={onBack}><Text style={styles.back}>‹</Text></Pressable>
          <Text style={styles.heading}>Requests</Text>
          <View style={{ width: 28 }} />
        </View>

        {loading ? (
          <Center><ActivityIndicator color="#111" /></Center>
        ) : requests.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.smallMuted}>No pending requests.</Text>
          </View>
        ) : (
          requests.map((item) => (
            <View key={item.request_id} style={styles.requestCard}>
              <Text style={styles.body}>
                {item.requester_name} wants to be one of your People.
              </Text>
              <View style={styles.row}>
                <Pressable style={styles.pill} onPress={() => respond(item, 'accept')}>
                  <Text>Accept</Text>
                </Pressable>
                <Pressable style={styles.pill} onPress={() => respond(item, 'not_now')}>
                  <Text>Not now</Text>
                </Pressable>
                <Pressable style={styles.pill} onPress={() => respond(item, 'block')}>
                  <Text>Block</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>
    </SafeAreaView>
  )
}
