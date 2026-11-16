# App Store and Google Play: Dungeon Crawler

The iOS and Android apps are Capacitor shells (same toolchain as DrawWise) around an **offline bundle of the game**,
not a wrapper of the website. That matters for review: Apple rejects "a repackaged website" (guideline 4.2), and a
self-contained game that plays with no network is the clean answer to it. No accounts, no ads, no tracking, no network
calls; saves stay on the device.

| | |
|---|---|
| Name | Dungeon Crawler |
| Subtitle (iOS, 30 chars) | The Tomb of the Hollow King |
| Bundle / application id | `io.civops.dungeoncrawler` |
| Version | 1.0 (build 1 / versionCode 1) |
| Category | Games: Role Playing (secondary: Adventure) |
| Price | Free |
| Orientation | Landscape only, iPhone, iPad and Android phones/tablets |
| Privacy policy URL | https://dungeon.civops.io/privacy |
| Support / marketing URL | https://dungeon.civops.io |

## Build

```bash
npm run native:sync          # vite build of native/ -> native-dist/, then cap sync ios android
npm run native:ios           # same, then opens Xcode
python3 scripts/native-assets.py   # regenerate icons and splash from public/icon.svg
```

- **iOS:** Xcode > App target > Signing & Capabilities: pick the team, then Product > Archive > Distribute > App Store Connect.
  `ITSAppUsesNonExemptEncryption` is already `false` in Info.plist, so there is no export-compliance question.
- **Android:** `cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew bundleRelease` writes the signed
  `app/build/outputs/bundle/release/app-release.aab` (built and verified 2026-11-16). The SDK is the one DrawWise
  uses, `/opt/homebrew/share/android-commandlinetools` (`android/local.properties`, gitignored). Release signing reads
  `android/keystore.properties` (gitignored, same as DrawWise); the upload key is
  `~/.android-keystores/dungeon-crawler-upload.jks`, password in OpenBrain. Back that file up, and enrol in Play App
  Signing so a lost upload key can be reset.
- **Android narrator:** the Android WebView has no speech engine, so `native/main.tsx` hands the narrator the
  `@capacitor-community/text-to-speech` plugin (Google's en-GB voice). iOS uses the WebView's own voices.
- **Emulator check:** `emulator -avd dc_pixel -no-audio` (AVD made from the installed Android 15 image).
- Bump `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` (Xcode) and `versionName`/`versionCode` (`android/app/build.gradle`) for each upload.

## Listing copy

**Promotional text (iOS, 170):**
A pixel-art tomb crawl with old-school tabletop rules: roll your hero, read the room, mind the traps, and live to spend the gold.

**Description:**

> Somewhere under the tavern cellar, a stair goes down farther than any cellar stair has a right to. At the bottom
> waits the tomb of the Hollow King.
>
> Dungeon Crawler is a pixel-art dungeon crawl built on old-school tabletop rules. Roll four dice and drop the lowest
> for each ability, pick a fighter, thief, wizard or cleric, and go down.
>
> - Real tabletop mechanics: THAC0, saving throws, memorized spells, turning undead, morale and reaction rolls.
> - A narrator reads each room aloud, like a module read at the table, with riddles and hints about what is ahead.
> - Traps you can find before they find you: probe with a ten-foot pole, search the walls, listen at doors.
> - Riddle vaults, hidden doors, closing walls and a tomb that remembers what you did to it.
> - Big monsters, wandering ones, and a king at the bottom who calls his dead to fight for him.
> - Camp to heal and re-memorize, then buy better steel in the tavern.
> - Plays entirely offline. No ads, no accounts, no data collected.
>
> Made for touch: tap to walk, tap to fight, a pad for every action. Music, sound effects and the narrator's voice each
> switch on and off.

**Keywords (iOS, 100 chars):** dungeon,crawler,rpg,roguelike,pixel,retro,tabletop,fantasy,tomb,riddles,traps,offline

**Google Play short description (80):** Pixel-art tomb crawl with old-school tabletop rules, riddles and traps. Offline.

## Questionnaires

- **Apple App Privacy:** Data Not Collected.
- **Google Play Data safety:** no data collected, no data shared.
- **Apple age rating:** Cartoon or Fantasy Violence: Infrequent/Mild; everything else None. Expected result 9+.
- **IARC (Google Play):** fantasy violence against non-human creatures, no blood detail beyond pixel art, no
  gambling, no user interaction, no purchases. Expected: Everyone 10+ / PEGI 7.
- **Ads:** none. **In-app purchases:** none. **Sign-in:** none (so Apple's account-deletion rule does not apply).

## Screenshots (`store/screenshots/`, landscape, taken in the Simulator)

- iPhone 6.9" (2868x1320): title, classes, abilities, tavern, dungeon (`iphone-69-*.png`)
- iPad 13" (2752x2064): title, classes, tavern, dungeon (`ipad-13-*.png`)
- Google Play phone (2640x1320, 2:1 crops of the iPhone set): `play-phone-*.png`; feature graphic `play-feature-1024x500.png`.

## What only Ryan can do (hard gates)

1. **Apple Developer Program**, $99 a year, enrolled under the account that should publish the app.
2. **Google Play Console**: the existing DrawWise organization account (ID 7283189958397625731) hosts this as a
   second app. No new fee, and organization accounts skip the 12-tester, 14-day closed test. Its public developer
   name is "DrawWise" unless renamed.
3. Make `privacy@civops.io` a real mailbox or alias (the privacy page names it).
4. In Xcode, choose the signing team; in App Store Connect and Play Console, create the app records and submit.
