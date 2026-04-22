export type MusicBrief = {
  title: string;
  vibe: string;
  searchQuery: string;
};

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  imageUrl: string;
  previewUrl: string | null;
  spotifyUrl: string;
};

export type RecommendationResponse = {
  brief: MusicBrief;
  tracks: Track[];
};

