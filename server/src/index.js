import "dotenv/config";
import cors from "cors";
import express from "express";
import OpenAI from "openai";
import { z } from "zod";

const app = express();
const port = Number(process.env.PORT || 8787);

const recommendationRequestSchema = z.object({
  prompt: z.string().trim().min(2).max(240),
});

let spotifyTokenCache = {
  accessToken: "",
  expiresAt: 0,
};

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "app-mob-server" });
});

app.post("/recommendations", async (req, res) => {
  const parsed = recommendationRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Escribe una idea breve, por ejemplo: 'noche tranquila para estudiar'.",
    });
  }

  try {
    ensureRequiredEnv();

    const musicBrief = await createMusicBrief(parsed.data.prompt);
    const tracks = await searchSpotifyTracks(musicBrief.searchQuery);

    res.json({
      brief: musicBrief,
      tracks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado";
    console.error(message);
    res.status(500).json({ error: message });
  }
});

function ensureRequiredEnv() {
  const missing = [
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["SPOTIFY_CLIENT_ID", process.env.SPOTIFY_CLIENT_ID],
    ["SPOTIFY_CLIENT_SECRET", process.env.SPOTIFY_CLIENT_SECRET],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(", ")}`);
  }
}

async function createMusicBrief(userPrompt) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.2",
    instructions:
      "You are a music discovery assistant. Return compact JSON only. Keep title under 48 characters, vibe under 140 characters, and searchQuery under 90 characters. Do not include Spotify content, lyrics, or copyrighted text.",
    input: `Create a Spotify catalog search idea for this mood or plan: ${userPrompt}`,
    text: {
      format: {
        type: "json_schema",
        name: "music_brief",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["title", "vibe", "searchQuery"],
          properties: {
            title: {
              type: "string",
            },
            vibe: {
              type: "string",
            },
            searchQuery: {
              type: "string",
            },
          },
        },
        strict: true,
      },
    },
  });

  return JSON.parse(response.output_text);
}

async function getSpotifyAccessToken() {
  const now = Date.now();

  if (spotifyTokenCache.accessToken && spotifyTokenCache.expiresAt > now + 30_000) {
    return spotifyTokenCache.accessToken;
  }

  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`,
  ).toString("base64");

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!response.ok) {
    throw new Error(`Spotify auth failed: ${response.status}`);
  }

  const token = await response.json();
  spotifyTokenCache = {
    accessToken: token.access_token,
    expiresAt: now + token.expires_in * 1000,
  };

  return token.access_token;
}

async function searchSpotifyTracks(searchQuery) {
  const accessToken = await getSpotifyAccessToken();
  const params = new URLSearchParams({
    q: searchQuery,
    type: "track",
    market: "ES",
    limit: "8",
  });

  const response = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Spotify search failed: ${response.status}`);
  }

  const data = await response.json();

  return (data.tracks?.items || []).map((track) => ({
    id: track.id,
    title: track.name,
    artist: track.artists?.map((artist) => artist.name).join(", ") || "Unknown artist",
    album: track.album?.name || "",
    imageUrl: track.album?.images?.[0]?.url || "",
    previewUrl: track.preview_url,
    spotifyUrl: track.external_urls?.spotify || "",
  }));
}

app.listen(port, () => {
  console.log(`MoodMix API listening on http://localhost:${port}`);
});
