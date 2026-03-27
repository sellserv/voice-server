# Mobile App Setup

## Firebase (Push Notifications)

1. Create a Firebase project at https://console.firebase.google.com
2. Add an Android app with package name `net.sellserv.voice`
3. Download `google-services.json` and place it in `mobile/android/app/`
4. Get the Firebase Admin SDK service account JSON from Project Settings > Service Accounts
5. Set the `FIREBASE_SERVICE_ACCOUNT` env var on your server (paste the full JSON string)

## Building

```bash
npm run build                    # Build SvelteKit
cd mobile && npx cap sync       # Sync to Android
cd android && ./gradlew assembleDebug  # Build APK
```

APK output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

## Installing on Device

```bash
adb install mobile/android/app/build/outputs/apk/debug/app-debug.apk
```
