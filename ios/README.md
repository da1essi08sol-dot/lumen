# Lumen Browser for iPhone

Lumen with its own browser built in. When you press **Watch**, the film's website opens with:

- ad and tracker websites blocked (about 78,000 of them, using Safari's own content blocking),
- pop-up windows refused, and redirects to other websites stopped after the first few seconds,
- "You've won!" alerts swallowed and jumps to the App Store or other apps blocked,
- the film started by itself and stretched to fill the screen in landscape.

Tap the screen to show the **✕** button (or swipe in from the left edge) to go back to Lumen. Your place is saved
for Continue Watching.

## Installing it (free, no App Store)

Apple only lets apps from outside the App Store onto an iPhone if they're signed with an Apple ID. **AltStore** does that
with your own free Apple ID, from a Windows PC. A free Apple ID's apps last **7 days**; AltStore renews them by itself
whenever your iPhone and PC are on the same Wi-Fi with AltServer running, so in practice you set it up once.

**On the PC (once):**

1. Install **iTunes** and **iCloud** from Apple's website, *not* the Microsoft Store versions:
   apple.com/itunes/download/win64 and support.apple.com/HT204283.
2. Download **AltServer for Windows** from **altstore.io**, unzip it and run the setup. Open AltServer; it sits in the
   tray by the clock.
3. Plug your iPhone into the PC with a cable. Unlock it and tap **Trust**. In iTunes, tick
   **Sync with this iPhone over Wi-Fi** and click **Apply** (that's what lets AltStore renew apps without the cable).
4. Click the AltServer tray icon › **Install AltStore** › your iPhone. Sign in with your Apple ID (it's only sent to
   Apple).

**On the iPhone (once):**

5. **Settings › General › VPN & Device Management** › your Apple ID › **Trust**.
6. On iOS 16 or later: **Settings › Privacy & Security › Developer Mode** › on, and restart when asked.

**Installing Lumen:**

7. On the iPhone, open
   [github.com/da1essi08sol-dot/lumen/releases/tag/ios-latest](https://github.com/da1essi08sol-dot/lumen/releases/tag/ios-latest)
   in Safari and tap **Lumen-Browser.ipa** to download it.
8. Open **AltStore** › **My Apps** › **+** (top left) › **Downloads** › **Lumen-Browser.ipa**.
9. Lumen appears on your home screen. Open it and add your TMDB key (or bring your settings from the laptop:
   Settings › **Bring from your laptop**).

**Updating:** download the newest Lumen-Browser.ipa and install it the same way; it replaces the old one and keeps your
settings.

If AltStore says the app has expired, open AltStore with the PC on and AltServer running, and tap **Refresh All**.

## Lumen on your TV, with another phone as the remote (Lumen Box)

Your iPhone can be the box behind the TV: the TV shows Lumen's full TV interface (the same one as on the laptop), films
play on the TV in this ad-free player, and another phone on the same Wi-Fi is the remote.

1. Put the iPhone and the Apple TV (or any AirPlay TV) on the same Wi-Fi.
2. Open **Lumen** on the iPhone, then open **Control Centre › Screen Mirroring** and choose the Apple TV.
   The TV switches to Lumen's TV interface by itself (the iPhone keeps its own screen), and the iPhone shows
   **Lumen is on your TV · Remote**. A Lightning-to-HDMI adapter works the same way.
3. **The other phone:** on the TV, open **Remote** (top right). Point the other phone's camera at the code (or open
   the address shown, e.g. `http://192.168.0.23:8787/remote/`, in Safari) and enter the 6-digit code. It gets the Lumen
   Remote: d-pad, Back, Home, Play/Pause, typing and brightness. The first time, the iPhone asks whether Lumen may find
   devices on your local network: choose **Allow**.
4. **While a film plays on the TV:** OK or Play/Pause pauses it, left/right skips 10 seconds (up/down a minute), and
   Back or Home stops it and saves your place for Continue Watching.

Keep Lumen open on the iPhone while it's on the TV (you can lock it once the film is playing only if Screen Mirroring
stays on). Volume is the Apple TV's (or the TV's) own remote, or the iPhone's volume buttons.

**The TV look on the phone itself:** in Lumen's Settings, **TV look › Use the TV Look**, then turn the phone sideways.
Tap to select, swipe to move through rows, and swipe in from the left edge (or tap ‹) to go back. Settings › **Use the
Phone Layout** switches back.

## How it's built

`project.yml` (XcodeGen), Swift and WKWebView, iOS 15 or later. Lumen Box: `TVScene.swift` (the TV as a screen of its own), `Box.swift` (pairing, remotes, what's on screen) and `LanServer.swift` (the remote's web page on port 8787 and its live link on 8788, home Wi-Fi only). `.github/workflows/ios.yml` builds an unsigned
`Lumen-Browser.ipa` on GitHub's macOS runners and publishes it to the `ios-latest` release; AltStore signs it at install.
The home screen is Lumen Web (da1essi08sol-dot.github.io/lumen), so Lumen itself updates without reinstalling.
The player script (`inject.js`) and the blocklist are shared with the Android app.
