import React, { useState } from 'react'
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { supabase } from '../lib/supabase'
import { styles } from '../theme'
import { Button } from '../components/Common'

const logo = require('../../assets/thought-of-logo.png')

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const digits = trimmed.replace(/\D/g, '')

  // Preserve explicitly entered international numbers.
  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }

  // Default ordinary 10-digit numbers to the US/Canada country code.
  if (digits.length === 10) return `+1${digits}`

  // Accept a US/Canada number when the user already typed the leading 1.
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`

  return null
}

export function PhoneAuth() {
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function sendCode() {
    const normalizedPhone = normalizePhone(phone)
    if (!normalizedPhone) {
      return Alert.alert(
        'Check phone number',
        'Enter a 10-digit US/Canada number, or include + and the country code for an international number.',
      )
    }

    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({ phone: normalizedPhone })
    setBusy(false)
    if (error) return Alert.alert('Could not send code', error.message)

    setPhone(normalizedPhone)
    setStep('code')
  }

  async function verifyCode() {
    const normalizedPhone = normalizePhone(phone)
    if (!normalizedPhone) {
      return Alert.alert('Check phone number', 'Please go back and enter your phone number again.')
    }

    setBusy(true)
    const { error } = await supabase.auth.verifyOtp({
      phone: normalizedPhone,
      token: code.trim(),
      type: 'sms',
    })
    setBusy(false)
    if (error) Alert.alert('Code not accepted', error.message)
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.authWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Image source={logo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.wordmark}>thought of</Text>
        <Text style={styles.tagline}>
          For the people you think about between conversations.
        </Text>

        {step === 'phone' ? (
          <View style={styles.authForm}>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="Phone number"
              keyboardType="phone-pad"
              autoComplete="tel"
              style={styles.input}
            />
            <Button label={busy ? 'Sending…' : 'Send code'} onPress={sendCode} disabled={busy} />
          </View>
        ) : (
          <View style={styles.authForm}>
            <Text style={styles.small}>Code sent to {phone}</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="Verification code"
              keyboardType="number-pad"
              autoComplete="sms-otp"
              style={styles.input}
            />
            <Button label={busy ? 'Checking…' : 'Continue'} onPress={verifyCode} disabled={busy} />
            <Pressable onPress={() => setStep('phone')}>
              <Text style={styles.link}>Use a different number</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.privacy}>We never import your contacts.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export function ProfileSetup({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function createProfile() {
    const clean = name.trim().slice(0, 40)
    if (!clean) return
    setBusy(true)
    const { error } = await supabase.rpc('set_my_display_name', { p_display_name: clean })
    setBusy(false)
    if (error) return Alert.alert('Could not save profile', error.message)
    onDone()
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.authWrap}>
        <Image source={logo} style={styles.logoSmall} resizeMode="contain" />
        <Text style={styles.heading}>What should people call you?</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          maxLength={40}
          autoFocus
          style={[styles.input, { marginTop: 18, marginBottom: 12 }]}
        />
        <Button label={busy ? 'Saving…' : 'Continue'} onPress={createProfile} disabled={busy} />
      </View>
    </SafeAreaView>
  )
}
