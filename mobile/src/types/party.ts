export type PartyMode =
  | "previa"
  | "casa"
  | "coche"
  | "terraza"
  | "barbacoa"
  | "fiesta_fuerte"
  | "after"
  | "cierre_emocional";

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  imageUrl: string;
  spotifyUrl: string;
  uri: string;
  sourceMemberId?: string;
};

export type MemberStats = {
  mainGenres: string[];
  decadeBias: string;
  partyScore: number;
  chaosScore: number;
  gymScore?: number;
  repeatRisk: number;
  sadScore?: number;
};

export type MusicProfile = {
  archetype: string;
  roast: string;
  strengths: string[];
  crimes: string[];
  sneakySongs: string[];
  badges: string[];
};

export type PartyMember = {
  id: string;
  displayName: string;
  avatarUrl: string;
  spotifyUrl: string;
  topArtists: string[];
  topTracks: Track[];
  genres: string[];
  stats: MemberStats;
  profile: MusicProfile;
  connectedAt: string;
};

export type GroupScores = {
  party: number;
  car: number;
  gym: number;
  after: number;
  sad: number;
  compatibility: number;
  chaos: number;
};

export type PlaylistPhase = {
  name: string;
  intent: string;
  energy: number;
};

export type PlaylistPlan = {
  title: string;
  strategy: string;
  phases: PlaylistPhase[];
  tracks: Track[];
};

export type LiveVote = {
  id: string;
  label: string;
  createdAt: string;
};

export type LiveState = {
  energy: number;
  currentTrack: Track | null;
  votes: LiveVote[];
  lastCommentary: string;
};

export type PartySummary = {
  mvp: string;
  auxSaboteur: string;
  predictable: string;
  saveTrack: string;
  peakMoment: string;
  emotionalCrash: string;
  finalVerdict: string;
  awards: string[];
  playlistUrl?: string;
};

export type PartyRoom = {
  code: string;
  mode: PartyMode;
  members: PartyMember[];
  scores: GroupScores;
  playlist: PlaylistPlan;
  live: LiveState;
  summary: PartySummary | null;
  createdAt: string;
};

export type SpotifyLoginResponse = {
  url: string;
};

export type SavePlaylistResponse = {
  playlistId: string;
  playlistName: string;
  playlistUrl: string;
  trackCount: number;
};
