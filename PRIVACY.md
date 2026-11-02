# Lumen and your privacy

Lumen is a program on your own computer. It has no account, no adverts, no analytics and no tracking, and nobody,
including whoever made Lumen, receives information about you or what you watch.

## What Lumen keeps, and where

Everything is stored on your computer in `%LOCALAPPDATA%\Lumen` (Windows) and is never uploaded:

- your settings (name, if you add one; colour; fonts; Watch websites; TMDB key),
- your folders, recently viewed films and Continue Watching positions,
- the phones you've paired: their name and a scrambled (hashed) copy of their pairing key,
- background pictures you upload,
- sign-ins for websites you open through Lumen, kept by its own browser profile,
- a small log file (`lumen.log`) that helps with fixing problems.

On a paired phone, Lumen keeps only its pairing key and a few display preferences in the phone browser's storage.
This is needed for the remote to work, so no cookie banner is needed: Lumen sets no cookies at all.

To remove everything: Settings › Apps › Lumen › Uninstall, and choose to delete your settings too
(or delete the `%LOCALAPPDATA%\Lumen` folder).

## Who Lumen talks to

Lumen only contacts outside services to do what you ask:

| Service | When | What it sends |
|---|---|---|
| **The Movie Database (TMDB)** — api.themoviedb.org, image.tmdb.org | Showing films, posters, search results | Your TMDB key, what you search for, and the films you open. TMDB sees your internet address. [TMDB privacy policy](https://www.themoviedb.org/privacy-policy) |
| **GitHub** — api.github.com, github.com | Checking for and downloading updates (every few hours) | Lumen's version number. GitHub sees your internet address. |
| **YouTube** (youtube-nocookie.com) | Playing a trailer | The trailer you chose. Uses YouTube's privacy-enhanced mode. |
| **Websites you open** (your Watch websites, BBC iPlayer, ITVX, Channel 4, My5, Tubi, Pluto TV, YouTube) | When you press Watch or a website tile | Whatever those sites collect, as with any browser. Lumen blocks their pop-ups and redirects. |

Lumen's phone remote only works on your own home network: it refuses connections from anywhere else.
Traffic between your phone and the computer stays on your home Wi-Fi and isn't encrypted, so use it on a network you trust.

## Children

Lumen doesn't ask for anyone's age and doesn't collect information from anyone.

## Changes

If this ever changes, this page will say so in the release notes.

Film data and images: TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
Availability information: JustWatch, via TMDB.
