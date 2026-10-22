# Android CNC Pendant

Download `android/apk/CNC-Pendant-preview.apk` (or `/cnc-pendant.apk` on the owner's Pi) to your Android device. Install it using Android's normal APK installation process; you decide whether to allow installation from that source. Open **CNC Pendant**, enter your Pi address, and connect on the machine's network.

The native shell uses Android WebView with no JavaScript-to-native bridge. It keeps the screen awake and hides system bars, loads the live pendant from the Pi, restricts in-app navigation to that origin, and offers a disconnected screen with Reconnect and Machine address actions. Android Back opens Return / Reconnect / Machine address / Exit. System navigation remains available by Android gestures. It does not depend on Brave or maintain its own machine state. Android may still display its own first-use immersive-mode guidance.

Browser-to-app launch uses `cncpendant://open?url=...`; an incoming machine address requires confirmation in the app. No credentials or machine IP are embedded in the APK. Minimum Android 8 (API 26); target API 35. HTTP is permitted for trusted local controllers; HTTPS certificate failures are not bypassed.

## Build

Install a JDK 17 and Android SDK platform 35 / build-tools 35.0.0 through the official Android tools, then:

```sh
python3 tools/build_android.py --jdk-dir /path/to/jdk17 --sdk-dir /path/to/android-sdk
```

The script compiles the native Java source, generates DEX, packages, aligns, signs with a local preview key, and verifies the APK. No Play services or third-party runtime libraries. Local build/signing files are ignored by Git. CI can generate an artifact using the same script.

**Preview signing:** preserve your private build keystore for compatible updates. A build signed by a different preview key cannot upgrade an installed APK without uninstalling it first (which loses only the app's machine-address preference). The committed APK is an initial test build; stable release signing is future work. Source is GPL-3.0-or-later.

The APK has compiled and passed signature verification. Installation, immersive behavior, WebView/network/auth compatibility and touch behavior still need physical Android-device validation. Browser and app controls continue to share the Pi's settings.
