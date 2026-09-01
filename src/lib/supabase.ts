import 'react-native-url-polyfill/auto'
import 'expo-sqlite/localStorage/install'
import { createClient } from '@supabase/supabase-js'

// These are public client-side Supabase values. Keep environment overrides for
// local/EAS environments, with production-safe fallbacks for GitHub/Launch builds.
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://dlaxhooizwxitjxcjyyf.supabase.co'
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_cnNOjkZ1yi5uAPdFv8SDJQ_i_HwSAbA'

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
