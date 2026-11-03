# Lumen Browser for Android

Lumen (the phone app from `web/`) as the home screen, plus a browser for watching that:

- blocks requests to ad and tracker sites (StevenBlack hosts list, added at build time as `assets/blocklist.txt`),
- refuses pop-up windows and, after the first few seconds, redirects to other websites,
- starts the film by itself, fills the screen with it in landscape, and reports progress back for Continue Watching
  (`assets/inject.js`, run at document start in every frame).

Built by `.github/workflows/android.yml` and published to the `android-latest` release as `Lumen-Browser.apk`.

**Signing:** the signing key is never stored in the repository. If the Actions secrets `LUMEN_KEYSTORE_B64` (the
keystore, base64) and `LUMEN_KEYSTORE_PASSWORD` are set, every build uses that key and new versions install over old
ones. Without them each build makes its own key, so installing a newer APK means uninstalling the old one first.
