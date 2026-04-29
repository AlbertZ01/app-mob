import "dotenv/config";
import crypto from "crypto";
import cors from "cors";
import express from "express";
import OpenAI from "openai";
import { z } from "zod";

const app = express();
const port = Number(process.env.PORT || 8787);
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
const openaiModel = process.env.OPENAI_MODEL || "gpt-5.2";

const rooms = new Map();
const authStates = new Map();

const partyModes = [
  "previa",
  "casa",
  "coche",
  "terraza",
  "barbacoa",
  "fiesta_fuerte",
  "after",
  "cierre_emocional",
];

const createRoomSchema = z.object({
  hostName: z.string().trim().min(1).max(40).optional(),
  mode: z.enum(partyModes).default("previa"),
});

const demoFriendSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
});

const analyzeSchema = z.object({
  mode: z.enum(partyModes).default("previa"),
});

const voteSchema = z.object({
  label: z.string().trim().min(2).max(40),
});

const savePlaylistSchema = z.object({
  memberId: z.string().optional(),
});

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "aux-roast-api" });
});

app.post("/rooms", asyncRoute(async (req, res) => {
  const input = createRoomSchema.parse(req.body);
  const room = createRoom(input.mode);

  if (input.hostName) {
    room.hostName = input.hostName;
  }

  rooms.set(room.code, room);
  res.status(201).json(publicRoom(room));
}));

app.get("/rooms/:code", asyncRoute(async (req, res) => {
  res.json(publicRoom(getRoomOrThrow(req.params.code)));
}));

app.post("/rooms/:code/demo-friend", asyncRoute(async (req, res) => {
  const room = getRoomOrThrow(req.params.code);
  const input = demoFriendSchema.parse(req.body);
  const member = createDemoMember(input.name, room.members.length);

  upsertMember(room, member);
  refreshRoomState(room);

  res.json(publicRoom(room));
}));

app.get("/spotify/login", asyncRoute(async (req, res) => {
  const roomCode = String(req.query.roomCode || "").trim().toUpperCase();
  const displayName = String(req.query.displayName || "Invitado").trim().slice(0, 40);

  getRoomOrThrow(roomCode);
  ensureSpotifyConfig();

  const state = randomToken(24);
  const codeVerifier = randomToken(64);
  const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
  const redirectUri = spotifyRedirectUri();

  authStates.set(state, {
    codeVerifier,
    displayName,
    expiresAt: Date.now() + 10 * 60 * 1000,
    roomCode,
  });

  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    scope: [
      "user-read-private",
      "user-top-read",
      "playlist-modify-private",
      "playlist-modify-public",
    ].join(" "),
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });

  res.json({ url: `https://accounts.spotify.com/authorize?${params}` });
}));

app.get("/spotify/callback", asyncRoute(async (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const authState = authStates.get(state);

  if (!code || !authState || authState.expiresAt < Date.now()) {
    throw new ApiError(400, "Spotify callback invalido o caducado.");
  }

  authStates.delete(state);

  const room = getRoomOrThrow(authState.roomCode);
  const token = await exchangeSpotifyCode(code, authState.codeVerifier);
  const member = await createMemberFromSpotify(token, authState.displayName);

  upsertMember(room, member);
  refreshRoomState(room);

  res.type("html").send(`
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>AUX Roast conectado</title>
        <style>
          body { background:#0D1321; color:#F8F4E3; font-family:system-ui,sans-serif; margin:0; padding:32px; }
          main { margin:auto; max-width:520px; }
          h1 { color:#D9B44A; }
          strong { color:#EE4266; }
        </style>
      </head>
      <body>
        <main>
          <h1>Spotify conectado</h1>
          <p><strong>${escapeHtml(member.displayName)}</strong> ya esta en la sala ${room.code}.</p>
          <p>Vuelve a la app y pulsa refrescar sala.</p>
        </main>
      </body>
    </html>
  `);
}));

app.post("/rooms/:code/analyze", asyncRoute(async (req, res) => {
  const room = getRoomOrThrow(req.params.code);
  const input = analyzeSchema.parse(req.body);

  room.mode = input.mode;
  await applyAiAnalysis(room);

  res.json(publicRoom(room));
}));

app.post("/rooms/:code/live/vote", asyncRoute(async (req, res) => {
  const room = getRoomOrThrow(req.params.code);
  const input = voteSchema.parse(req.body);

  await applyLiveVote(room, input.label);

  res.json(publicRoom(room));
}));

app.post("/rooms/:code/summary", asyncRoute(async (req, res) => {
  const room = getRoomOrThrow(req.params.code);

  room.summary = await createPartySummary(room);
  res.json(publicRoom(room));
}));

app.post("/rooms/:code/playlist/save", asyncRoute(async (req, res) => {
  const room = getRoomOrThrow(req.params.code);
  const input = savePlaylistSchema.parse(req.body || {});
  const member =
    room.members.find((candidate) => candidate.id === input.memberId && candidate.accessToken) ||
    room.members.find((candidate) => candidate.accessToken);

  if (!member) {
    throw new ApiError(400, "Conecta Spotify con un usuario real antes de guardar playlists.");
  }

  const uris = unique(room.playlist.tracks.map((track) => track.uri).filter(Boolean));

  if (uris.length === 0) {
    throw new ApiError(400, "La sesion no tiene canciones reales de Spotify para guardar.");
  }

  const playlist = await createSpotifyPlaylist(member, room, uris);

  room.summary = room.summary || fallbackSummary(room);
  room.summary.playlistUrl = playlist.playlistUrl;

  res.json(playlist);
}));

app.use((error, _req, res, _next) => {
  const status = error instanceof ApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Error inesperado";

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({ error: message });
});

app.listen(port, () => {
  console.log(`AUX Roast API listening on ${publicBaseUrl}`);
});

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createRoom(mode) {
  return {
    code: createRoomCode(),
    createdAt: new Date().toISOString(),
    hostName: "",
    live: {
      currentTrack: null,
      energy: 45,
      lastCommentary: "La sala esta esperando victimas musicales.",
      votes: [],
    },
    members: [],
    mode,
    playlist: emptyPlaylist(),
    scores: emptyScores(),
    summary: null,
  };
}

function createRoomCode() {
  let code = "";
  do {
    code = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function getRoomOrThrow(code) {
  const room = rooms.get(String(code || "").trim().toUpperCase());

  if (!room) {
    throw new ApiError(404, "Sala no encontrada.");
  }

  return room;
}

function publicRoom(room) {
  return {
    code: room.code,
    createdAt: room.createdAt,
    live: room.live,
    members: room.members.map(({ accessToken, refreshToken, tokenExpiresAt, ...member }) => member),
    mode: room.mode,
    playlist: room.playlist,
    scores: room.scores,
    summary: room.summary,
  };
}

function emptyScores() {
  return {
    after: 0,
    car: 0,
    chaos: 0,
    compatibility: 0,
    gym: 0,
    party: 0,
    sad: 0,
  };
}

function emptyPlaylist() {
  return {
    phases: defaultPhases(),
    strategy: "Conecta amigos para calcular una sesion real.",
    title: "Sesion pendiente",
    tracks: [],
  };
}

function defaultPhases() {
  return [
    { energy: 45, intent: "Calentar sin asustar al grupo.", name: "Arranque neutral" },
    { energy: 62, intent: "Buscar gustos comunes y hits seguros.", name: "Democracia bailable" },
    { energy: 82, intent: "Subir intensidad si la sala responde.", name: "Pico controlado" },
    { energy: 55, intent: "Cerrar sin convertirlo en drama.", name: "Salida digna" },
  ];
}

function upsertMember(room, member) {
  const index = room.members.findIndex((candidate) => candidate.spotifyUserId === member.spotifyUserId);

  if (index >= 0) {
    room.members[index] = member;
  } else {
    room.members.push(member);
  }
}

function refreshRoomState(room) {
  room.scores = computeGroupScores(room.members);
  room.playlist = buildFallbackPlaylist(room);
  room.live.energy = room.playlist.tracks.length > 0 ? room.scores.party : room.live.energy;
  room.live.currentTrack = room.playlist.tracks[0] || null;
  room.live.lastCommentary = fallbackLiveComment(room, "arranque");
}

async function applyAiAnalysis(room) {
  room.scores = computeGroupScores(room.members);
  room.playlist = buildFallbackPlaylist(room);
  room.live.currentTrack = room.playlist.tracks[0] || null;
  room.live.energy = room.scores.party || 45;

  const ai = await generatePartyAnalysis(room);

  if (!ai) {
    room.live.lastCommentary = fallbackLiveComment(room, "analisis");
    return;
  }

  const profileById = new Map(ai.profiles.map((profile) => [profile.memberId, profile]));

  room.members = room.members.map((member) => {
    const aiProfile = profileById.get(member.id);
    return aiProfile
      ? {
          ...member,
          profile: {
            archetype: aiProfile.archetype,
            badges: aiProfile.badges,
            crimes: aiProfile.crimes,
            roast: aiProfile.roast,
            sneakySongs: aiProfile.sneakySongs,
            strengths: aiProfile.strengths,
          },
        }
      : member;
  });

  room.scores = normalizeScores(ai.scores, room.scores);
  room.playlist = {
    phases: normalizePhases(ai.playlist.phases),
    strategy: ai.playlist.strategy || room.playlist.strategy,
    title: ai.playlist.title || room.playlist.title,
    tracks: orderTracksByAi(room.playlist.tracks, ai.playlist.trackOrder),
  };
  room.live.currentTrack = room.playlist.tracks[0] || null;
  room.live.lastCommentary = ai.liveCommentary || fallbackLiveComment(room, "analisis");
}

async function generatePartyAnalysis(room) {
  const candidates = room.playlist.tracks.slice(0, 40).map((track) => ({
    artist: track.artist,
    id: track.id,
    sourceMemberId: track.sourceMemberId,
    title: track.title,
  }));

  const memberSummaries = room.members.map((member) => ({
    id: member.id,
    name: member.displayName,
    genres: member.genres.slice(0, 8),
    topArtists: member.topArtists.slice(0, 8),
    topTracks: member.topTracks.slice(0, 8).map((track) => `${track.title} - ${track.artist}`),
    stats: member.stats,
  }));

  return createOpenAIJson({
    input: JSON.stringify({
      candidates,
      memberSummaries,
      mode: room.mode,
    }),
    instructions:
      "You are the funny but useful music director for a Spanish friend group party app. Generate playful consensual roasts about music taste only. Avoid slurs, protected-class insults, sexual content, or cruelty. Use Spanish. Build a useful party route from the candidate tracks; do not invent track ids.",
    name: "party_analysis",
    schema: partyAnalysisSchema(),
  });
}

async function applyLiveVote(room, label) {
  const vote = {
    createdAt: new Date().toISOString(),
    id: randomToken(8),
    label,
  };

  room.live.votes.unshift(vote);
  room.live.votes = room.live.votes.slice(0, 24);
  room.live.energy = clamp(room.live.energy + energyDelta(label), 15, 99);

  if (room.playlist.tracks.length > 0) {
    const index = room.live.votes.length % room.playlist.tracks.length;
    room.live.currentTrack = room.playlist.tracks[index];
  }

  const ai = await createOpenAIJson({
    input: JSON.stringify({
      currentTrack: room.live.currentTrack,
      energy: room.live.energy,
      members: room.members.map((member) => ({
        archetype: member.profile.archetype,
        name: member.displayName,
      })),
      recentVotes: room.live.votes.slice(0, 6),
      vote: label,
    }),
    instructions:
      "You are a live Spanish party commentator. Write one short funny comment about the musical direction after this vote. Be cheeky but light, music-focused, and useful.",
    name: "live_comment",
    schema: liveCommentSchema(),
  });

  room.live.lastCommentary = ai?.commentary || fallbackLiveComment(room, label);
}

async function createPartySummary(room) {
  const ai = await createOpenAIJson({
    input: JSON.stringify({
      members: room.members.map((member) => ({
        archetype: member.profile.archetype,
        name: member.displayName,
        roast: member.profile.roast,
        stats: member.stats,
      })),
      mode: room.mode,
      playlist: room.playlist.tracks.slice(0, 12).map((track) => `${track.title} - ${track.artist}`),
      votes: room.live.votes,
    }),
    instructions:
      "Create a Spanish end-of-party report for a music party app. Make it shareable, funny, and specific to music taste. No slurs, no protected-class insults, no cruelty.",
    name: "party_summary",
    schema: summarySchema(),
  });

  return ai || fallbackSummary(room);
}

async function createOpenAIJson({ input, instructions, name, schema }) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({
      input,
      instructions,
      model: openaiModel,
      text: {
        format: {
          name,
          schema,
          strict: true,
          type: "json_schema",
        },
      },
    });

    return JSON.parse(response.output_text);
  } catch (error) {
    console.warn("OpenAI fallback:", error instanceof Error ? error.message : error);
    return null;
  }
}

function partyAnalysisSchema() {
  const stringArray = {
    items: { type: "string" },
    type: "array",
  };

  return {
    additionalProperties: false,
    properties: {
      liveCommentary: { type: "string" },
      playlist: {
        additionalProperties: false,
        properties: {
          phases: {
            items: {
              additionalProperties: false,
              properties: {
                energy: { type: "number" },
                intent: { type: "string" },
                name: { type: "string" },
              },
              required: ["name", "intent", "energy"],
              type: "object",
            },
            type: "array",
          },
          strategy: { type: "string" },
          title: { type: "string" },
          trackOrder: stringArray,
        },
        required: ["title", "strategy", "phases", "trackOrder"],
        type: "object",
      },
      profiles: {
        items: {
          additionalProperties: false,
          properties: {
            archetype: { type: "string" },
            badges: stringArray,
            crimes: stringArray,
            memberId: { type: "string" },
            roast: { type: "string" },
            sneakySongs: stringArray,
            strengths: stringArray,
          },
          required: [
            "memberId",
            "archetype",
            "roast",
            "strengths",
            "crimes",
            "sneakySongs",
            "badges",
          ],
          type: "object",
        },
        type: "array",
      },
      scores: scoresSchema(),
    },
    required: ["profiles", "scores", "playlist", "liveCommentary"],
    type: "object",
  };
}

function scoresSchema() {
  return {
    additionalProperties: false,
    properties: {
      after: { type: "number" },
      car: { type: "number" },
      chaos: { type: "number" },
      compatibility: { type: "number" },
      gym: { type: "number" },
      party: { type: "number" },
      sad: { type: "number" },
    },
    required: ["party", "car", "gym", "after", "sad", "compatibility", "chaos"],
    type: "object",
  };
}

function liveCommentSchema() {
  return {
    additionalProperties: false,
    properties: {
      commentary: { type: "string" },
    },
    required: ["commentary"],
    type: "object",
  };
}

function summarySchema() {
  return {
    additionalProperties: false,
    properties: {
      auxSaboteur: { type: "string" },
      awards: {
        items: { type: "string" },
        type: "array",
      },
      emotionalCrash: { type: "string" },
      finalVerdict: { type: "string" },
      mvp: { type: "string" },
      peakMoment: { type: "string" },
      predictable: { type: "string" },
      saveTrack: { type: "string" },
    },
    required: [
      "mvp",
      "auxSaboteur",
      "predictable",
      "saveTrack",
      "peakMoment",
      "emotionalCrash",
      "finalVerdict",
      "awards",
    ],
    type: "object",
  };
}

function ensureSpotifyConfig() {
  const missing = [
    ["SPOTIFY_CLIENT_ID", process.env.SPOTIFY_CLIENT_ID],
    ["SPOTIFY_REDIRECT_URI or PUBLIC_BASE_URL", spotifyRedirectUri()],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new ApiError(500, `Faltan variables de Spotify: ${missing.join(", ")}`);
  }
}

function spotifyRedirectUri() {
  return process.env.SPOTIFY_REDIRECT_URI || `${publicBaseUrl}/spotify/callback`;
}

async function exchangeSpotifyCode(code, codeVerifier) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    body: new URLSearchParams({
      client_id: process.env.SPOTIFY_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: spotifyRedirectUri(),
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(502, `Spotify token failed: ${response.status} ${body}`);
  }

  return response.json();
}

async function createMemberFromSpotify(token, fallbackName) {
  const [profile, topArtists, topTracksShort, topTracksMedium, topTracksLong] = await Promise.all([
    spotifyGet(token.access_token, "/me"),
    spotifyGet(token.access_token, "/me/top/artists?time_range=medium_term&limit=30"),
    spotifyGet(token.access_token, "/me/top/tracks?time_range=short_term&limit=30"),
    spotifyGet(token.access_token, "/me/top/tracks?time_range=medium_term&limit=30"),
    spotifyGet(token.access_token, "/me/top/tracks?time_range=long_term&limit=30"),
  ]);

  const normalizedTracks = uniqueTracks([
    ...normalizeSpotifyTracks(topTracksShort.items || []),
    ...normalizeSpotifyTracks(topTracksMedium.items || []),
    ...normalizeSpotifyTracks(topTracksLong.items || []),
  ]);
  const artistNames = (topArtists.items || []).map((artist) => artist.name).filter(Boolean);
  const genres = topGenres(topArtists.items || []);
  const repeatRisk = calculateRepeatRisk(topTracksShort.items || [], topTracksLong.items || []);
  const stats = buildStats(genres, normalizedTracks, repeatRisk);

  const member = {
    accessToken: token.access_token,
    avatarUrl: profile.images?.[0]?.url || "",
    connectedAt: new Date().toISOString(),
    displayName: profile.display_name || fallbackName || "Spotify friend",
    genres,
    id: `sp_${profile.id}`,
    profile: fallbackProfile({
      displayName: profile.display_name || fallbackName || "Spotify friend",
      genres,
      stats,
      topArtists: artistNames,
      topTracks: normalizedTracks,
    }),
    refreshToken: token.refresh_token || "",
    spotifyUrl: profile.external_urls?.spotify || "",
    spotifyUserId: profile.id,
    stats,
    tokenExpiresAt: Date.now() + token.expires_in * 1000,
    topArtists: artistNames,
    topTracks: normalizedTracks,
  };

  return member;
}

async function spotifyGet(accessToken, path) {
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new ApiError(502, `Spotify request failed: ${response.status}`);
  }

  return response.json();
}

async function refreshSpotifyAccessToken(member) {
  if (!member.refreshToken) {
    throw new ApiError(401, "La sesion de Spotify ha caducado. Vuelve a conectar Spotify.");
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
    body: new URLSearchParams({
      client_id: process.env.SPOTIFY_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: member.refreshToken,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(502, `Spotify token refresh failed: ${response.status} ${body}`);
  }

  const token = await response.json();
  member.accessToken = token.access_token;
  member.refreshToken = token.refresh_token || member.refreshToken;
  member.tokenExpiresAt = Date.now() + Number(token.expires_in || 3600) * 1000;
}

async function spotifyMemberRequest(member, url, init = {}, retry = true) {
  if (!member.accessToken) {
    throw new ApiError(400, "Conecta Spotify con un usuario real antes de guardar playlists.");
  }

  if (member.tokenExpiresAt && member.tokenExpiresAt <= Date.now() + 60_000) {
    await refreshSpotifyAccessToken(member);
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${member.accessToken}`,
      ...(init.headers || {}),
    },
  });

  if (response.status === 401 && retry && member.refreshToken) {
    await refreshSpotifyAccessToken(member);
    return spotifyMemberRequest(member, url, init, false);
  }

  return response;
}

async function createSpotifyPlaylist(member, room, uris) {
  const playlistName = `Sala ${room.code}`;
  const response = await spotifyMemberRequest(member, "https://api.spotify.com/v1/me/playlists", {
    body: JSON.stringify({
      description: `Playlist creada por kazp para la sala ${room.code}.`,
      name: playlistName,
      public: false,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new ApiError(502, `Spotify playlist create failed: ${response.status} ${await response.text()}`);
  }

  const playlist = await response.json();

  for (let index = 0; index < uris.length; index += 100) {
    const chunk = uris.slice(index, index + 100);
    const addResponse = await spotifyMemberRequest(member, `https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
      body: JSON.stringify({ uris: chunk }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!addResponse.ok) {
      throw new ApiError(502, `Spotify playlist add failed: ${addResponse.status} ${await addResponse.text()}`);
    }
  }

  return {
    playlistId: playlist.id,
    playlistName,
    playlistUrl: playlist.external_urls?.spotify || "",
    trackCount: uris.length,
  };
}

function normalizeSpotifyTracks(items) {
  return items.map((track) => ({
    album: track.album?.name || "",
    artist: track.artists?.map((artist) => artist.name).join(", ") || "Unknown artist",
    id: track.id,
    imageUrl: track.album?.images?.[0]?.url || "",
    releaseYear: releaseYear(track.album?.release_date),
    spotifyUrl: track.external_urls?.spotify || "",
    title: track.name,
    uri: track.uri,
  }));
}

function topGenres(artists) {
  const counts = new Map();

  for (const artist of artists) {
    for (const genre of artist.genres || []) {
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([genre]) => genre);
}

function buildStats(genres, tracks, repeatRisk) {
  const partyScore = scoreKeywords(genres, [
    "reggaeton",
    "latin",
    "dance",
    "house",
    "techno",
    "pop",
    "trap",
    "edm",
    "club",
  ]);
  const sadScore = scoreKeywords(genres, ["indie", "sad", "emo", "acoustic", "folk", "cantautor"]);
  const gymScore = scoreKeywords(genres, ["trap", "rap", "hip hop", "metal", "edm", "drill"]);
  const decadeBias = favoriteDecade(tracks);
  const chaosScore = clamp(Math.round(genres.length * 6 + repeatRisk * 0.35 + decadeSpread(tracks) * 6), 8, 96);

  return {
    chaosScore,
    decadeBias,
    gymScore,
    mainGenres: genres.slice(0, 5),
    partyScore: clamp(Math.round((partyScore + gymScore * 0.25 + 38) - sadScore * 0.2), 15, 98),
    repeatRisk,
    sadScore: clamp(Math.round(sadScore + (decadeBias.includes("2010") ? 8 : 0)), 0, 100),
  };
}

function computeGroupScores(members) {
  if (members.length === 0) {
    return emptyScores();
  }

  const avgParty = average(members.map((member) => member.stats.partyScore));
  const avgChaos = average(members.map((member) => member.stats.chaosScore));
  const avgSad = average(members.map((member) => member.stats.sadScore || 30));
  const avgGym = average(members.map((member) => member.stats.gymScore || member.stats.partyScore * 0.55));
  const genreCompatibility = calculateGenreCompatibility(members);
  const chaos = clamp(Math.round(avgChaos + (100 - genreCompatibility) * 0.25), 5, 99);

  return {
    after: clamp(Math.round((avgSad + genreCompatibility) / 2), 5, 99),
    car: clamp(Math.round((avgParty + genreCompatibility + 15) / 2.25), 5, 99),
    chaos,
    compatibility: genreCompatibility,
    gym: clamp(Math.round((avgGym + avgParty) / 2), 5, 99),
    party: clamp(Math.round((avgParty * 1.25 + genreCompatibility) / 2.25), 5, 99),
    sad: clamp(Math.round(avgSad), 5, 99),
  };
}

function calculateGenreCompatibility(members) {
  if (members.length <= 1) {
    return members.length === 1 ? 72 : 0;
  }

  const allGenres = members.map((member) => new Set(member.genres.slice(0, 8)));
  const union = new Set(allGenres.flatMap((genres) => [...genres]));
  const shared = [...union].filter((genre) => allGenres.filter((genres) => genres.has(genre)).length > 1);
  const overlap = union.size ? shared.length / union.size : 0;

  return clamp(Math.round(42 + overlap * 48 - Math.max(0, members.length - 4) * 3), 12, 96);
}

function buildFallbackPlaylist(room) {
  const tracks = [];
  const maxTracks = 28;
  const longest = Math.max(0, ...room.members.map((member) => member.topTracks.length));

  for (let index = 0; index < longest && tracks.length < maxTracks; index += 1) {
    for (const member of room.members) {
      const track = member.topTracks[index];
      if (track && !tracks.some((candidate) => candidate.id === track.id)) {
        tracks.push({ ...track, sourceMemberId: member.id });
      }
      if (tracks.length >= maxTracks) {
        break;
      }
    }
  }

  return {
    phases: phasesForMode(room.mode, room.scores.party),
    strategy: strategyForMode(room.mode, room.scores),
    title: titleForMode(room.mode, room.scores),
    tracks,
  };
}

function phasesForMode(mode, partyScore) {
  const base = defaultPhases();

  if (mode === "fiesta_fuerte") {
    return [
      { energy: 58, intent: "Empezar con hits reconocibles para unir bandos.", name: "Pacto inicial" },
      { energy: 78, intent: "Meter perreo, pop y club sin pedir perdon.", name: "Subida seria" },
      { energy: 94, intent: "Pico de sudor con minimo drama.", name: "Zona roja" },
      { energy: 72, intent: "Bajar sin matar la fiesta.", name: "Aterrizaje" },
    ];
  }

  if (mode === "after" || mode === "cierre_emocional") {
    return [
      { energy: 40, intent: "Aceptar que alguien va a ponerse intenso.", name: "Confesion controlada" },
      { energy: 52, intent: "Mantener groove suave.", name: "Bajona elegante" },
      { energy: 36, intent: "Permitir nostalgia sin hundir el barco.", name: "2016 peligroso" },
      { energy: 28, intent: "Cerrar con dignidad discutible.", name: "Ultima ronda" },
    ];
  }

  return base.map((phase, index) => ({
    ...phase,
    energy: clamp(Math.round(phase.energy + (partyScore - 50) * 0.25 + index * 2), 20, 95),
  }));
}

function strategyForMode(mode, scores) {
  const modeLabel = mode.replaceAll("_", " ");

  if (scores.chaos > 70) {
    return `Modo ${modeLabel}: alternar bloques cortos porque el grupo tiene pinta de discutir por el AUX.`;
  }

  if (scores.compatibility > 70) {
    return `Modo ${modeLabel}: empezar con terreno comun y subir energia sin cambios bruscos.`;
  }

  return `Modo ${modeLabel}: mezclar favoritos de cada persona con hits puente para evitar sabotaje.`;
}

function titleForMode(mode, scores) {
  if (scores.chaos > 75) {
    return "Comite de crisis del AUX";
  }

  if (mode === "cierre_emocional") {
    return "Cierre emocional con supervision";
  }

  if (mode === "fiesta_fuerte") {
    return "Zona roja sin testigos";
  }

  return "Sesion democratica sospechosa";
}

function createDemoMember(name, index) {
  const preset = demoPresets[index % demoPresets.length];
  const displayName = name && index === 0 ? name : preset.name;
  const tracks = preset.tracks.map((track, trackIndex) => ({
    album: preset.album,
    artist: track.artist,
    id: `demo-${preset.key}-${trackIndex}`,
    imageUrl: "",
    releaseYear: track.year,
    spotifyUrl: "",
    title: track.title,
    uri: "",
  }));
  const stats = buildStats(preset.genres, tracks, preset.repeatRisk);

  return {
    accessToken: "",
    avatarUrl: "",
    connectedAt: new Date().toISOString(),
    displayName,
    genres: preset.genres,
    id: `demo_${preset.key}_${randomToken(4)}`,
    profile: fallbackProfile({
      displayName,
      genres: preset.genres,
      stats,
      topArtists: preset.artists,
      topTracks: tracks,
    }),
    refreshToken: "",
    spotifyUrl: "",
    spotifyUserId: `demo_${preset.key}_${index}`,
    stats,
    tokenExpiresAt: 0,
    topArtists: preset.artists,
    topTracks: tracks,
  };
}

function fallbackProfile(member) {
  const genres = member.genres.join(" ").toLowerCase();
  let archetype = "La persona que escucha temazos pero no sabe explicarlos";

  if (genres.includes("reggaeton") || genres.includes("latin")) {
    archetype = "NPC del reggaeton comercial";
  } else if (genres.includes("techno") || genres.includes("house")) {
    archetype = "El que pone techno para fregar";
  } else if (genres.includes("indie") || genres.includes("acoustic")) {
    archetype = "El villano emocional";
  } else if (genres.includes("pop")) {
    archetype = "Rey del estribillo";
  } else if (genres.includes("trap") || genres.includes("rap")) {
    archetype = "Secuestrador del AUX";
  } else if (member.stats.decadeBias.includes("2000")) {
    archetype = "El nostalgico peligroso";
  }

  return {
    archetype,
    badges: badgesFor(archetype),
    crimes: crimesFor(archetype),
    roast: roastFor(archetype, member.displayName),
    sneakySongs: member.topTracks.slice(0, 3).map((track) => track.title),
    strengths: strengthsFor(archetype),
  };
}

function roastFor(archetype, name) {
  const roasts = {
    "El nostalgico peligroso": `${name} puede salvar una fiesta o convertirla en una reunion de antiguos alumnos.`,
    "El que pone techno para fregar": `${name} escucha musica como si el lavavajillas fuera el cierre de un festival.`,
    "El villano emocional": `${name} trae temazos, pero hay que revisar que no venga escondida una bajona critica.`,
    "La persona que escucha temazos pero no sabe explicarlos": `${name} tiene buen gusto, pero lo defiende con la energia de un testigo nervioso.`,
    "NPC del reggaeton comercial": `${name} no tiene playlist de fiesta, tiene una auditoria de estribillos conocidos.`,
    "Rey del estribillo": `${name} detecta un coro pegadizo a veinte metros y ya esta subiendo el volumen.`,
    "Secuestrador del AUX": `${name} no pide una cancion, inicia una operacion tactica.`,
  };

  return roasts[archetype] || roasts["La persona que escucha temazos pero no sabe explicarlos"];
}

function strengthsFor(archetype) {
  if (archetype.includes("reggaeton")) {
    return ["activa el perreo", "conoce hits seguros", "sube energia rapido"];
  }
  if (archetype.includes("techno")) {
    return ["mantiene ritmo", "aguanta el after", "no teme al BPM"];
  }
  if (archetype.includes("emocional")) {
    return ["elige letras potentes", "crea momentos", "detecta bajadas"];
  }
  return ["encuentra puentes", "lee bien al grupo", "mete canciones compartibles"];
}

function crimesFor(archetype) {
  if (archetype.includes("reggaeton")) {
    return ["perreo demasiado pronto", "hit quemado", "coro repetido"];
  }
  if (archetype.includes("techno")) {
    return ["BPM sin contexto", "after antes de tiempo", "subida eterna"];
  }
  if (archetype.includes("emocional")) {
    return ["bajona critica", "nostalgia sin avisar", "drama a traicion"];
  }
  return ["cambio brusco", "tema inexplicable", "defensa debil del temazo"];
}

function badgesFor(archetype) {
  if (archetype.includes("AUX")) {
    return ["secuestrador del AUX", "selector clandestino"];
  }
  if (archetype.includes("techno")) {
    return ["alma de festival", "destructor de vibes"];
  }
  if (archetype.includes("reggaeton")) {
    return ["rey del estribillo", "perfil peligrosamente basico"];
  }
  return ["criminal musical del grupo", "temazo oculto"];
}

function fallbackLiveComment(room, label) {
  const comments = {
    "arranque": "He preparado una sesion inicial. De momento nadie ha intentado romper la convivencia.",
    "analisis": "El grupo ya esta analizado. Hay talento, riesgo y varias decisiones que deberian supervisarse.",
    "baja revoluciones": "Bajo revoluciones porque esto empezaba a parecer una huida en coche.",
    "mas conocida": "Metemos terreno conocido. La democracia necesita estribillos que todos puedan fingir cantar.",
    "mas dura": "Subo intensidad. Si alguien queria tertulia, eligio mal la sala.",
    "mas elegante": "Intento poner elegante esto antes de que alguien pida un delito federal.",
    "mas perreo": "Se detecta mayoria peligrosa a favor del perreo. Procedo con precaucion.",
    "sorpresa": "Voy con sorpresa. No garantizo madurez, solo continuidad musical.",
    "sube esto ya": "Subo esto ya porque la sala esta pidiendo menos teoria y mas consecuencias.",
  };

  if (comments[label]) {
    return comments[label];
  }

  if (room.members.length === 0) {
    return "Sin amigos conectados solo puedo juzgar el silencio, y tampoco sale muy bien.";
  }

  return "He reajustado la sesion para proteger la fiesta de decisiones demasiado personales.";
}

function fallbackSummary(room) {
  const members = room.members;
  const mvp = maxBy(members, (member) => member.stats.partyScore)?.displayName || "Sin MVP";
  const saboteur = maxBy(members, (member) => member.stats.chaosScore)?.displayName || "Sin sospechosos";
  const predictable = minBy(members, (member) => member.stats.chaosScore)?.displayName || "Nadie";
  const saveTrack = room.playlist.tracks[0]
    ? `${room.playlist.tracks[0].title} - ${room.playlist.tracks[0].artist}`
    : "Ningun tema, la sala estaba en silencio administrativo";

  return {
    auxSaboteur: saboteur,
    awards: [
      `${mvp}: rey del estribillo`,
      `${saboteur}: destructor de vibes`,
      `${predictable}: perfil sospechosamente estable`,
    ],
    emotionalCrash: "Se detecto riesgo de nostalgia, pero el sistema hizo lo que pudo.",
    finalVerdict: "Fiesta viable. El AUX necesita supervision adulta y probablemente una segunda ronda.",
    mvp,
    peakMoment: "Cuando el grupo dejo de debatir y empezo a votar.",
    predictable,
    saveTrack,
  };
}

function orderTracksByAi(tracks, trackOrder) {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const ordered = unique(trackOrder).map((id) => byId.get(id)).filter(Boolean);
  const missing = tracks.filter((track) => !ordered.some((candidate) => candidate.id === track.id));

  return [...ordered, ...missing].slice(0, 32);
}

function normalizeScores(scores, fallback) {
  return {
    after: clamp(Math.round(scores.after ?? fallback.after), 0, 100),
    car: clamp(Math.round(scores.car ?? fallback.car), 0, 100),
    chaos: clamp(Math.round(scores.chaos ?? fallback.chaos), 0, 100),
    compatibility: clamp(Math.round(scores.compatibility ?? fallback.compatibility), 0, 100),
    gym: clamp(Math.round(scores.gym ?? fallback.gym), 0, 100),
    party: clamp(Math.round(scores.party ?? fallback.party), 0, 100),
    sad: clamp(Math.round(scores.sad ?? fallback.sad), 0, 100),
  };
}

function normalizePhases(phases) {
  if (!Array.isArray(phases) || phases.length === 0) {
    return defaultPhases();
  }

  return phases.slice(0, 5).map((phase) => ({
    energy: clamp(Math.round(Number(phase.energy) || 50), 0, 100),
    intent: String(phase.intent || "Ajustar la energia del grupo."),
    name: String(phase.name || "Bloque"),
  }));
}

function scoreKeywords(genres, keywords) {
  const text = genres.join(" ").toLowerCase();
  return clamp(keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 12 : 0), 0), 0, 100);
}

function calculateRepeatRisk(shortTracks, longTracks) {
  const shortIds = new Set(shortTracks.map((track) => track.id));
  const longIds = new Set(longTracks.map((track) => track.id));
  const overlap = [...shortIds].filter((id) => longIds.has(id)).length;

  if (shortIds.size === 0) {
    return 0;
  }

  return clamp(Math.round((overlap / shortIds.size) * 100), 0, 100);
}

function favoriteDecade(tracks) {
  const counts = new Map();

  for (const track of tracks) {
    if (!track.releaseYear) {
      continue;
    }

    const decade = `${Math.floor(track.releaseYear / 10) * 10}s`;
    counts.set(decade, (counts.get(decade) || 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "mezcla temporal";
}

function decadeSpread(tracks) {
  return new Set(tracks.map((track) => Math.floor((track.releaseYear || 0) / 10)).filter(Boolean)).size;
}

function releaseYear(releaseDate) {
  const year = Number(String(releaseDate || "").slice(0, 4));
  return Number.isFinite(year) ? year : 0;
}

function uniqueTracks(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    if (!track.id || seen.has(track.id)) {
      return false;
    }
    seen.add(track.id);
    return true;
  });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0;
}

function maxBy(values, selector) {
  return values.reduce((best, value) => (!best || selector(value) > selector(best) ? value : best), null);
}

function minBy(values, selector) {
  return values.reduce((best, value) => (!best || selector(value) < selector(best) ? value : best), null);
}

function energyDelta(label) {
  const deltas = {
    "baja revoluciones": -14,
    "mas conocida": 3,
    "mas dura": 12,
    "mas elegante": -3,
    "mas perreo": 10,
    "sorpresa": 4,
    "sube esto ya": 15,
  };

  return deltas[label] || 2;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomToken(size) {
  return base64Url(crypto.randomBytes(size));
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const demoPresets = [
  {
    album: "Demo Club",
    artists: ["Bad Bunny", "Karol G", "Feid", "Rauw Alejandro"],
    genres: ["reggaeton", "latin pop", "urbano latino", "perreo"],
    key: "reggaeton",
    name: "Marta",
    repeatRisk: 72,
    tracks: [
      { artist: "Bad Bunny", title: "Neverita", year: 2022 },
      { artist: "Karol G", title: "Provenza", year: 2022 },
      { artist: "Feid", title: "Normal", year: 2022 },
      { artist: "Rauw Alejandro", title: "Todo de ti", year: 2021 },
    ],
  },
  {
    album: "Demo Warehouse",
    artists: ["Fred again..", "Peggy Gou", "Charlotte de Witte", "Bicep"],
    genres: ["techno", "house", "edm", "electronica"],
    key: "techno",
    name: "Juan",
    repeatRisk: 43,
    tracks: [
      { artist: "Fred again..", title: "leavemealone", year: 2023 },
      { artist: "Peggy Gou", title: "(It Goes Like) Nanana", year: 2023 },
      { artist: "Bicep", title: "Glue", year: 2017 },
      { artist: "Charlotte de Witte", title: "Doppler", year: 2023 },
    ],
  },
  {
    album: "Demo Feelings",
    artists: ["Arctic Monkeys", "The 1975", "Phoebe Bridgers", "Lorde"],
    genres: ["indie rock", "indie pop", "alternative", "sad pop"],
    key: "indie",
    name: "Lucia",
    repeatRisk: 65,
    tracks: [
      { artist: "Arctic Monkeys", title: "505", year: 2007 },
      { artist: "The 1975", title: "Robbers", year: 2013 },
      { artist: "Phoebe Bridgers", title: "Motion Sickness", year: 2017 },
      { artist: "Lorde", title: "Ribs", year: 2013 },
    ],
  },
  {
    album: "Demo Nostalgia",
    artists: ["Estopa", "Avicii", "Shakira", "La Oreja de Van Gogh"],
    genres: ["spanish pop", "dance pop", "latin", "2000s"],
    key: "nostalgia",
    name: "Diego",
    repeatRisk: 81,
    tracks: [
      { artist: "Avicii", title: "Levels", year: 2011 },
      { artist: "Shakira", title: "Hips Don't Lie", year: 2005 },
      { artist: "Estopa", title: "Como Camaron", year: 1999 },
      { artist: "La Oreja de Van Gogh", title: "Rosas", year: 2003 },
    ],
  },
  {
    album: "Demo Hits",
    artists: ["Dua Lipa", "The Weeknd", "Rosalia", "Harry Styles"],
    genres: ["pop", "dance pop", "synth pop", "latin pop"],
    key: "pop",
    name: "Nico",
    repeatRisk: 54,
    tracks: [
      { artist: "Dua Lipa", title: "Levitating", year: 2020 },
      { artist: "The Weeknd", title: "Blinding Lights", year: 2019 },
      { artist: "Rosalia", title: "DESPECHA", year: 2022 },
      { artist: "Harry Styles", title: "As It Was", year: 2022 },
    ],
  },
];
