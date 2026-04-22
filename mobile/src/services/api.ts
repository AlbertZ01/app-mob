import type {
  PartyMode,
  PartyRoom,
  SavePlaylistResponse,
  SpotifyLoginResponse,
} from "../types/party";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "http://10.0.2.2:8787";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "La API no pudo completar la accion.");
  }

  return payload;
}

export function createRoom(mode: PartyMode, hostName: string): Promise<PartyRoom> {
  return request<PartyRoom>("/rooms", {
    method: "POST",
    body: JSON.stringify({ mode, hostName }),
  });
}

export function getRoom(code: string): Promise<PartyRoom> {
  return request<PartyRoom>(`/rooms/${code.toUpperCase()}`);
}

export function getSpotifyLoginUrl(
  code: string,
  displayName: string,
): Promise<SpotifyLoginResponse> {
  const query = new URLSearchParams({
    roomCode: code.toUpperCase(),
    displayName: displayName.trim() || "Invitado",
  });

  return request<SpotifyLoginResponse>(`/spotify/login?${query}`);
}

export function addDemoFriend(code: string, name: string): Promise<PartyRoom> {
  return request<PartyRoom>(`/rooms/${code.toUpperCase()}/demo-friend`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function generateSession(code: string, mode: PartyMode): Promise<PartyRoom> {
  return request<PartyRoom>(`/rooms/${code.toUpperCase()}/analyze`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export function sendLiveVote(code: string, label: string): Promise<PartyRoom> {
  return request<PartyRoom>(`/rooms/${code.toUpperCase()}/live/vote`, {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

export function finishParty(code: string): Promise<PartyRoom> {
  return request<PartyRoom>(`/rooms/${code.toUpperCase()}/summary`, {
    method: "POST",
  });
}

export function savePlaylist(code: string, memberId?: string): Promise<SavePlaylistResponse> {
  return request<SavePlaylistResponse>(`/rooms/${code.toUpperCase()}/playlist/save`, {
    method: "POST",
    body: JSON.stringify({ memberId }),
  });
}
