# Lumen — a TV interface for Windows

Lumen turns a Windows laptop or mini PC plugged into your TV into a full-screen, remote-driven home for films and TV.
Your phone becomes the remote through a web page; nothing to install on the phone.

## Install

1. Download **Lumen-Setup-<version>.exe** from the [Releases page](https://github.com/da1essi08sol-dot/lumen/releases/latest) and open it.
   - Windows may say **“Windows protected your PC”** because Lumen isn't code-signed yet. Choose **More info › Run anyway**.
2. Lumen installs itself (no admin rights or Node.js needed), opens full screen, and walks you through:
   - a free **TMDB key** for posters and film details (themoviedb.org › Settings › API › Create › Developer),
   - **pairing your phone**: point the phone's camera at the code on the TV.
3. The first time a phone connects, Windows asks whether Lumen may use the network. Choose **Private networks** and **Allow**.
   Make sure your Wi-Fi is set to **Private** (Settings › Network & internet › Wi-Fi › your network).

Lumen keeps your settings, folders, sign-ins and Continue Watching in `%LOCALAPPDATA%\Lumen`, separate from the program,
so updating or reinstalling never touches them. Remove Lumen from **Settings › Apps**.

**Coming from Lumen 1.x (the folder version)?** Install 2.0 and open it once: it finds your old Lumen folder and copies
your settings, folders, phone pairing and sign-ins across. The old folder is left as it was; delete it when you're happy.
If it can't find it, use the tray icon › **Import settings from an older Lumen…**

## Updates

Lumen checks for a new version every few hours. When there is one, the TV shows a note: go to **Settings › Update Lumen**
and press **Update Now**. Lumen downloads it, closes for a few seconds and opens again on the new version.
You can also put a `Lumen-Setup-<version>.exe` in your Downloads folder; Lumen spots it the same way.

## The tray icon

Lumen sits in the system tray (bottom right, by the clock). From there you can show Lumen, choose which screen it uses
(handy when the laptop's own screen and the TV are both on), turn **Start Lumen when I sign in** on or off, check for
updates, open the data folder, or quit. Closing the TV window (Alt + F4) only hides it; your phone can bring it back.

## What's new in 2.0.2

- **Privacy** page (Settings › About › Privacy, and [PRIVACY.md](PRIVACY.md)): what Lumen keeps and who it talks to.
- Easier to read: faint text has stronger contrast on the TV and the phone.
- Lumen follows your computer's and phone's own "reduce motion" setting.
- Icon-only buttons have names for screen readers.

## What's new in 2.0.1

- **Fonts.** Settings › Personal › **Fonts** changes the look of every title: **Classic** (the original Lumen look, now the default
  again), **Cinema** (the tall, condensed 2.0 look), **Bold**, **Signage** and **Serif**. Move left and right to see each one
  on a small copy of Home before you choose. Your phone follows the TV.

## What's new in 2.0

- **One app.** Lumen is now a normal Windows program with an installer: no Node.js, no scripts, no console windows.
  It starts faster, opens its own full-screen window, and updates itself.
- **A new look.** A darkened-cinema design: the thing you're on is lit (your colour pools under it and the rest of the row dims),
  tabs with a bar of light, and a choice of fonts (Settings › Fonts).
- **Sleep timer.** Settings › Sleep Timer, or the phone's Now Playing screen. The sound fades out over the last minute,
  whatever is playing stops, the screen turns off, and the volume goes back to normal for next time.
- **Subtitles and audio languages** for videos on your computer: press **Down** while one plays. Lumen finds `.srt`/`.vtt` files
  with the same name (e.g. `Film.en.srt`, or in a `Subs` folder) and remembers the language you pick.
- **Up Next.** When an episode on your computer ends, the next file in the folder starts after 10 seconds (Stop cancels).
- **Each film remembers its Watch website.** With more than one Watch website, a film's main button is the one you used last time.
- **Game controllers.** Plug in or pair an Xbox or PlayStation controller: D-pad/stick moves, A selects, B goes back, Menu opens options.
- **Screensaver.** After 10 minutes with nothing happening, film artwork drifts across the screen with the time (Settings › Screensaver).
- **Snappier.** Holding a direction makes the highlight keep up with the remote; films you rest on are prepared in the background so they open faster.
- **Safer phone access.** Lumen only answers devices on your own home network, even if something on the router were opened up.
- **Phone:** haptic taps on iPhone, the new type, and the sleep timer.
- **New installs start with an empty library** (existing folders are kept).

## Using it

| Remote / keyboard | Does |
|---|---|
| Arrows / d-pad (or swipe on the d-pad) | Move the highlight |
| OK / Enter | Select |
| Back / Esc / Backspace | Back one step; from the top of a page, jump to the tab bar |
| Home | Close anything open and go to Home |
| Play/Pause / Space | Play or pause videos and trailers |
| Vol − / Vol + / the volume meter | Change or mute the **laptop's real system volume** (sound over HDMI follows it) |
| Show Lumen (phone) | Close any open website or VLC and bring the interface back; reopens the TV window if it was closed |

- **Sections**: Home, Movies, TV Shows, Free to Watch, Recently Added, My Library, Search (magnifier), Settings (gear).
- **Movies and TV Shows** open with a large rotating featured title, like Apple TV. Left/right on its buttons changes the title.
- **Folders**: Star Wars and Indiana Jones are ready-made in My Library.
  - On any film, choose **Add to Folder** to add it to a folder, remove it, or make a new folder.
  - Inside a folder you can **Remove Titles**, **Rename**, or **Delete Folder**. Deleting asks you to confirm first.
  - A film that belongs to a series shows the whole collection; **Save as Folder** turns it into a folder in one step.
- **Backgrounds**: Settings → Background → Style cycles through Film Artwork, My Picture, Graphite and Black. Add photos from the iPhone's **Backgrounds** tab (iPhone HEIC photos are converted automatically) or from `/setup` on the laptop.
- **Search**: type with the on-screen keyboard, a USB keyboard, or the phone's **Keyboard** tab.
- **Your videos**: My Library → Videos on This Computer lists the laptop, Videos, Downloads and any USB or external drive.
  - Open a folder and choose **Add to Library** to pin it. New files in pinned folders then appear in Recently Added.
  - MP4, MKV, WebM and MOV files using H.264, VP9 or AV1 play inside Lumen, with resume.
  - Other formats (AVI, DivX, HEVC/x265, DTS audio) open in **VLC** if it's installed (free, from videolan.org).
- **Website tiles**: Free to Watch → Add a Website (or Settings, or the phone's Setup tab). The site opens full screen.
  - Control it with the phone's **Trackpad** and **Keyboard** tabs.
  - **Home** on the remote closes it.

## Brightness

Settings → Display → **Brightness**, or the brightness bar on the phone's Remote tab (tap or drag anywhere, or hold the sun buttons). Any level from 1 to 100.
Lumen dims everything it shows itself, including films playing in websites, so it works on any TV. 1 is very dim, 100 is normal.
**Also Use the TV's Own Backlight** additionally asks the TV to change its backlight. Only some TVs allow this over HDMI.

## Skipping without a black screen

Lumen fills the screen by stretching the film's player over the (already full-screen) window instead of using the browser's own full-screen mode, which is where some graphics drivers turn the picture black after a skip. When you skip, Lumen notices the jump and takes the film out of full screen and straight back in from outside the page (the fix you'd do by hand), however the site's full screen was entered.

Settings → Watch Button → **Software Video Decoding** (off by default) is a last resort if skipping still turns the picture black. Some video formats (such as H.265/HEVC) can only be played by the graphics chip, so with this on they'd give sound but no picture. Lumen checks for that a few seconds into every film: if there's sound but no picture, it turns this setting off and reopens the film at the same moment.

## Sign-ins are remembered

Every website (BBC iPlayer, Channel 4, ITVX, your Watch site…) opens in the same browser (Brave if it's installed, otherwise Edge), so you sign in once. When you press Home, Lumen closes the browser properly so it saves your sign-ins first; a forced close could lose a sign-in you'd just made. Sign-ins are kept in Lumen's data folder (tray icon › Open Lumen's data folder).

## Closing Lumen

The **power button** in the top-left corner (next to the clock) closes Lumen: it asks "Close Lumen?", shows a goodbye screen, then closes the TV screen and any open website (Lumen's own browser windows only; your normal browser is left alone), then quits Lumen. To start again, open **Lumen** from the Start menu or desktop. Only the TV itself can do this, not the phone remote, so Lumen can't be switched off from a phone it can't then restart.

## LumenTV start-up

When Lumen opens, the screen fills with your colour, a floor stretches away to the horizon, and as your start-up sound plays the LumenTV writing rises up from below the screen and comes to rest standing on the floor with a soft shadow beneath it. Shortly after the last hit, the sound fades out while the picture fades into the menu, so they arrive together (about 4 seconds in all). Closing Lumen shows the same scene, with the writing rising into place while your shutdown sound plays and the screen fades to black, and Lumen closes once the sound has completely finished. Press any key to skip.

**Your own sounds:** the start-up and shutdown sounds are the files `resources\app\public\tv\sounds\startup.mp3` and `shutdown.mp3` inside Lumen's program folder. Swap in any other mp3 with the same name and Lumen times the opening and the close to it by itself. Delete them to go back to Lumen's built-in sound.

## Make it yours

- **Settings → Personal** (or the phone's Setup tab):
  - **Your Name**: Home greets you ("Good evening, Sam") and adds a row picked from your own folders, reshuffled daily.
  - **Colour**: Moonlight, Amber, Rose, Mint, Sky or Lilac. It tints the highlight glow, buttons, tabs and progress bars.
  - **Sounds**: soft sounds as you move, select, go back or reach the edge of a row. Seven styles: **Soft**, **Crisp**, **Glass**, **Arcade** (8-bit), **Marimba** (wooden), **Cosmic** (synth) and **Bubble**, with their own volume.
- Buttons respond when pressed (a quick squish and a flash of light), and the highlight gives a small nudge when you can't go any further.
- On the phone remote, presses give a light tap you can feel (Android, and iPhone with iOS 18 or later).

## Pressing Watch: from film to playing in one step

When you press **Watch** (or a Continue Watching card), Lumen:
1. shows a loading screen with the film's title, which carries on inside the browser so you don't see the site building;
2. blocks pop-up ads and stops the page being redirected to ad sites (Settings → Watch Button → Block Pop-ups & Redirects);
3. presses play for you and makes the video fill the screen (Settings → Watch Button → Press Play & Full Screen);
4. saves how far you got, so the film appears in **Continue Watching** on Home and jumps back to your spot next time. Press **Menu** on a Continue Watching card to remove it.

If a site's player doesn't start by itself after about 20 seconds, the loading screen lifts so you can press play yourself.
**Film not found:** if the film's page doesn't exist on the site (a 404, or a page that says "not found"), the loading screen offers two buttons after 2 seconds: **Open the website anyway** (goes to the site's home page so you can search it yourself) or **Back to Lumen**. Use left/right and OK on the remote.

The loading screen shows the film's artwork, a diagonal LumenTV pattern, the LumenTV logo and what's happening ("Finding the film", "Pressing play").
Website tiles get the same pop-up blocking and loading screen.

**Ad-blocker extension:** Lumen's Brave is separate from your own Brave, so your extensions aren't in it.
Settings → Watch Button → **Add an Ad-blocker Extension** opens Lumen's Brave in a normal window on the extension store. Install the same blocker you use, then press Home. It stays installed.


## Phone remote

- Glass d-pad with a lit rim in your colour; presses light up, ripple and give a tap you can feel. Swipe on it to move too.
- Back, Home, Play/Pause and **Options** (the Menu button: add to a folder, or remove from Continue Watching).
- Volume: **tap or drag the bar** to set it, **press and hold the bar** to mute or unmute, or tap or hold − / + to step.
- Reliable presses: the phone checks its connection every few seconds and reconnects at once. Presses made while it reconnects are sent as soon as it's back instead of being lost, and quick volume presses are combined so the laptop doesn't fall behind.

## Colours

Settings → Personal → **Colour** cycles through Moonlight, Amber, Rose, Mint, Sky, Lilac and five reds (Red, Scarlet, Crimson, Cherry, Coral).
**Custom Colour** takes any hex code (e.g. `#B3001B`), and the phone's Setup tab has a colour wheel; the TV follows as you drag.
Dark colours automatically get white text.

## Where films can be watched

TMDB only supplies information and artwork, not the films themselves. Lumen keeps the two apart:

- A **Watch on …** button appears only when TMDB's UK listings (sourced from JustWatch) say the title is on one of your enabled free services: **BBC iPlayer, ITVX, Channel 4, My5, YouTube, Tubi, Pluto TV**.
- Paid-only services are shown as information, not as buttons.
- **Watch button (your own link)**: every film and show has a **Watch** button. Set the website in Settings → Watch Button, the phone's Setup tab, or `/setup`. If none is set, Watch does nothing.
  - Type the website, e.g. `movies.com`. The title is added in lowercase with spaces as `-`, plus a `/` at the end: *Star Wars: Episode III - Revenge of the Sith* opens `https://movies.com/star-wars-episode-iii-revenge-of-the-sith/`.
  - Punctuation and accents are dropped: *Ocean's Eleven* → `oceans-eleven`.
  - To put the title elsewhere, write `{name}` where it goes (`{year}` adds the year); the address is then used exactly as typed.
  - It opens full screen on top of Lumen, in **Brave** if it's installed (Brave Shields, its built-in ad blocker, is on by default); otherwise Edge. **Home** on the remote closes it.
- **BBC iPlayer, Channel 4 and Tubi** open with a search for the exact title.
- **ITVX, My5 and Pluto TV** open on their home page. Search there with the phone's Keyboard tab. These services don't publish a search address that could be used reliably.
- **YouTube** opens YouTube's TV-style interface, which works with the remote's arrows. Trailers play inside Lumen.
- BBC iPlayer requires a TV licence. Most services ask you to sign in once; sign-ins are remembered in Lumen's own browser profile (`data\web-profile`).

**Not included: TVIDS.net, ramoflix.net and doraby.com.** They stream films without the rights to them, so Lumen does not link films to them or to any similar site.


## Privacy

Lumen has no account, no adverts, no analytics and no tracking, and it sets no cookies. Everything it keeps stays on your
computer. The details, including which outside services it talks to, are in [PRIVACY.md](PRIVACY.md).

## Accessibility

- Everything works with arrow keys, OK and Back (remote, keyboard or game controller); nothing needs a mouse.
- Text and controls are designed for reading from a sofa, and faint text meets the WCAG AA contrast level on Lumen's dark background.
- **Settings › Reduce Motion** turns animations down; Lumen also follows Windows' and the phone's own "reduce motion" settings.
- Buttons that only show an icon have names for screen readers (Narrator on Windows, VoiceOver on iPhone).

## Help and feedback

Found a problem or have an idea? Open an issue on [GitHub](https://github.com/da1essi08sol-dot/lumen/issues).

## For developers

```
npm install          # Electron + electron-builder
npm start            # run the app
npm test             # API, media, update and import tests (no Electron needed)
npm run server       # just the server, e.g. LUMEN_MOCK=1 LUMEN_SYSTEM=mock npm run server for test data
```

Releasing: bump `version` in `package.json`, commit, then tag and push (`git tag v2.0.1 && git push --tags`).
GitHub Actions builds `Lumen-Setup-<version>.exe` and publishes the release; every Lumen then offers the update.

- `electron/` — the desktop app: window, tray, updates, importing 1.x settings
- `server/` — the Lumen server (TMDB, phone remote, local videos, Windows helper, the Watch helper for websites)
- `public/` — the TV interface, the phone remote and the phone app
- `windows/` — the zip installer and uninstaller (only needed without the GitHub installer)

Film data and images: TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
Type: Bricolage Grotesque (SIL Open Font License, `public/shared/fonts/OFL-Bricolage.txt`).
