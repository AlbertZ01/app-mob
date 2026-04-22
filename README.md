# AUX Roast Mobile

AUX Roast is an Android-ready Expo app for parties. A group of friends connects Spotify, the backend reads their music taste, OpenAI generates funny musical profiles and roasts, and the app builds a shared party session with live mood voting.

## What The MVP Does

- Create or join a party room with a short code.
- Connect each friend's Spotify account through Authorization Code with PKCE.
- Pull Spotify top artists and top tracks for each connected friend.
- Estimate genres, favorite decades, repeat risk, party energy, chaos, and group compatibility.
- Generate AI music profiles, roasts, badges, musical crimes, live DJ comments, and final party summary.
- Build a shared playlist from the group's real Spotify tracks.
- Let the room vote during live mode: more known, harder, more perreo, more elegant, lower energy, raise it now, surprise.
- Save the generated playlist to a connected Spotify account.
- Add demo friends so the app can be tested before configuring Spotify/OpenAI.

## Project Structure

```text
mobile/   Expo React Native app
server/   Node/Express API for Spotify OAuth, room state, OpenAI logic, and playlist saving
scripts/  Helper scripts for app icons
```

The MVP keeps room state in memory. For production, move room/member/session state to PostgreSQL or Supabase, token/session cache to Redis, and live voting to WebSockets.

## Prerequisites

- Node.js LTS with npm
- Expo account for Android APK builds with EAS
- OpenAI API key
- Spotify developer app

## Spotify App Setup

Create a Spotify app in the Spotify Developer Dashboard and add this redirect URI:

```text
http://localhost:8787/spotify/callback
```

For physical Android device testing, use your computer LAN IP in both Spotify dashboard and `server/.env`, for example:

```text
http://192.168.1.50:8787/spotify/callback
```

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
```

For physical Android device, replace it with your computer LAN IP:

```text
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.50:8787
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
- Spotify scopes used: `user-read-private`, `user-top-read`, `playlist-modify-private`, `playlist-modify-public`.
- Demo mode works without Spotify/OpenAI credentials, but real roasts and real playlist saving require credentials.

