# thought of native setup

This folder is a complete Expo SDK 57 project connected to the existing Thought Of Supabase backend.

## Development

```bash
cp .env.example .env
npm install
npm start
```

The development Supabase test-phone configuration can be used while SMS verification is not ready for public release. Remove fixed test OTP entries before release.

## Native notifications

The source is wired for Expo push registrations and the existing `send-thought-notification` and request notification paths. Registration begins after this project has an EAS project ID. Remote push must be verified in an EAS development/TestFlight build, not treated as an Expo Go test.

## TestFlight

`eas.json` is included. The remaining one-time setup is:

1. Connect this project to an Expo/EAS account.
2. Add the EAS project ID to the generated Expo config.
3. Connect an Apple Developer/App Store Connect account for bundle ID `com.thoughtof.app`.
4. Create the production iOS build.
5. Submit the build to TestFlight.
6. Verify native realtime, notification presentation/taps, profile photo access, Reach Out, and the locked app icon on a physical iPhone.

## Product constraints carried into native

- Thoughts are text-only and capped at 60 characters.
- We never import contacts.
- Add-someone responses stay generic and do not reveal whether a phone number is registered.
- “Text them” remains available after every add-person request.
- No read receipts, typing indicator, public feed, follower counts, or app badge count.
- Rethink remains server-enforced at about 10 seconds.
- Silent block remains private and does not expose the block state to the blocked person.
