# AUX Roast on Raspberry Pi

This project does not run "on the web" in the usual sense. What you host on the Raspberry Pi is the backend API in `server/`. The Android/iOS app talks to that API over HTTPS.

## Production target

- API domain: `https://api.a-zak.com`
- Backend port on the Pi: `127.0.0.1:8787`
- Public reverse proxy: Nginx
- DNS / proxy: Cloudflare

## What you need on the Pi

- Raspberry Pi with outbound internet access
- Nginx
- Node.js 20
- npm
- Git

## 1. Clone the repo

```bash
sudo mkdir -p /opt/aux-roast
sudo chown "$USER":"$USER" /opt/aux-roast
git clone git@github.com:AlbertZ01/app-mob.git /opt/aux-roast
cd /opt/aux-roast/server
npm ci
```

## 2. Create the production env file

Create `/opt/aux-roast/server/.env`:

```text
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
OPENAI_MODEL=gpt-5.2
SPOTIFY_CLIENT_ID=YOUR_SPOTIFY_CLIENT_ID
PUBLIC_BASE_URL=https://api.a-zak.com
SPOTIFY_REDIRECT_URI=https://api.a-zak.com/spotify/callback
PORT=8787
```

## 3. Install the systemd service

Copy `server/deploy/aux-roast.service.example` to `/etc/systemd/system/aux-roast.service` and replace:

- `APP_USER` with the Linux user that owns `/opt/aux-roast`

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable aux-roast
sudo systemctl restart aux-roast
sudo systemctl status aux-roast
```

## 4. Configure Nginx

Copy `server/deploy/api.a-zak.com.nginx.conf` to `/etc/nginx/sites-available/api.a-zak.com.conf`.

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/api.a-zak.com.conf /etc/nginx/sites-enabled/api.a-zak.com.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 5. Configure Cloudflare

Point `api.a-zak.com` to the same origin as `a-zak.com`, ideally proxied through Cloudflare.

Recommended DNS record:

- Type: `CNAME`
- Name: `api`
- Target: `a-zak.com`
- Proxy status: `Proxied`

## 6. Update Spotify

In Spotify Developer Dashboard, set this exact redirect URI:

```text
https://api.a-zak.com/spotify/callback
```

## 7. Update the mobile build variables in GitHub

Repository variables needed by GitHub Actions:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

The workflow already defaults the API base URL to `https://api.a-zak.com`.

## 8. Validate from the Pi

```bash
curl http://127.0.0.1:8787/health
curl https://api.a-zak.com/health
```

Expected response:

```json
{"ok":true,"service":"aux-roast-api"}
```
