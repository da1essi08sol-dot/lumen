# Lumen — TV interface for the Sharp AQUOS

A full-screen, remote-driven entertainment interface for your TV, run from the Dell Inspiron 5630 over HDMI. Your iPhone 14 becomes the remote through a web page; no app install needed.




## What's new in 1.9.1

- **Open in Brave on the iPhone.** When you watch on the phone (**Here**), the **Brave** button at the top sends the film to the Brave app, whose Shields block ads and pop-ups. Use it when a website won't play inside Lumen (for example, it complains about being sandboxed). Websites that refuse to be shown inside Lumen offer **Open in Brave** straight away. If Brave isn't installed, Lumen offers the App Store link or Safari.

## What's new in 1.9

- **Lumen on your phone.** Open the Lumen Remote and tap **Browse** (or go to `/phone/` on the same address). Everything is there with touch: Home, Films, TV Shows, Search, your Library and folders, and every film's page.
  - **On TV** starts the film on the TV and your phone becomes its controls (Now Playing): play/pause, skip 10 or 30 seconds, drag to any point, volume, and Stop. You never leave Lumen.
  - **Here** plays it on the phone inside Lumen when the website allows that (pop-ups and redirects are blocked in there). Websites that don't allow being shown inside other apps open in your browser instead — Lumen tells you first.
  - Tip: in Safari, Share › **Add to Home Screen** makes Lumen open full screen like an app.
- **Save the right page for a film.** If a film says "not found", choose **Open the website anyway**, find the film, then press **★ Use this page for …** (bottom right, or **Use this page for the film** on the phone's Now Playing). From then on that film's Watch button goes straight there. **Forget Saved Page** on the film's page undoes it.

## What's new in 1.8

- **Multiple Watch buttons.** Settings › Watch Buttons › Add a Watch Website. Add as many sites as you like; every film then shows a "Watch on …" button for each. Continue Watching resumes on the site you were watching on. Press a site in Settings to change its link or name (clear the link to remove it).
- **No more black screen or "locked" full screen.** Lumen no longer uses the website's full-screen mode. The browser window already covers the TV, so Lumen stretches the player over the whole window instead: it looks the same, nothing can get stuck, and the player's own buttons work. The player tells Lumen when you skip or fast forward; only then does Lumen refresh the picture (and check it once a few seconds later). While the film simply plays, Lumen leaves the page completely alone, so nothing flashes.
- **Home banner.** Settings › Display › Home Banner: a fresh shuffle of films recommended for you every time, or the films from one of your folders.
- **Sounds.** The original Lumen sound styles (Soft, Crisp, Glass, Arcade, Marimba, Cosmic, Bubble) are back.

## Install (first time)

1. Unzip **Lumen-TV.zip** and put the **Lumen** folder somewhere it can stay (for example Documents).
2. Double-click **Install Lumen** inside it. It:
   - checks Node.js and installs it if needed,
   - adds **Lumen** and **Update Lumen** to your desktop and Start menu (with the Lumen icon),
   - asks whether Lumen should start when you sign in,
   - lets your iPhone remote through Windows Firewall (Windows asks for permission once),
   - starts Lumen.

There's also a **Lumen** shortcut with the icon right inside the Lumen folder. Drag it to the desktop, or right-click it and choose **Pin to taskbar**. It just opens Lumen; if Lumen is already running it brings it up without restarting.

## Update

1. Download the new **Lumen-TV.zip** (leave it in Downloads).
2. Either double-click **Update Lumen** on your desktop, **or** on the TV go to **Settings › Update Lumen**.

That's it. Lumen closes, puts in the new version and opens again. Your settings, phone pairing, sign-ins and Continue Watching are kept, because the `data` folder is never touched.
Coming from an older Lumen without these shortcuts? Unzip the new download and double-click **Update Lumen** inside the unzipped folder. It finds the Lumen you already use and updates that one.

## What you need to do (about 15 minutes, once)

1. **Install Node.js** — the LTS version from nodejs.org (accept the defaults). Lumen uses no other packages.
2. **Unzip** this folder somewhere permanent, e.g. `C:\Lumen`.
3. **Allow the iPhone in** — double-click `windows\Allow iPhone access.cmd` and approve the admin prompt. It opens port 8787 on *private* networks only. Make sure your Wi-Fi's network profile is set to **Private** (Settings → Network & internet → Wi-Fi → your network).
4. **Start it** — double-click `windows\Start Lumen.vbs`. The TV interface opens full screen on whichever display is the main one. To put it on the TV, press `Win + P` → **Second screen only**, or set the TV as the main display.
5. **Get a free TMDB key** (for posters and film details):
   - Sign up at themoviedb.org/signup and confirm your email.
   - Go to themoviedb.org/settings/api → **Create** → **Developer**, and describe it as a personal, non-commercial TV interface.
   - Paste either the **API Key** or the **API Read Access Token** at `http://localhost:8787/setup` on the laptop, or later in the iPhone remote's **Setup** tab.
6. **Pair your iPhone**:
   - On the TV, select the remote icon (top right).
   - Point the iPhone camera at the QR code and tap the link, then **Pair**, then **Start Remote**.
   - Tip: in Safari, Share → **Add to Home Screen** gives you a full-screen remote. The Home Screen icon has its own storage, so pair once more from it.
7. **Autostart (optional)** — double-click `windows\Install autostart.cmd`. Lumen then opens every time you sign in to Windows.

To exit the full-screen TV window press **Alt + F4**. To stop the server, run `windows\Stop Lumen.cmd`.

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

Every website (BBC iPlayer, Channel 4, ITVX, your Watch site…) opens in the same browser (Brave if it's installed, otherwise Edge), so you sign in once. When you press Home, Lumen closes the browser properly so it saves your sign-ins first; a forced close could lose a sign-in you'd just made.

## Closing Lumen

The **power button** in the top-left corner (next to the clock) closes Lumen: it asks "Close Lumen?", shows a goodbye screen, then does exactly what **Stop Lumen** does: closes the TV screen and any open website (Lumen's own browser windows only; your normal browser is left alone), then stops the server. To start again, use **Start Lumen** on the laptop. Only the TV itself can do this, not the phone remote, so Lumen can't be switched off from a phone it can't then restart.

## LumenTV start-up

When Lumen opens, the screen fills with your colour, a floor stretches away to the horizon, and as your start-up sound plays the LumenTV writing rises up from below the screen and comes to rest standing on the floor with a soft shadow beneath it. Shortly after the last hit, the sound fades out while the picture fades into the menu, so they arrive together (about 4 seconds in all). Closing Lumen shows the same scene, with the writing rising into place while your shutdown sound plays and the screen fades to black, and Lumen closes once the sound has completely finished. Press any key to skip.

**Your own sounds:** the start-up and shutdown sounds are the files `public\tv\sounds\startup.mp3` and `shutdown.mp3`. Swap in any other mp3 with the same name and Lumen times the opening and the close to it by itself. Delete them to go back to Lumen's built-in sound.

## Make it yours

- **Settings → Personal** (or the phone's Setup tab):
  - **Your Name**: Home greets you ("Good evening, Sam") and adds a row picked from your own folders, reshuffled daily.
  - **Colour**: Moonlight, Amber, Rose, Mint, Sky or Lilac. It tints the highlight glow, buttons, tabs and progress bars.
  - **Sounds**: soft sounds as you move, select, go back or reach the edge of a row. Seven styles: **Soft**, **Crisp**, **Glass**, **Arcade** (8-bit), **Marimba** (wooden), **Cosmic** (synth) and **Bubble**, with their own volume.
- Buttons respond when pressed (a quick squish and a flash of light), and the highlight gives a small nudge when you can't go any further.
- On the phone remote, presses give a light tap you can feel (Android, and iPhone with iOS 18 or later).

## Pressing Watch: from film to playing in one step

When you press **Watch** (or a Continue Watching card), Lumen:
1. shows a loading screen with the film's title, which carries on inside the browser so you never see the site building;
2. blocks pop-up ads and stops the page being redirected to ad sites (Settings → Watch Button → Block Pop-ups & Redirects);
3. presses play for you and makes the video fill the screen (Settings → Watch Button → Press Play & Full Screen);
4. saves how far you got, so the film appears in **Continue Watching** on Home and jumps back to your spot next time. Press **Menu** on a Continue Watching card to remove it.

If a site's player doesn't start by itself after about 20 seconds, the loading screen lifts so you can press play yourself.
**Film not found:** if the film's page doesn't exist on the site (a 404, or a page that says "not found"), the loading screen offers two buttons after 2 seconds: **Open the website anyway** (goes to the site's home page so you can search it yourself) or **Back to Lumen**. Use left/right and OK on the remote.

The loading screen shows the film's artwork, a diagonal LumenTV pattern, the LumenTV logo and what's happening ("Finding the film", "Pressing play").
Website tiles get the same pop-up blocking and loading screen.

**Ad-blocker extension:** Lumen's Brave is separate from your own Brave, so your extensions aren't in it.
Settings → Watch Button → **Add an Ad-blocker Extension** opens Lumen's Brave in a normal window on the extension store. Install the same blocker you use, then press Home. It stays installed.

This needs **Node.js 22 or newer** (the current LTS from nodejs.org is fine).

## Phone remote

- Glass d-pad with a lit rim in your colour; presses light up, ripple and give a tap you can feel. Swipe on it to move too.
- Back, Home, Play/Pause and **Options** (the Menu button: add to a folder, or remove from Continue Watching).
- Volume: **tap or drag the bar** to set it, **press and hold the bar** to mute or unmute, or tap or hold − / + to step.
- Reliable presses: the phone checks its connection every few seconds and reconnects at once. Presses made while it reconnects are sent as soon as it's back instead of being lost, and quick volume presses are combined so the laptop never falls behind.

## Colours

Settings → Personal → **Colour** cycles through Moonlight, Amber, Rose, Mint, Sky, Lilac and five reds (Red, Scarlet, Crimson, Cherry, Coral).
**Custom Colour** takes any hex code (e.g. `#B3001B`), and the phone's Setup tab has a colour wheel; the TV follows as you drag.
Dark colours automatically get white text.

## Updating Lumen

Copy the new files **over** your existing Lumen folder and keep the `data` folder. It holds your settings, phone pairing, sign-ins and Continue Watching.
Then run **Start Lumen**. It now always restarts the server and the TV window, so the new version is definitely the one running. If an old server keeps running after an update, settings such as the new colours don't save.

## Faster start-up

- Lumen saves what it last loaded from TMDB and shows it instantly next time, then refreshes it quietly in the background.
- The start script checks for the server in milliseconds instead of seconds, and the server answers on both IPv4 and IPv6. Previously Windows could wait about 2 seconds per connection before falling back.

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

## How it fits together

```
iPhone (Safari)  ──Wi-Fi──►  Lumen server on the laptop (Node.js, port 8787)  ◄──  TV page (Edge kiosk, localhost only)
   /remote/                      • TMDB proxy — API key never leaves the laptop      /tv/
   pairing code → token          • WebSocket hub for remote commands
                                 • Windows helper (PowerShell): Core Audio volume,
                                   key/mouse input for websites, window focus
                                 • Local video streaming with byte ranges
```

- **Security**:
  - The TV page and local file access only work from the laptop itself.
  - Phones need a one-time 6-digit code shown on the TV. Codes expire after 5 minutes, allow 5 tries, and repeated wrong attempts are rate-limited.
  - Each paired phone gets a long random token; only a hash of it is stored. Unpair phones in Settings → iPhone Remotes.
  - The TMDB key is kept in `data\store.json` on the laptop and is never sent to the TV page or the phone.
  - Traffic on your home Wi-Fi is not encrypted, so use it on a trusted network.
- **Data**: settings, folders, history, playback positions and paired phones live in `data\store.json`. Back up that file to keep your folders.

## Moving to a mini PC later

Copy the whole folder, including `data\`, to the mini PC:

- **Windows mini PC**: works exactly the same.
- **Linux mini PC**: there's a best-effort backend. Install `pactl` for volume and `xdotool` for keys and trackpad, use Chromium, and start it with `node server/index.js` plus a Chromium `--kiosk http://localhost:8787/tv/` window.

## Testing status — what was and wasn't tested

Tested here, in a Linux test environment with Chrome at 1920×1080 and an emulated iPhone 14:

- **Navigation and folders**: every screen driven with arrow, OK and Back keys only, including creating, renaming and deleting folders, adding and removing films, and the on-screen keyboard.
- **iPhone pairing and remote**:
  - Wrong codes are rejected; the right code pairs.
  - The d-pad, OK, Back, Home, volume, mute, keyboard-to-search and Show Lumen all work.
  - Website control works: arrow keys, OK and clicks are forwarded, and Home closes the site.
- **Security**: the TV page, API, WebSocket and file streaming all refuse network access without a valid pairing.
- **Local video**: playback, seeking, pause, resume prompt, and the friendly message for formats the browser can't play.
- **QR codes**: decoded successfully with a separate QR reader.

**Not yet tested on Windows** (it couldn't be run there from this workspace):

- The PowerShell volume and keystroke helper (`server\system\win-helper.ps1`)
- Edge kiosk launching and the autostart scripts
- VLC launching
- Brave launching
- YouTube's TV-style interface

All of these use standard, well-documented Windows APIs and browser switches, but they need a first run on your laptop. Film data was also tested against a stand-in for TMDB, because TMDB is unreachable from the test environment; your real key will show real posters.

Film data and images: TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
