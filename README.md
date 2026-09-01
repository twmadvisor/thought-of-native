# thought of — native iPhone build

This is the native Expo/React Native source for Thought Of, migrated from the proven browser prototype and connected to the existing Supabase backend.

## Native product behavior now implemented

- Phone OTP authentication and profile setup
- Your People with private circular profile photos / initials fallback
- Filled thought dots for unopened incoming Thoughts
- Text-only Thoughts with a 60-character limit
- Stable organic Thought bubble shapes
- Quick reactions: 😌 🥰 ❤️ 👀 👋 👍
- Expanded emoji picker via ＋
- One reaction per person per Thought, with toggle/change behavior
- Tap-to-reveal timestamps
- 10-second Rethink, still server-enforced
- True Supabase Realtime subscriptions for Thoughts and reactions while a history is open
- Native Expo push registration using the existing Thought notification Edge Function
- Notification taps route to the matching person; request notifications route to Requests
- Add-by-exact-phone flow with generic “Request sent.” response
- “Text them” invitation after every request, without disclosing registration status
- Private Groups, including renamed Your People, custom groups, and multi-group membership
- Reach Out to Text/iMessage and optional WhatsApp
- Account display-name editing
- Private profile-photo upload
- WhatsApp Reach Out preference
- Remove / private one-year archive / reconnect
- Silent block / unblock behavior through the existing backend RPC
- Read-only archived Thought history
- Delete only your own archive
- No contact import, typing indicator, read receipts, feed, follower counts, or app badge count

## Locked media behavior

Thoughts are text-only. Profile photos are identity only and never attach to a Thought.

The local project bundle contains the exact locked Thought Of logo supplied for the project. The logo is not regenerated or redrawn.

## Remaining release work

The product code is now at the point where the next milestone is an EAS iOS build and TestFlight install. That one-time release setup requires connecting an Expo/EAS account and an Apple Developer/App Store Connect account, then verifying native signing, push credentials, and the first build on-device.
