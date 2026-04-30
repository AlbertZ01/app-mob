import type {
  PartyMode,
  PartyRoom,
  SavePlaylistResponse,
  SpotifyLoginResponse,
} from "../types/party";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "https://api.a-zak.com";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  const isJson = contentType.includes("application/json");
  let payload: unknown = null;

  if (raw && isJson) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("La API respondio con JSON invalido.");
    }
  }

  if (!response.ok) {
    if (payload && typeof payload === "object" && "error" in payload) {
      throw new Error(String(payload.error));
    }

    if (!isJson) {
      throw new Error(
        `El servidor devolvio ${response.status} ${response.statusText} en formato no JSON. Revisa el backend o Cloudflare.`,
      );
    }

    throw new Error("La API no pudo completar la accion.");
  }

  if (!payload) {
    throw new Error("La API respondio sin JSON.");
  }

  return payload as T;
}

export function createRoom(mode: PartyMode, hostName: string): Promise<PartyRoom> {
  return request<PartyRoom>("/rooms", {
    method: "POST",
    body: JSON.stringify({ mode, hostName }),
  });
}

export function createRoomWithProfile(
  mode: PartyMode,
  hostName: string,
  appUserId: string,
  roomName: string,
  avatarUrl?: string,
): Promise<PartyRoom> {
  return request<PartyRoom>("/rooms", {
    method: "POST",
    body: JSON.stringify({ appUserId, avatarUrl: avatarUrl || "", hostName, mode, roomName }),
  });
}

export function joinRoom(
  code: string,
  appUserId: string,
  displayName: string,
  avatarUrl?: string,
): Promise<PartyRoom> {
  return request<PartyRoom>(`/rooms/${code.toUpperCase()}/join`, {
    method: "POST",
    body: JSON.stringify({
      appUserId,
      avatarUrl: avatarUrl || "",
      displayName,
    }),
  });
}

export function getRoom(code: string): Promise<PartyRoom> {
  return request<PartyRoom>(`/rooms/${code.toUpperCase()}`);
}

export function getSpotifyLoginUrl(
  code: string,
  displayName: string,
  appUserId?: string,
): Promise<SpotifyLoginResponse> {
  const query = new URLSearchParams({
    roomCode: code.toUpperCase(),
    displayName: displayName.trim() || "Invitado",
  });

  if (appUserId) {
    query.set("appUserId", appUserId);
  }

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
