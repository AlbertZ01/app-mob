import type { Session } from "@supabase/supabase-js";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import * as QueryParams from "expo-auth-session/build/QueryParams";
import * as Updates from "expo-updates";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking as NativeLinking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  addDemoFriend,
  createRoom,
  finishParty,
  generateSession,
  getRoom,
  getSpotifyLoginUrl,
  savePlaylist,
  sendLiveVote,
} from "./src/services/api";
import { AuthScreen } from "./src/components/AuthScreen";
import {
  appReleaseId,
  authRedirectUrl,
  hasSupabaseConfig,
  supabase,
  supabaseProjectHost,
} from "./src/lib/supabase";
import type { PartyMember, PartyMode, PartyRoom, Track } from "./src/types/party";

type IconName = ComponentProps<typeof Ionicons>["name"];
type TabKey = "sala" | "perfiles" | "sesion" | "live" | "resumen";
type AuthProvider = "apple" | "google";
type AuthenticatedUser = {
  displayName: string;
  email: string;
};

WebBrowser.maybeCompleteAuthSession();

const MODES: { id: PartyMode; label: string }[] = [
  { id: "previa", label: "Previa" },
  { id: "casa", label: "Casa" },
  { id: "coche", label: "Coche" },
  { id: "terraza", label: "Terraza" },
  { id: "barbacoa", label: "Barbacoa" },
  { id: "fiesta_fuerte", label: "Fiesta fuerte" },
  { id: "after", label: "After" },
  { id: "cierre_emocional", label: "Cierre emocional" },
];

const TABS: { id: TabKey; label: string; icon: IconName }[] = [
  { id: "sala", label: "Sala", icon: "people" },
  { id: "perfiles", label: "Roasts", icon: "flame" },
  { id: "sesion", label: "Sesion", icon: "radio" },
  { id: "live", label: "Live", icon: "pulse" },
  { id: "resumen", label: "Final", icon: "trophy" },
];

const LIVE_VOTES = [
  "mas conocida",
  "mas dura",
  "mas perreo",
  "mas elegante",
  "baja revoluciones",
  "sube esto ya",
  "sorpresa",
];

function mapAuthError(error: unknown) {
  const raw = error instanceof Error ? error.message : "No se pudo autenticar la cuenta.";

  if (/email not confirmed/i.test(raw)) {
    return "La cuenta existe, pero Supabase exige confirmar el correo. Abre el email de confirmacion o desactiva Confirm email en Supabase > Authentication > Providers > Email.";
  }

  if (/invalid login credentials/i.test(raw)) {
    return "Correo o contrasena incorrectos.";
  }

  if (/user already registered/i.test(raw)) {
    return "Ese correo ya tiene cuenta. Usa Entrar o recupera la contrasena.";
  }

  if (/signup is disabled/i.test(raw)) {
    return "El registro por correo esta desactivado en Supabase. Activa Email en Authentication > Providers.";
  }

  if (/network request failed/i.test(raw)) {
    return "La app no puede hablar con el backend o con Supabase. Revisa la conexion y vuelve a intentarlo.";
  }

  return raw;
}

export default function App() {
  const [authBusy, setAuthBusy] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const lastHandledAuthUrl = useRef("");

  const createSessionFromUrl = useCallback(async (url: string) => {
    if (!supabase) {
      throw new Error("Falta configurar Supabase en la build instalada.");
    }

    if (!url.startsWith(authRedirectUrl)) {
      return;
    }

    if (lastHandledAuthUrl.current === url) {
      return;
    }

    lastHandledAuthUrl.current = url;

    const { errorCode, params } = QueryParams.getQueryParams(url);

    if (errorCode) {
      throw new Error(errorCode);
    }

    const accessToken = Array.isArray(params.access_token)
      ? params.access_token[0]
      : params.access_token;
    const refreshToken = Array.isArray(params.refresh_token)
      ? params.refresh_token[0]
      : params.refresh_token;

    if (!accessToken || !refreshToken) {
      throw new Error("El proveedor no devolvio la sesion a la app.");
    }

    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      throw error;
    }

    setSession(data.session);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .finally(() => setAuthReady(true));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) {
      return;
    }

    let cancelled = false;

    const checkForUpdates = async () => {
      try {
        const update = await Updates.checkForUpdateAsync();

        if (!update.isAvailable || cancelled) {
          return;
        }

        await Updates.fetchUpdateAsync();

        if (cancelled) {
          return;
        }

        Alert.alert("Actualizacion lista", "Hay una version nueva descargada. Reinicia la app para cargarla.", [
          { text: "Luego", style: "cancel" },
          {
            text: "Reiniciar ahora",
            onPress: () => {
              void Updates.reloadAsync();
            },
          },
        ]);
      } catch {
        // Silently ignore OTA check failures; auth and core flows should still work.
      }
    };

    void checkForUpdates();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      void createSessionFromUrl(url).catch((error) => {
        Alert.alert("Login", mapAuthError(error));
      });
    };

    NativeLinking.getInitialURL()
      .then((url) => {
        if (url) {
          handleUrl({ url });
        }
      })
      .catch(() => undefined);

    const subscription = NativeLinking.addEventListener("url", handleUrl);

    return () => subscription.remove();
  }, [createSessionFromUrl]);

  async function runAuth(label: string, action: () => Promise<void>) {
    setAuthBusy(label);
    try {
      await action();
    } catch (error) {
      Alert.alert("Login", mapAuthError(error));
    } finally {
      setAuthBusy("");
    }
  }

  async function handleEmailSignIn(email: string, password: string) {
    await runAuth("signin", async () => {
      if (!supabase) {
        throw new Error("Falta configurar Supabase en la build instalada.");
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw error;
      }
    });
  }

  async function handleEmailSignUp(email: string, password: string) {
    await runAuth("signup", async () => {
      if (!supabase) {
        throw new Error("Falta configurar Supabase en la build instalada.");
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: email.split("@")[0] || "party friend",
          },
          emailRedirectTo: authRedirectUrl,
        },
      });

      if (error) {
        throw error;
      }

      if (!data.session) {
        Alert.alert(
          "Cuenta creada",
          "Supabase ha creado la cuenta, pero todavia no ha abierto sesion. Si tienes Confirm email activado, confirma el correo y vuelve a entrar. Si quieres entrar al instante, desactiva Confirm email en Supabase > Authentication > Providers > Email.",
        );
      }
    });
  }

  async function handleSocialSignIn(provider: AuthProvider) {
    await runAuth(provider, async () => {
      if (!supabase) {
        throw new Error("Falta configurar Supabase en la build instalada.");
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: authRedirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.url) {
        throw new Error("Supabase no devolvio una URL valida para el proveedor.");
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, authRedirectUrl);

      if (result.type === "success") {
        await createSessionFromUrl(result.url);
      }
    });
  }

  async function handleSignOut() {
    await runAuth("signout", async () => {
      if (!supabase) {
        return;
      }

      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
      setSession(null);
    });
  }

  if (!authReady) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.authLoading}>
          <ActivityIndicator color="#D9B44A" size="large" />
          <Text style={styles.authLoadingText}>Cargando acceso...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        busy={authBusy}
        buildReleaseId={appReleaseId}
        canUseAuth={hasSupabaseConfig}
        onSignIn={handleEmailSignIn}
        onSignUp={handleEmailSignUp}
        onSocial={handleSocialSignIn}
        supabaseProjectHost={supabaseProjectHost}
      />
    );
  }

  return (
    <PartyExperience
      authenticatedUser={sessionToUser(session)}
      onSignOut={handleSignOut}
      signingOut={authBusy === "signout"}
    />
  );
}

function PartyExperience({
  authenticatedUser,
  onSignOut,
  signingOut,
}: {
  authenticatedUser: AuthenticatedUser;
  onSignOut: () => Promise<void>;
  signingOut: boolean;
}) {
  const [room, setRoom] = useState<PartyRoom | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("sala");
  const [selectedMode, setSelectedMode] = useState<PartyMode>("previa");
  const [displayName, setDisplayName] = useState(authenticatedUser.displayName);
  const [joinCode, setJoinCode] = useState("");
  const [busyLabel, setBusyLabel] = useState("");

  const memberCount = room?.members.length || 0;
  const canUsePartyTools = memberCount > 0 && !busyLabel;

  useEffect(() => {
    setDisplayName(authenticatedUser.displayName);
  }, [authenticatedUser.displayName]);

  useEffect(() => {
    if (!room?.code) {
      return;
    }

    const timer = setInterval(() => {
      getRoom(room.code)
        .then(setRoom)
        .catch(() => undefined);
    }, 6000);

    return () => clearInterval(timer);
  }, [room?.code]);

  async function run(label: string, action: () => Promise<void>) {
    setBusyLabel(label);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ha fallado la accion.";
      Alert.alert("Error", message);
    } finally {
      setBusyLabel("");
    }
  }

  async function handleCreateRoom() {
    await run("Creando sala", async () => {
      const nextRoom = await createRoom(selectedMode, displayName);
      setRoom(nextRoom);
      setActiveTab("sala");
    });
  }

  async function handleJoinRoom() {
    const code = joinCode.trim().toUpperCase();

    if (!code) {
      Alert.alert("Codigo necesario", "Introduce el codigo de la sala.");
      return;
    }

    await run("Entrando", async () => {
      const nextRoom = await getRoom(code);
      setRoom(nextRoom);
      setActiveTab("sala");
    });
  }

  async function handleConnectSpotify() {
    if (!room) {
      return;
    }

    await run("Abriendo Spotify", async () => {
      const login = await getSpotifyLoginUrl(room.code, displayName);
      await NativeLinking.openURL(login.url);
      Alert.alert(
        "Spotify abierto",
        "Cuando termines el login, vuelve a la app y pulsa refrescar sala.",
      );
    });
  }

  async function handleRefreshRoom() {
    if (!room) {
      return;
    }

    await run("Refrescando", async () => {
      setRoom(await getRoom(room.code));
    });
  }

  async function handleDemoFriend() {
    if (!room) {
      return;
    }

    await run("Sumando amigo demo", async () => {
      const nextRoom = await addDemoFriend(room.code, displayName);
      setRoom(nextRoom);
      setActiveTab("perfiles");
    });
  }

  async function handleGenerateSession() {
    if (!room) {
      return;
    }

    await run("Generando sesion", async () => {
      const nextRoom = await generateSession(room.code, selectedMode);
      setRoom(nextRoom);
      setActiveTab("sesion");
    });
  }

  async function handleLiveVote(label: string) {
    if (!room) {
      return;
    }

    await run(label, async () => {
      const nextRoom = await sendLiveVote(room.code, label);
      setRoom(nextRoom);
      setActiveTab("live");
    });
  }

  async function handleFinishParty() {
    if (!room) {
      return;
    }

    await run("Cerrando fiesta", async () => {
      const nextRoom = await finishParty(room.code);
      setRoom(nextRoom);
      setActiveTab("resumen");
    });
  }

  async function handleSavePlaylist() {
    if (!room) {
      return;
    }

    await run("Guardando playlist", async () => {
      const saved = await savePlaylist(room.code);
      const nextRoom = await getRoom(room.code);
      setRoom(nextRoom);
      Alert.alert("Playlist guardada", saved.playlistUrl);
      await NativeLinking.openURL(saved.playlistUrl);
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", android: undefined })}
        style={styles.screen}
      >
        <LinearGradient colors={["#0D1321", "#1D7874"]} style={styles.header}>
          <View style={styles.brandRow}>
            <Image source={require("./assets/icon.png")} style={styles.logo} />
            <View style={styles.brandCopy}>
              <Text style={styles.appName}>kazp</Text>
              <Text style={styles.caption}>group music control</Text>
            </View>
            {room ? <CodeBadge code={room.code} /> : null}
          </View>

          <Text style={styles.title}>
            Analiza el Spotify del grupo y monta la fiesta sin crimenes musicales.
          </Text>

          <View style={styles.modeRow}>
            {MODES.map((mode) => (
              <Pill
                key={mode.id}
                active={selectedMode === mode.id}
                label={mode.label}
                onPress={() => setSelectedMode(mode.id)}
              />
            ))}
          </View>
          <View style={styles.authSessionRow}>
            <Text numberOfLines={1} style={styles.authSessionText}>
              {authenticatedUser.email}
            </Text>
            <Pressable onPress={() => void onSignOut()} style={styles.signOutButton}>
              {signingOut ? (
                <ActivityIndicator color="#F8F4E3" size="small" />
              ) : (
                <>
                  <Ionicons color="#F8F4E3" name="log-out-outline" size={16} />
                  <Text style={styles.signOutText}>Salir</Text>
                </>
              )}
            </Pressable>
          </View>
        </LinearGradient>

        {room ? (
          <>
            <TabBar activeTab={activeTab} onChange={setActiveTab} />
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              {activeTab === "sala" ? (
                <RoomScreen
                  busyLabel={busyLabel}
                  canUsePartyTools={canUsePartyTools}
                  displayName={displayName}
                  onAddDemoFriend={handleDemoFriend}
                  onConnectSpotify={handleConnectSpotify}
                  onGenerateSession={handleGenerateSession}
                  onRefresh={handleRefreshRoom}
                  room={room}
                  setDisplayName={setDisplayName}
                />
              ) : null}
              {activeTab === "perfiles" ? <ProfilesScreen members={room.members} /> : null}
              {activeTab === "sesion" ? (
                <SessionScreen
                  canUsePartyTools={canUsePartyTools}
                  onGenerateSession={handleGenerateSession}
                  onSavePlaylist={handleSavePlaylist}
                  playlist={room.playlist}
                />
              ) : null}
              {activeTab === "live" ? (
                <LiveScreen
                  busyLabel={busyLabel}
                  live={room.live}
                  onFinishParty={handleFinishParty}
                  onVote={handleLiveVote}
                />
              ) : null}
              {activeTab === "resumen" ? (
                <SummaryScreen onFinishParty={handleFinishParty} summary={room.summary} />
              ) : null}
            </ScrollView>
          </>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <HomeScreen
              busyLabel={busyLabel}
              displayName={displayName}
              joinCode={joinCode}
              onCreateRoom={handleCreateRoom}
              onJoinRoom={handleJoinRoom}
              setDisplayName={setDisplayName}
              setJoinCode={setJoinCode}
            />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function sessionToUser(session: Session): AuthenticatedUser {
  const displayName =
    session.user.user_metadata?.display_name ||
    session.user.user_metadata?.full_name ||
    session.user.email?.split("@")[0] ||
    "party friend";

  return {
    displayName,
    email: session.user.email || "usuario sin correo",
  };
}

function HomeScreen({
  busyLabel,
  displayName,
  joinCode,
  onCreateRoom,
  onJoinRoom,
  setDisplayName,
  setJoinCode,
}: {
  busyLabel: string;
  displayName: string;
  joinCode: string;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  setDisplayName: (value: string) => void;
  setJoinCode: (value: string) => void;
}) {
  return (
    <>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Crear fiesta</Text>
        <TextInput
          onChangeText={setDisplayName}
          placeholder="Tu nombre"
          placeholderTextColor="#7A8582"
          style={styles.input}
          value={displayName}
        />
        <AppButton icon="add-circle" label="Crear sala" loading={busyLabel === "Creando sala"} onPress={onCreateRoom} />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Unirse con codigo</Text>
        <TextInput
          autoCapitalize="characters"
          onChangeText={setJoinCode}
          placeholder="ABCD12"
          placeholderTextColor="#7A8582"
          style={styles.input}
          value={joinCode}
        />
        <AppButton icon="enter" label="Entrar" loading={busyLabel === "Entrando"} onPress={onJoinRoom} variant="dark" />
      </View>

      <FeatureGrid />
    </>
  );
}

function RoomScreen({
  busyLabel,
  canUsePartyTools,
  displayName,
  onAddDemoFriend,
  onConnectSpotify,
  onGenerateSession,
  onRefresh,
  room,
  setDisplayName,
}: {
  busyLabel: string;
  canUsePartyTools: boolean;
  displayName: string;
  onAddDemoFriend: () => void;
  onConnectSpotify: () => void;
  onGenerateSession: () => void;
  onRefresh: () => void;
  room: PartyRoom;
  setDisplayName: (value: string) => void;
}) {
  return (
    <>
      <View style={styles.statsGrid}>
        <Metric label="Amigos" value={String(room.members.length)} />
        <Metric label="Compatibilidad" value={`${room.scores.compatibility}%`} />
        <Metric label="Caos" value={`${room.scores.chaos}%`} hot />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Conectar Spotify</Text>
        <Text style={styles.bodyText}>
          Cada amigo conecta su cuenta. El backend lee top artistas, canciones y generos; las claves
          nunca van en la app.
        </Text>
        <TextInput
          onChangeText={setDisplayName}
          placeholder="Nombre para la sala"
          placeholderTextColor="#7A8582"
          style={styles.input}
          value={displayName}
        />
        <View style={styles.actionRow}>
          <AppButton
            icon="musical-notes"
            label="Conectar"
            loading={busyLabel === "Abriendo Spotify"}
            onPress={onConnectSpotify}
          />
          <AppButton icon="refresh" label="Refrescar" onPress={onRefresh} variant="dark" />
        </View>
        <AppButton
          icon="sparkles"
          label="Anadir amigo demo"
          loading={busyLabel === "Sumando amigo demo"}
          onPress={onAddDemoFriend}
          variant="ghost"
        />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Sala del grupo</Text>
        {room.members.length === 0 ? (
          <EmptyState
            icon="people-outline"
            text="Conecta Spotify o suma amigos demo para ver roasts, compatibilidad y playlist."
            title="La sala aun esta vacia"
          />
        ) : (
          room.members.map((member) => <MemberMini key={member.id} member={member} />)
        )}
        <AppButton
          disabled={!canUsePartyTools}
          icon="radio"
          label="Generar sesion IA"
          loading={busyLabel === "Generando sesion"}
          onPress={onGenerateSession}
        />
      </View>

      <CompatibilityCard room={room} />
    </>
  );
}

function ProfilesScreen({ members }: { members: PartyMember[] }) {
  if (members.length === 0) {
    return (
      <EmptyState
        icon="flame-outline"
        text="Conecta amigos para que la IA genere arquetipos, delitos musicales e insignias."
        title="Sin victimas todavia"
      />
    );
  }

  return (
    <>
      {members.map((member) => (
        <View key={member.id} style={styles.profileCard}>
          <View style={styles.profileHeader}>
            <Avatar member={member} size={54} />
            <View style={styles.profileHeaderText}>
              <Text style={styles.memberName}>{member.displayName}</Text>
              <Text style={styles.archetype}>{member.profile.archetype}</Text>
            </View>
          </View>
          <Text style={styles.roastText}>{member.profile.roast}</Text>
          <TagSection color="#1D7874" items={member.profile.strengths} title="Fortalezas" />
          <TagSection color="#EE4266" items={member.profile.crimes} title="Delitos musicales" />
          <TagSection color="#D9B44A" items={member.profile.badges} title="Insignias" />
        </View>
      ))}
    </>
  );
}

function SessionScreen({
  canUsePartyTools,
  onGenerateSession,
  onSavePlaylist,
  playlist,
}: {
  canUsePartyTools: boolean;
  onGenerateSession: () => void;
  onSavePlaylist: () => void;
  playlist: PartyRoom["playlist"];
}) {
  return (
    <>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>{playlist.title}</Text>
        <Text style={styles.bodyText}>{playlist.strategy}</Text>
        <View style={styles.phaseRow}>
          {playlist.phases.map((phase) => (
            <View key={phase.name} style={styles.phaseCard}>
              <Text style={styles.phaseName}>{phase.name}</Text>
              <Text style={styles.phaseEnergy}>{phase.energy}%</Text>
              <Text style={styles.phaseIntent}>{phase.intent}</Text>
            </View>
          ))}
        </View>
        <View style={styles.actionRow}>
          <AppButton
            disabled={!canUsePartyTools}
            icon="sparkles"
            label="Recalcular"
            onPress={onGenerateSession}
          />
          <AppButton icon="save" label="Guardar" onPress={onSavePlaylist} variant="dark" />
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Playlist propuesta</Text>
        {playlist.tracks.length === 0 ? (
          <EmptyState
            icon="musical-notes-outline"
            text="Cuando haya amigos conectados, la app mezclara sus canciones candidatas."
            title="Aun no hay sesion"
          />
        ) : (
          playlist.tracks.map((track, index) => <TrackRow key={`${track.id}-${index}`} index={index} track={track} />)
        )}
      </View>
    </>
  );
}

function LiveScreen({
  busyLabel,
  live,
  onFinishParty,
  onVote,
}: {
  busyLabel: string;
  live: PartyRoom["live"];
  onFinishParty: () => void;
  onVote: (label: string) => void;
}) {
  return (
    <>
      <View style={styles.liveHero}>
        <Text style={styles.liveLabel}>Energia del grupo</Text>
        <Text style={styles.energyValue}>{live.energy}%</Text>
        <Text style={styles.liveComment}>{live.lastCommentary}</Text>
        {live.currentTrack ? <TrackRow index={0} track={live.currentTrack} /> : null}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Botones de mood</Text>
        <View style={styles.voteGrid}>
          {LIVE_VOTES.map((vote) => (
            <Pressable key={vote} onPress={() => onVote(vote)} style={styles.voteButton}>
              {busyLabel === vote ? <ActivityIndicator color="#0D1321" /> : <Text style={styles.voteText}>{vote}</Text>}
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Reacciones recientes</Text>
        {live.votes.length === 0 ? (
          <Text style={styles.bodyText}>Aun no hay votos. La democracia musical esta sospechosamente tranquila.</Text>
        ) : (
          live.votes.slice(0, 6).map((vote) => (
            <View key={vote.id} style={styles.voteLog}>
              <Ionicons color="#D9B44A" name="flash" size={16} />
              <Text style={styles.voteLogText}>{vote.label}</Text>
            </View>
          ))
        )}
        <AppButton icon="trophy" label="Generar resumen final" onPress={onFinishParty} variant="dark" />
      </View>
    </>
  );
}

function SummaryScreen({
  onFinishParty,
  summary,
}: {
  onFinishParty: () => void;
  summary: PartyRoom["summary"];
}) {
  if (!summary) {
    return (
      <View style={styles.panel}>
        <EmptyState
          icon="trophy-outline"
          text="Cuando acabe la sesion, la IA reparte premios, acusa al saboteador del AUX y resume el desastre."
          title="Todavia no hay acta final"
        />
        <AppButton icon="trophy" label="Crear resumen" onPress={onFinishParty} />
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Resumen oficial de la noche</Text>
      <SummaryLine label="MVP musical" value={summary.mvp} />
      <SummaryLine label="Saboteador del AUX" value={summary.auxSaboteur} />
      <SummaryLine label="Mas predecible" value={summary.predictable} />
      <SummaryLine label="Tema que salvo la fiesta" value={summary.saveTrack} />
      <SummaryLine label="Momento pico" value={summary.peakMoment} />
      <SummaryLine label="Descenso a la miseria" value={summary.emotionalCrash} />
      <Text style={styles.finalVerdict}>{summary.finalVerdict}</Text>
      <TagSection color="#1D7874" items={summary.awards} title="Premios" />
    </View>
  );
}

function FeatureGrid() {
  const items: { icon: IconName; title: string; text: string }[] = [
    { icon: "person-circle", title: "Perfiles", text: "Arquetipos, roasts y delitos musicales." },
    { icon: "analytics", title: "Compatibilidad", text: "Fiesta, coche, gym, after y bajona." },
    { icon: "radio", title: "Live DJ", text: "Votos simples para cambiar el rumbo." },
    { icon: "share-social", title: "Viral", text: "Resumen y premios listos para compartir." },
  ];

  return (
    <View style={styles.featureGrid}>
      {items.map((item) => (
        <View key={item.title} style={styles.featureCard}>
          <Ionicons color="#EE4266" name={item.icon} size={22} />
          <Text style={styles.featureTitle}>{item.title}</Text>
          <Text style={styles.featureText}>{item.text}</Text>
        </View>
      ))}
    </View>
  );
}

function CompatibilityCard({ room }: { room: PartyRoom }) {
  const rows: { label: string; value: number }[] = [
    { label: "Fiesta", value: room.scores.party },
    { label: "Coche", value: room.scores.car },
    { label: "Gym", value: room.scores.gym },
    { label: "After", value: room.scores.after },
    { label: "Sufrir", value: room.scores.sad },
  ];

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Compatibilidad por contexto</Text>
      {rows.map(({ label, value }) => (
        <View key={label} style={styles.scoreRow}>
          <Text style={styles.scoreLabel}>{label}</Text>
          <View style={styles.scoreTrack}>
            <View style={[styles.scoreFill, { width: `${value}%` }]} />
          </View>
          <Text style={styles.scoreValue}>{value}%</Text>
        </View>
      ))}
    </View>
  );
}

function MemberMini({ member }: { member: PartyMember }) {
  return (
    <View style={styles.memberMini}>
      <Avatar member={member} size={44} />
      <View style={styles.memberMiniText}>
        <Text style={styles.memberName}>{member.displayName}</Text>
        <Text numberOfLines={1} style={styles.memberMeta}>
          {member.profile.archetype} | {member.stats.decadeBias}
        </Text>
      </View>
      <Text style={styles.miniScore}>{member.stats.partyScore}%</Text>
    </View>
  );
}

function TrackRow({ index, track }: { index: number; track: Track }) {
  return (
    <Pressable
      onPress={() => {
        if (track.spotifyUrl) {
          NativeLinking.openURL(track.spotifyUrl);
        }
      }}
      style={styles.trackRow}
    >
      <Text style={styles.trackIndex}>{index + 1}</Text>
      {track.imageUrl ? (
        <Image source={{ uri: track.imageUrl }} style={styles.cover} />
      ) : (
        <View style={styles.coverFallback}>
          <Ionicons color="#D9B44A" name="disc-outline" size={22} />
        </View>
      )}
      <View style={styles.trackCopy}>
        <Text numberOfLines={1} style={styles.trackTitle}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={styles.trackArtist}>
          {track.artist}
        </Text>
      </View>
      <Ionicons color="#1D7874" name="open-outline" size={18} />
    </Pressable>
  );
}

function AppButton({
  disabled,
  icon,
  label,
  loading,
  onPress,
  variant = "primary",
}: {
  disabled?: boolean;
  icon: IconName;
  label: string;
  loading?: boolean;
  onPress: () => void;
  variant?: "primary" | "dark" | "ghost";
}) {
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "dark" && styles.buttonDark,
        variant === "ghost" && styles.buttonGhost,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {loading ? <ActivityIndicator color={variant === "dark" ? "#F8F4E3" : "#0D1321"} /> : <Ionicons color={variant === "dark" ? "#F8F4E3" : "#0D1321"} name={icon} size={18} />}
      <Text style={[styles.buttonText, variant === "dark" && styles.buttonTextDark]}>{label}</Text>
    </Pressable>
  );
}

function Pill({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </Pressable>
  );
}

function TabBar({ activeTab, onChange }: { activeTab: TabKey; onChange: (tab: TabKey) => void }) {
  return (
    <View style={styles.tabBar}>
      {TABS.map((tab) => (
        <Pressable key={tab.id} onPress={() => onChange(tab.id)} style={styles.tabButton}>
          <Ionicons color={activeTab === tab.id ? "#EE4266" : "#596663"} name={tab.icon} size={20} />
          <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>{tab.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function CodeBadge({ code }: { code: string }) {
  return (
    <View style={styles.codeBadge}>
      <Text style={styles.codeLabel}>Codigo</Text>
      <Text style={styles.codeText}>{code}</Text>
    </View>
  );
}

function Metric({ hot, label, value }: { hot?: boolean; label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, hot && styles.metricHot]}>{value}</Text>
    </View>
  );
}

function Avatar({ member, size }: { member: PartyMember; size: number }) {
  if (member.avatarUrl) {
    return <Image source={{ uri: member.avatarUrl }} style={{ borderRadius: size / 2, height: size, width: size }} />;
  }

  return (
    <View style={[styles.avatarFallback, { borderRadius: size / 2, height: size, width: size }]}>
      <Text style={styles.avatarInitial}>{member.displayName.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function TagSection({ color, items, title }: { color: string; items: string[]; title: string }) {
  return (
    <View style={styles.tagSection}>
      <Text style={styles.tagTitle}>{title}</Text>
      <View style={styles.tagRow}>
        {items.map((item) => (
          <View key={item} style={[styles.tag, { borderColor: color }]}>
            <Text style={styles.tagText}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function EmptyState({ icon, text, title }: { icon: IconName; text: string; title: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons color="#D9B44A" name={icon} size={32} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0D1321",
  },
  authLoading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  authLoadingText: {
    color: "#F8F4E3",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 12,
  },
  screen: {
    flex: 1,
    backgroundColor: "#F8F4E3",
  },
  header: {
    paddingBottom: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  brandCopy: {
    flex: 1,
  },
  logo: {
    borderRadius: 14,
    height: 46,
    width: 46,
  },
  appName: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  caption: {
    color: "#B8CCC8",
    fontSize: 12,
    marginTop: 2,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 34,
    marginBottom: 16,
  },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  authSessionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  authSessionText: {
    color: "#D8E3E0",
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  signOutButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    height: 34,
    justifyContent: "center",
    minWidth: 78,
    paddingHorizontal: 10,
  },
  signOutText: {
    color: "#F8F4E3",
    fontSize: 12,
    fontWeight: "900",
  },
  pill: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  pillActive: {
    backgroundColor: "#D9B44A",
    borderColor: "#D9B44A",
  },
  pillText: {
    color: "#F8F4E3",
    fontSize: 12,
    fontWeight: "800",
  },
  pillTextActive: {
    color: "#0D1321",
  },
  tabBar: {
    backgroundColor: "#FFFFFF",
    borderBottomColor: "#E3DED0",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  tabButton: {
    alignItems: "center",
    gap: 3,
    minWidth: 58,
  },
  tabText: {
    color: "#596663",
    fontSize: 11,
    fontWeight: "800",
  },
  tabTextActive: {
    color: "#EE4266",
  },
  content: {
    padding: 16,
    paddingBottom: 34,
  },
  panel: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E3DED0",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  panelTitle: {
    color: "#0D1321",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 10,
  },
  bodyText: {
    color: "#4E5B58",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  input: {
    backgroundColor: "#F8F4E3",
    borderColor: "#E3DED0",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0D1321",
    fontSize: 16,
    height: 48,
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#D9B44A",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    height: 46,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  buttonDark: {
    backgroundColor: "#0D1321",
  },
  buttonGhost: {
    backgroundColor: "#F8F4E3",
    borderColor: "#E3DED0",
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    transform: [{ scale: 0.99 }],
  },
  buttonText: {
    color: "#0D1321",
    fontSize: 15,
    fontWeight: "900",
  },
  buttonTextDark: {
    color: "#F8F4E3",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  featureGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  featureCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E3DED0",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: "48%",
    flexGrow: 1,
    minHeight: 118,
    padding: 14,
  },
  featureTitle: {
    color: "#0D1321",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 8,
  },
  featureText: {
    color: "#596663",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  codeBadge: {
    alignItems: "flex-end",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  codeLabel: {
    color: "#B8CCC8",
    fontSize: 10,
    fontWeight: "800",
  },
  codeText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  metricCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E3DED0",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 12,
  },
  metricLabel: {
    color: "#596663",
    fontSize: 11,
    fontWeight: "800",
  },
  metricValue: {
    color: "#1D7874",
    fontSize: 24,
    fontWeight: "900",
    marginTop: 4,
  },
  metricHot: {
    color: "#EE4266",
  },
  memberMini: {
    alignItems: "center",
    borderBottomColor: "#EEE7D8",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
  },
  memberMiniText: {
    flex: 1,
  },
  memberName: {
    color: "#0D1321",
    fontSize: 16,
    fontWeight: "900",
  },
  memberMeta: {
    color: "#596663",
    fontSize: 12,
    marginTop: 3,
  },
  miniScore: {
    color: "#1D7874",
    fontSize: 16,
    fontWeight: "900",
  },
  scoreRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  scoreLabel: {
    color: "#0D1321",
    fontSize: 13,
    fontWeight: "800",
    width: 70,
  },
  scoreTrack: {
    backgroundColor: "#EEE7D8",
    borderRadius: 999,
    flex: 1,
    height: 9,
    overflow: "hidden",
  },
  scoreFill: {
    backgroundColor: "#1D7874",
    height: 9,
  },
  scoreValue: {
    color: "#596663",
    fontSize: 12,
    fontWeight: "900",
    width: 38,
  },
  profileCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E3DED0",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  profileHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  profileHeaderText: {
    flex: 1,
  },
  archetype: {
    color: "#EE4266",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 3,
  },
  roastText: {
    color: "#0D1321",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
    marginBottom: 12,
  },
  tagSection: {
    marginTop: 10,
  },
  tagTitle: {
    color: "#596663",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tag: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  tagText: {
    color: "#0D1321",
    fontSize: 12,
    fontWeight: "800",
  },
  phaseRow: {
    gap: 8,
    marginBottom: 12,
  },
  phaseCard: {
    backgroundColor: "#F8F4E3",
    borderRadius: 8,
    padding: 12,
  },
  phaseName: {
    color: "#0D1321",
    fontSize: 14,
    fontWeight: "900",
  },
  phaseEnergy: {
    color: "#EE4266",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 4,
  },
  phaseIntent: {
    color: "#596663",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  trackRow: {
    alignItems: "center",
    backgroundColor: "#F8F4E3",
    borderRadius: 8,
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
    padding: 9,
  },
  trackIndex: {
    color: "#596663",
    fontSize: 13,
    fontWeight: "900",
    width: 20,
  },
  cover: {
    borderRadius: 6,
    height: 50,
    width: 50,
  },
  coverFallback: {
    alignItems: "center",
    backgroundColor: "#0D1321",
    borderRadius: 6,
    height: 50,
    justifyContent: "center",
    width: 50,
  },
  trackCopy: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    color: "#0D1321",
    fontSize: 15,
    fontWeight: "900",
  },
  trackArtist: {
    color: "#596663",
    fontSize: 13,
    marginTop: 3,
  },
  liveHero: {
    backgroundColor: "#0D1321",
    borderRadius: 8,
    marginBottom: 14,
    padding: 16,
  },
  liveLabel: {
    color: "#B8CCC8",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  energyValue: {
    color: "#D9B44A",
    fontSize: 54,
    fontWeight: "900",
    marginTop: 2,
  },
  liveComment: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 25,
    marginBottom: 12,
  },
  voteGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  voteButton: {
    alignItems: "center",
    backgroundColor: "#D9B44A",
    borderRadius: 8,
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  voteText: {
    color: "#0D1321",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  voteLog: {
    alignItems: "center",
    borderBottomColor: "#EEE7D8",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 9,
  },
  voteLogText: {
    color: "#0D1321",
    fontSize: 14,
    fontWeight: "800",
  },
  summaryLine: {
    borderBottomColor: "#EEE7D8",
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  summaryLabel: {
    color: "#596663",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  summaryValue: {
    color: "#0D1321",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 3,
  },
  finalVerdict: {
    color: "#EE4266",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 24,
    marginTop: 14,
  },
  emptyState: {
    alignItems: "flex-start",
    backgroundColor: "#F8F4E3",
    borderRadius: 8,
    marginBottom: 12,
    padding: 16,
  },
  emptyTitle: {
    color: "#0D1321",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 10,
  },
  emptyText: {
    color: "#596663",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 5,
  },
  avatarFallback: {
    alignItems: "center",
    backgroundColor: "#1D7874",
    justifyContent: "center",
  },
  avatarInitial: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
});
