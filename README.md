# AUX Roast Mobile

AUX Roast is an Expo app for Android and iOS parties. A group of friends signs in, connects Spotify, the backend reads their music taste, OpenAI generates funny musical profiles and roasts, and the app builds a shared party session with live mood voting.

## What The MVP Does

- Create or join a party room with a short code.
- Connect each friend's Spotify account through Authorization Code with PKCE.
- Pull Spotify top artists and top tracks for each connected friend.
- Estimate genres, favorite decades, repeat risk, party energy, chaos, and group compatibility.
- Generate AI music profiles, roasts, badges, musical crimes, live DJ comments, and final party summary.
- Build a shared playlist from the group's real Spotify tracks.
- Let the room vote during live mode: more known, harder, more perreo, more elegant, lower energy, raise it now, surprise.
- Save the generated playlist to a connected Spotify account.
- Require login before entering the app: email/password, Google or Apple.
- Add demo friends so the app can be tested before configuring Spotify/OpenAI.

## Project Structure

```text
mobile/   Expo React Native app
server/   Node/Express API for Spotify OAuth, room state, OpenAI logic, and playlist saving
scripts/  Helper scripts for app icons
```

The party room state still lives in memory on the Node backend. Mobile authentication now expects Supabase Auth, which provides email/password plus Google and Apple sign-in.

## Prerequisites

- Node.js LTS with npm
- Expo account for EAS builds
- OpenAI API key
- Spotify developer app
- Supabase project for app authentication
- Apple Developer membership for installable iOS builds

## Spotify App Setup

Create a Spotify app in the Spotify Developer Dashboard and add this redirect URI:

```text
http://localhost:8787/spotify/callback
```

For physical Android device testing, use your computer LAN IP in both Spotify dashboard and `server/.env`, for example:

```text
http://192.168.1.50:8787/spotify/callback
```

## Supabase Auth Setup

Create a Supabase project and enable:

- Email auth
- Google provider
- Apple provider

Add these redirect URLs in Supabase Auth:

```text
appmob://auth/callback
```

If you test social login in Expo development mode over a tunnel, also add the temporary tunnel callback URL shown by Expo.

## Configure Environment

Create the server env file:

```powershell
Copy-Item server\.env.example server\.env
```

Edit `server\.env`:

```text
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.2
SPOTIFY_CLIENT_ID=your_spotify_client_id
PUBLIC_BASE_URL=http://localhost:8787
SPOTIFY_REDIRECT_URI=http://localhost:8787/spotify/callback
PORT=8787
```

Create the mobile env file:

```powershell
Copy-Item mobile\.env.example mobile\.env
```

For Android emulator:

```text
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8787
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

For physical Android device, replace it with your computer LAN IP:

```text
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.50:8787
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

## Run Locally

Install dependencies:

```powershell
npm install --prefix server
npm install --prefix mobile
```

Start the backend:

```powershell
npm run dev --prefix server
```

Start the mobile app:

```powershell
npm run start --prefix mobile
```

Run on Android:

```powershell
npm run android --prefix mobile
```

## Build A Downloadable Android APK

The project includes `mobile/eas.json` with a `preview` profile configured for APK output.

```powershell
npm install -g eas-cli
eas login
cd mobile
eas build -p android --profile preview
```

When EAS finishes, it gives you a download link for the `.apk`.

## Faster Android Builds

If Expo free-tier queue is too slow, use one of these paths:

### 1. Local debug APK on your own machine

Requires Java plus Android SDK / Android Studio:

```powershell
cd mobile
npm run build:android:local-debug
```

That produces a debug APK locally after `expo prebuild`.

### 2. GitHub Actions debug APK

This repo includes a GitHub Actions workflow that builds a debug APK and uploads it as an artifact, usually faster than waiting in EAS free queue.

Open the repository's Actions tab and run **Android Debug APK** manually.

## iOS Builds

The app config now includes iOS identifiers and EAS profile support. For an installable iOS binary you need:

- Apple Developer membership
- EAS cloud build or a Mac with Xcode

Cloud build:

```powershell
cd mobile
npx eas-cli build -p ios --profile preview
```

On Windows you cannot produce a signed installable iOS binary locally with Xcode; use EAS cloud for `.ipa` or TestFlight distribution.

## Useful API Routes

- `POST /rooms` creates a room.
- `GET /rooms/:code` returns room state.
- `GET /spotify/login?roomCode=ABC123&displayName=Name` returns the Spotify OAuth URL.
- `POST /rooms/:code/demo-friend` adds a fake friend for testing.
- `POST /rooms/:code/analyze` runs the AI party analysis.
- `POST /rooms/:code/live/vote` records a live mood vote and generates commentary.
- `POST /rooms/:code/summary` creates the final report.
- `POST /rooms/:code/playlist/save` saves the session to Spotify.

## API Notes

- OpenAI stays server-side. The app never receives `OPENAI_API_KEY`.
- Spotify uses Authorization Code with PKCE. The app never stores a Spotify client secret.
- App login uses Supabase Auth with deep linking via the `appmob://auth/callback` scheme.
- Spotify scopes used: `user-read-private`, `user-top-read`, `playlist-modify-private`, `playlist-modify-public`.
- Demo mode works without Spotify/OpenAI credentials, but real roasts and real playlist saving require credentials.
