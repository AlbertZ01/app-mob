# MoodMix Mobile

MoodMix is a small Android-ready mobile app starter that combines the OpenAI API and Spotify Web API.

The app asks for a mood, plan, or moment. The backend uses OpenAI to turn that into a focused music search idea, then uses Spotify catalog search to return matching tracks. API keys stay on the backend, not inside the Android app.

## Project Structure

```text
mobile/   Expo React Native app
server/   Node/Express API proxy for OpenAI and Spotify
scripts/  Helper scripts for local setup assets
```

## Prerequisites

- Node.js LTS with npm
- Expo account if you want to build an installable APK with EAS
- OpenAI API key
- Spotify developer app with Client ID and Client Secret

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
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
PORT=8787
```

Create the mobile env file:

```powershell
Copy-Item mobile\.env.example mobile\.env
```

For Android emulator, keep:

```text
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8787
```

For a physical Android device, replace it with your computer LAN IP, for example:

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

Then open it in Expo Go or run it on Android:

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

## API Notes

- OpenAI is called with the official JavaScript SDK and the Responses API.
- Spotify uses Client Credentials on the backend, which is appropriate for public catalog search.
- Spotify user-specific features such as creating playlists require Authorization Code with PKCE or a secure authorization-code backend flow; this starter intentionally avoids user account access.
