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
  AppState,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking as NativeLinking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createRoomWithProfile,
  finishParty,
  generateSession,
  getRoom,
  getSpotifyLoginUrl,
  joinRoom,
  savePlaylist,
  sendLiveVote,
} from "./src/services/api";
import { AuthScreen } from "./src/components/AuthScreen";
import {
  authRedirectUrl,
  hasSupabaseConfig,
  supabase,
} from "./src/lib/supabase";
import type { PartyMember, PartyMode, PartyRoom, Track } from "./src/types/party";

type IconName = ComponentProps<typeof Ionicons>["name"];
type TabKey = "sala" | "perfiles" | "sesion" | "live" | "resumen" | "perfil";
type AuthProvider = "apple" | "google";
type AuthenticatedUser = {
  avatarUrl: string;
  favoriteMode: PartyMode;
  id: string;
  displayName: string;
  email: string;
  tagline: string;
};
type UpdateState = "checking" | "downloading" | "idle" | "ready";

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
  { id: "perfiles", label: "Grupo", icon: "flame" },
  { id: "sesion", label: "Sesion", icon: "radio" },
  { id: "live", label: "Live", icon: "pulse" },
  { id: "resumen", label: "Final", icon: "trophy" },
  { id: "perfil", label: "Yo", icon: "person-circle" },
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

const THEME = {
  accent: "#A7E3BE",
  accentDeep: "#7FC99D",
  accentSoft: "#1E3B31",
  background: "#07110D",
  border: "#27483B",
  danger: "#FF7A97",
  input: "#0D1713",
  muted: "#9CB8AD",
  mutedSoft: "#71897F",
  panel: "#0F1D18",
  panelRaised: "#142720",
  panelSoft: "#183229",
  text: "#F2FFF7",
};

function mapAuthError(error: unknown) {
  const raw = error instanceof Error ? error.message : "No se pudo autenticar la cuenta.";

  if (/email not confirmed/i.test(raw)) {
    return "La cuenta existe, pero Supabase exige confirmar el correo. Abre el email de confirmacion o desactiva Email Confirmations en Supabase > Authentication > Settings.";
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
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [pendingInviteCode, setPendingInviteCode] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const lastHandledAuthUrl = useRef("");
  const updateCheckInFlight = useRef(false);

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

  const checkForUpdates = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled || updateCheckInFlight.current) {
      return;
    }

    updateCheckInFlight.current = true;

    try {
      setUpdateState("checking");
      setUpdateError("");
      const update = await Updates.checkForUpdateAsync();

      setIsUpdateAvailable(update.isAvailable);
      setUpdateState(update.isAvailable ? "ready" : "idle");
    } catch (error) {
      setIsUpdateAvailable(false);
      setUpdateState("idle");
      setUpdateError(error instanceof Error ? error.message : "No se pudo buscar una actualizacion.");
    } finally {
      updateCheckInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void checkForUpdates();

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void checkForUpdates();
      }
    });

    return () => subscription.remove();
  }, [checkForUpdates]);

  async function handleApplyUpdate() {
    if (__DEV__ || !Updates.isEnabled) {
      return;
    }

    setUpdateState("downloading");
    setUpdateError("");

    try {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (error) {
      setUpdateState("ready");
      setUpdateError(error instanceof Error ? error.message : "No se pudo aplicar la actualizacion.");
    }
  }

  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      const inviteCode = inviteCodeFromUrl(url);

      if (inviteCode) {
        setPendingInviteCode(inviteCode);
        return;
      }

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
          "Supabase ha creado la cuenta, pero todavia no ha abierto sesion. Si tienes Confirm email activado, confirma el correo y vuelve a entrar. Si quieres entrar al instante, desactiva Email Confirmations en Supabase > Authentication > Settings.",
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
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.authLoading}>
            <ActivityIndicator color={THEME.accent} size="large" />
            <Text style={styles.authLoadingText}>Cargando acceso...</Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!session) {
    return (
      <SafeAreaProvider>
        <AuthScreen
          busy={authBusy}
          canUseAuth={hasSupabaseConfig}
          onSignIn={handleEmailSignIn}
          onSignUp={handleEmailSignUp}
          onSocial={handleSocialSignIn}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <PartyExperience
        authenticatedUser={sessionToUser(session)}
        isUpdateAvailable={isUpdateAvailable}
        onCheckUpdates={checkForUpdates}
        onConsumeInvite={() => setPendingInviteCode("")}
        pendingInviteCode={pendingInviteCode}
        onProfileUpdated={async (profile) => {
          await runAuth("profile", async () => {
            if (!supabase) {
              throw new Error("Falta configurar Supabase en la build instalada.");
            }

            const { error } = await supabase.auth.updateUser({
              data: {
                avatar_url: profile.avatarUrl,
                display_name: profile.displayName,
                favorite_mode: profile.favoriteMode,
                tagline: profile.tagline,
              },
            });

            if (error) {
              throw error;
            }

            const { data } = await supabase.auth.getSession();
            setSession(data.session);
          });
        }}
        onSignOut={handleSignOut}
        onUpdatePress={handleApplyUpdate}
        profileBusy={authBusy === "profile"}
        signingOut={authBusy === "signout"}
        updateError={updateError}
        updateState={updateState}
      />
    </SafeAreaProvider>
  );
}

function PartyExperience({
  authenticatedUser,
  isUpdateAvailable,
  onCheckUpdates,
  onConsumeInvite,
  onProfileUpdated,
  onSignOut,
  onUpdatePress,
  pendingInviteCode,
  profileBusy,
  signingOut,
  updateError,
  updateState,
}: {
  authenticatedUser: AuthenticatedUser;
  isUpdateAvailable: boolean;
  onCheckUpdates: () => Promise<void>;
  onConsumeInvite: () => void;
  onProfileUpdated: (profile: {
    avatarUrl: string;
    displayName: string;
    favoriteMode: PartyMode;
    tagline: string;
  }) => Promise<void>;
  onSignOut: () => Promise<void>;
  onUpdatePress: () => Promise<void>;
  pendingInviteCode: string;
  profileBusy: boolean;
  signingOut: boolean;
  updateError: string;
  updateState: UpdateState;
}) {
  const insets = useSafeAreaInsets();
  const [room, setRoom] = useState<PartyRoom | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("sala");
  const [homeTab, setHomeTab] = useState<"inicio" | "perfil">("inicio");
  const [selectedMode, setSelectedMode] = useState<PartyMode>(authenticatedUser.favoriteMode);
  const [displayName, setDisplayName] = useState(authenticatedUser.displayName);
  const [roomName, setRoomName] = useState("La previa");
  const [profileFavoriteMode, setProfileFavoriteMode] = useState<PartyMode>(authenticatedUser.favoriteMode);
  const [profileName, setProfileName] = useState(authenticatedUser.displayName);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(authenticatedUser.avatarUrl);
  const [profileTagline, setProfileTagline] = useState(authenticatedUser.tagline);
  const [joinCode, setJoinCode] = useState("");
  const [busyLabel, setBusyLabel] = useState("");

  const memberCount = room?.members.length || 0;
  const spotifyReadyCount = room?.members.filter((member) => Boolean(member.spotifyUrl)).length || 0;
  const canUsePartyTools = spotifyReadyCount > 0 && !busyLabel;
  const currentMember = room ? findMatchingMember(room.members, authenticatedUser) : null;
  const currentMemberHasSpotify = Boolean(currentMember?.spotifyUrl);

  useEffect(() => {
    setDisplayName(authenticatedUser.displayName);
    setProfileName(authenticatedUser.displayName);
    setProfilePhotoUrl(authenticatedUser.avatarUrl);
    setProfileFavoriteMode(authenticatedUser.favoriteMode);
    setProfileTagline(authenticatedUser.tagline);
  }, [authenticatedUser.avatarUrl, authenticatedUser.displayName, authenticatedUser.favoriteMode, authenticatedUser.tagline]);

  useEffect(() => {
    setProfilePhotoUrl(authenticatedUser.avatarUrl);
  }, [authenticatedUser.avatarUrl]);

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

  useEffect(() => {
    if (!pendingInviteCode || room || busyLabel) {
      return;
    }

    void (async () => {
      try {
        setBusyLabel("Aceptando invitacion");
        const nextRoom = await joinRoom(
          pendingInviteCode,
          authenticatedUser.id,
          profileName.trim() || authenticatedUser.displayName,
          profilePhotoUrl,
        );
        setRoom(nextRoom);
        setJoinCode(pendingInviteCode);
        setActiveTab("sala");
        onConsumeInvite();
      } catch (error) {
        Alert.alert(
          "Invitacion",
          error instanceof Error ? error.message : "No se pudo abrir la invitacion.",
        );
        onConsumeInvite();
      } finally {
        setBusyLabel("");
      }
    })();
  }, [
    authenticatedUser.displayName,
    authenticatedUser.id,
    busyLabel,
    onConsumeInvite,
    pendingInviteCode,
    profileName,
    profilePhotoUrl,
    room,
  ]);

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
      const nextRoom = await createRoomWithProfile(
        selectedMode,
        profileName.trim() || displayName,
        authenticatedUser.id,
        roomName.trim() || `Sala ${profileName.trim() || displayName}`,
        profilePhotoUrl,
      );
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
      const nextRoom = await joinRoom(
        code,
        authenticatedUser.id,
        profileName.trim() || authenticatedUser.displayName,
        profilePhotoUrl,
      );
      setRoom(nextRoom);
      setActiveTab("sala");
    });
  }

  async function handleConnectSpotify() {
    if (!room) {
      return;
    }

    await run("Abriendo Spotify", async () => {
      const login = await getSpotifyLoginUrl(
        room.code,
        profileName.trim() || displayName,
        authenticatedUser.id,
      );
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

  async function handleInviteFriend() {
    if (!room) {
      return;
    }

    await Share.share({
      message: `Unete a ${room.name || room.code} en kazp.\n\nAbre este enlace en el movil donde tengas la app instalada:\nappmob://join?roomCode=${room.code}\n\nSi tu app no se abre sola, entra manualmente con el codigo ${room.code}.`,
      title: `Invitacion a ${room.name || room.code}`,
      url: `appmob://join?roomCode=${room.code}`,
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

    if (!currentMemberHasSpotify) {
      Alert.alert(
        "Conecta tu Spotify",
        "La playlist se guarda en tu propia cuenta. Primero conecta Spotify con esta misma sesion.",
      );
      return;
    }

    await run("Guardando playlist", async () => {
      const saved = await savePlaylist(room.code, currentMember?.id);
      const nextRoom = await getRoom(room.code);
      setRoom(nextRoom);
      Alert.alert(
        "Playlist guardada",
        `${saved.playlistName} (${saved.trackCount} canciones)`,
      );
      if (saved.playlistUrl) {
        await NativeLinking.openURL(saved.playlistUrl);
      }
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", android: undefined })}
        style={styles.screen}
      >
        <LinearGradient
          colors={["#07110D", "#163429", "#245847"]}
          style={[styles.header, { paddingTop: Math.max(insets.top + 18, 34) }]}
        >
          <View style={styles.brandRow}>
            <Image source={require("./assets/icon.png")} style={styles.logo} />
            <View style={styles.brandCopy}>
              <Text style={styles.appName}>kazp</Text>
              <Text style={styles.caption}>control musical para tu grupo</Text>
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
              {room
                ? `${room.members.length} personas conectadas en esta sala`
                : "Prepara una sala y comparte el codigo con tu grupo"}
            </Text>
            <Pressable onPress={() => void onSignOut()} style={styles.signOutButton}>
              {signingOut ? (
                <ActivityIndicator color={THEME.text} size="small" />
              ) : (
                <>
                  <Ionicons color={THEME.text} name="log-out-outline" size={16} />
                  <Text style={styles.signOutText}>Salir</Text>
                </>
              )}
            </Pressable>
          </View>
        </LinearGradient>

        {isUpdateAvailable ? (
          <UpdateBanner
            busy={updateState === "checking" || updateState === "downloading"}
            error={updateError}
            onPress={() => void onUpdatePress()}
          />
        ) : null}

        {room ? (
          <>
            <TabBar activeTab={activeTab} onChange={setActiveTab} />
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              {activeTab === "sala" ? (
                <RoomScreen
                  busyLabel={busyLabel}
                  canUsePartyTools={canUsePartyTools}
                  currentMember={currentMember}
                  onConnectSpotify={handleConnectSpotify}
                  onGenerateSession={handleGenerateSession}
                  onInviteFriend={handleInviteFriend}
                  onRefresh={handleRefreshRoom}
                  room={room}
                />
              ) : null}
              {activeTab === "perfiles" ? <ProfilesScreen members={room.members} /> : null}
              {activeTab === "sesion" ? (
                <SessionScreen
                  canUsePartyTools={canUsePartyTools}
                  currentMember={currentMember}
                  onGenerateSession={handleGenerateSession}
                  onSavePlaylist={handleSavePlaylist}
                  playlist={room.playlist}
                  roomCode={room.code}
                  roomName={room.name}
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
              {activeTab === "perfil" ? (
                <ProfileScreen
                  authenticatedUser={authenticatedUser}
                  currentMember={currentMember}
                  isUpdateAvailable={isUpdateAvailable}
                  onCheckUpdates={onCheckUpdates}
                  onConnectSpotify={handleConnectSpotify}
                  onProfileSave={() =>
                    void onProfileUpdated({
                      avatarUrl: profilePhotoUrl.trim(),
                      displayName: profileName.trim() || authenticatedUser.displayName,
                      favoriteMode: profileFavoriteMode,
                      tagline: profileTagline.trim(),
                    })
                  }
                  onUpdatePress={onUpdatePress}
                  profileFavoriteMode={profileFavoriteMode}
                  profileBusy={profileBusy}
                  profileName={profileName}
                  profilePhotoUrl={profilePhotoUrl}
                  profileTagline={profileTagline}
                  room={room}
                  setProfileFavoriteMode={setProfileFavoriteMode}
                  setProfileName={(value) => {
                    setProfileName(value);
                    setDisplayName(value);
                  }}
                  setProfilePhotoUrl={setProfilePhotoUrl}
                  setProfileTagline={setProfileTagline}
                  updateError={updateError}
                  updateState={updateState}
                />
              ) : null}
            </ScrollView>
          </>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.homeTabRow}>
              <Pressable
                onPress={() => setHomeTab("inicio")}
                style={[styles.homeTabButton, homeTab === "inicio" && styles.homeTabButtonActive]}
              >
                <Text style={[styles.homeTabText, homeTab === "inicio" && styles.homeTabTextActive]}>
                  Inicio
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setHomeTab("perfil")}
                style={[styles.homeTabButton, homeTab === "perfil" && styles.homeTabButtonActive]}
              >
                <Text style={[styles.homeTabText, homeTab === "perfil" && styles.homeTabTextActive]}>
                  Perfil
                </Text>
              </Pressable>
            </View>
            {homeTab === "inicio" ? (
              <HomeScreen
                authenticatedUser={authenticatedUser}
                busyLabel={busyLabel}
                displayName={displayName}
                joinCode={joinCode}
                onCreateRoom={handleCreateRoom}
                onJoinRoom={handleJoinRoom}
                roomName={roomName}
                setDisplayName={setDisplayName}
                setJoinCode={setJoinCode}
                setRoomName={setRoomName}
              />
            ) : (
              <ProfileSetupScreen
                authenticatedUser={authenticatedUser}
                busy={profileBusy}
                displayName={profileName}
                favoriteMode={profileFavoriteMode}
                photoUrl={profilePhotoUrl}
                onSave={() =>
                  void onProfileUpdated({
                    avatarUrl: profilePhotoUrl.trim(),
                    displayName: profileName.trim() || authenticatedUser.displayName,
                    favoriteMode: profileFavoriteMode,
                    tagline: profileTagline.trim(),
                  })
                }
                setFavoriteMode={setProfileFavoriteMode}
                setDisplayName={(value) => {
                  setProfileName(value);
                  setDisplayName(value);
                }}
                setPhotoUrl={setProfilePhotoUrl}
                setTagline={setProfileTagline}
                tagline={profileTagline}
              />
            )}
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
    avatarUrl:
      session.user.user_metadata?.avatar_url ||
      session.user.user_metadata?.picture ||
      "",
    favoriteMode: normalizeFavoriteMode(session.user.user_metadata?.favorite_mode),
    id: session.user.id,
    displayName,
    email: session.user.email || "usuario sin correo",
    tagline: session.user.user_metadata?.tagline || "",
  };
}

function normalizeFavoriteMode(value: unknown): PartyMode {
  const candidate = typeof value === "string" ? value : "";
  return MODES.some((mode) => mode.id === candidate) ? (candidate as PartyMode) : "previa";
}

function inviteCodeFromUrl(url: string) {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "appmob:") {
      return "";
    }

    if (parsed.hostname !== "join") {
      return "";
    }

    return parsed.searchParams.get("roomCode")?.trim().toUpperCase() || "";
  } catch {
    return "";
  }
}

function findMatchingMember(members: PartyMember[], authenticatedUser: AuthenticatedUser) {
  const exactMatch = members.find((member) => member.appUserId === authenticatedUser.id);

  if (exactMatch) {
    return exactMatch;
  }

  const { displayName, email } = authenticatedUser;
  const normalizedDisplayName = normalizeIdentity(displayName);
  const normalizedEmailAlias = normalizeIdentity(email.split("@")[0] || "");

  return (
    members.find((member) => normalizeIdentity(member.displayName) === normalizedDisplayName) ||
    members.find((member) => normalizeIdentity(member.displayName) === normalizedEmailAlias) ||
    null
  );
}

function normalizeIdentity(value: string) {
  return value.trim().toLowerCase();
}

function formatShortTime(value: string) {
  if (!value) {
    return "todavia no";
  }

  return new Date(value).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || "")
    .join("");
}

function HomeScreen({
  authenticatedUser,
  busyLabel,
  displayName,
  joinCode,
  onCreateRoom,
  onJoinRoom,
  roomName,
  setDisplayName,
  setJoinCode,
  setRoomName,
}: {
  authenticatedUser: AuthenticatedUser;
  busyLabel: string;
  displayName: string;
  joinCode: string;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  roomName: string;
  setDisplayName: (value: string) => void;
  setJoinCode: (value: string) => void;
  setRoomName: (value: string) => void;
}) {
  return (
    <>
      <LinearGradient colors={["#0C1814", "#16362C", "#265847"]} style={styles.homeHero}>
        <Text style={styles.homeEyebrow}>Tu grupo, una sola sala</Text>
        <Text style={styles.homeHeroTitle}>
          Crea la previa, comparte el codigo y deja que kazp ordene el caos musical.
        </Text>
        <View style={styles.homeHeroPillRow}>
        <View style={styles.homeHeroPill}>
            <Ionicons color={THEME.accent} name="person-circle-outline" size={14} />
            <Text style={styles.homeHeroPillText}>{authenticatedUser.displayName}</Text>
          </View>
          <View style={styles.homeHeroPill}>
            <Ionicons color={THEME.accent} name="share-social-outline" size={14} />
            <Text style={styles.homeHeroPillText}>Invita y conecta Spotify</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Crear fiesta</Text>
        <Text style={styles.bodyText}>
          El nombre se usa dentro de la sala para identificarte cuando conectes Spotify.
        </Text>
          <TextInput
            onChangeText={setRoomName}
            placeholder="Nombre de la sala"
            placeholderTextColor={THEME.mutedSoft}
            style={styles.input}
            value={roomName}
          />
          <TextInput
            onChangeText={setDisplayName}
            placeholder="Tu alias en la sala"
            placeholderTextColor={THEME.mutedSoft}
            style={styles.input}
            value={displayName}
          />
        <AppButton
          icon="add-circle"
          label="Crear sala"
          loading={busyLabel === "Creando sala"}
          onPress={onCreateRoom}
        />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Unirse con codigo</Text>
        <Text style={styles.bodyText}>
          Si un amigo ya ha creado la sala, entra con su codigo y conecta tu cuenta.
        </Text>
        <TextInput
          autoCapitalize="characters"
          onChangeText={setJoinCode}
          placeholder="ABCD12"
          placeholderTextColor={THEME.mutedSoft}
          style={styles.input}
          value={joinCode}
        />
        <AppButton
          icon="enter"
          label="Entrar"
          loading={busyLabel === "Entrando"}
          onPress={onJoinRoom}
          variant="dark"
        />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Como va la cosa</Text>
        <View style={styles.stageGrid}>
          <View style={styles.stageCard}>
            <Text style={styles.stageNumber}>1</Text>
            <Text style={styles.stageTitle}>Crea la sala</Text>
            <Text style={styles.stageText}>Elige el mood inicial y comparte el codigo.</Text>
          </View>
          <View style={styles.stageCard}>
            <Text style={styles.stageNumber}>2</Text>
            <Text style={styles.stageTitle}>Entra el grupo</Text>
            <Text style={styles.stageText}>Cada persona conecta Spotify desde su movil.</Text>
          </View>
          <View style={styles.stageCard}>
            <Text style={styles.stageNumber}>3</Text>
            <Text style={styles.stageTitle}>Kazp dirige</Text>
            <Text style={styles.stageText}>Genera sesion, reacciona en vivo y guarda playlist.</Text>
          </View>
        </View>
      </View>

      <FeatureGrid />
    </>
  );
}

function RoomScreen({
  busyLabel,
  canUsePartyTools,
  currentMember,
  onConnectSpotify,
  onGenerateSession,
  onInviteFriend,
  onRefresh,
  room,
}: {
  busyLabel: string;
  canUsePartyTools: boolean;
  currentMember: PartyMember | null;
  onConnectSpotify: () => void;
  onGenerateSession: () => void;
  onInviteFriend: () => void;
  onRefresh: () => void;
  room: PartyRoom;
}) {
  const isSpotifyReady = Boolean(currentMember?.spotifyUrl);

  return (
    <>
      <LinearGradient colors={["#0C1814", "#16362C", "#22463A"]} style={styles.roomHero}>
        <Text style={styles.roomHeroEyebrow}>{room.name || `Sala ${room.code}`}</Text>
        <Text style={styles.roomHeroTitle}>
          {isSpotifyReady
            ? "Tu cuenta ya esta dentro del grupo. Ya puedes generar y guardar la sesion en tu Spotify."
            : "Anade a tus amigos y conecta tu Spotify para entrar en la mezcla y guardar la playlist final."}
        </Text>
        <View style={styles.roomHeroPillRow}>
          <View style={styles.roomHeroPill}>
            <Text style={styles.roomHeroPillValue}>{room.members.length}</Text>
            <Text style={styles.roomHeroPillLabel}>personas</Text>
          </View>
          <View style={styles.roomHeroPill}>
            <Text style={styles.roomHeroPillValue}>{room.scores.compatibility}%</Text>
            <Text style={styles.roomHeroPillLabel}>compatibles</Text>
          </View>
          <View style={styles.roomHeroPill}>
            <Text style={styles.roomHeroPillValue}>{room.playlist.tracks.length}</Text>
            <Text style={styles.roomHeroPillLabel}>temas listos</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.statsGrid}>
        <Metric label="Amigos" value={String(room.members.length)} />
        <Metric label="Compatibilidad" value={`${room.scores.compatibility}%`} />
        <Metric label="Caos" value={`${room.scores.chaos}%`} hot />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Flujo de sala</Text>
        <View style={styles.stageGrid}>
          <View style={styles.stageCard}>
            <Text style={styles.stageNumber}>1</Text>
            <Text style={styles.stageTitle}>Anade amigos</Text>
            <Text style={styles.stageText}>Comparte el codigo y mete al grupo en la sala.</Text>
          </View>
          <View style={styles.stageCard}>
            <Text style={styles.stageNumber}>2</Text>
            <Text style={styles.stageTitle}>Conectad Spotify</Text>
            <Text style={styles.stageText}>Cada cuenta se conecta desde su propio movil.</Text>
          </View>
          <View style={styles.stageCard}>
            <Text style={styles.stageNumber}>3</Text>
            <Text style={styles.stageTitle}>Genera la sesion</Text>
            <Text style={styles.stageText}>Kazp mezcla el grupo y guarda la playlist final.</Text>
          </View>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Anadir amigos</Text>
        <Text style={styles.bodyText}>
          Comparte el codigo de la sala y haz que cada persona conecte su Spotify desde su movil.
        </Text>
        <View style={styles.inviteCodeCard}>
          <Text selectable style={styles.inviteCodeText}>
            {room.code}
          </Text>
          <Text style={styles.inviteCodeHint}>Usa este codigo para entrar en la sala</Text>
        </View>
        <View style={styles.actionRow}>
          <AppButton
            icon="share-social"
            label="Anadir amigo"
            onPress={onInviteFriend}
          />
          <AppButton icon="refresh" label="Refrescar" onPress={onRefresh} variant="ghost" />
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Conecta tu Spotify</Text>
        <Text style={styles.bodyText}>
          Usa tu propia cuenta para que kazp pueda leer artistas, temas y guardar la playlist final.
        </Text>
        <View style={styles.spotifyStatusCard}>
          <Ionicons
            color={isSpotifyReady ? THEME.accent : THEME.accentDeep}
            name={isSpotifyReady ? "checkmark-circle" : "musical-notes-outline"}
            size={22}
          />
          <View style={styles.spotifyStatusCopy}>
            <Text style={styles.spotifyStatusTitle}>
              {isSpotifyReady ? "Tu Spotify ya esta listo" : "Falta conectar tu cuenta"}
            </Text>
            <Text style={styles.spotifyStatusText}>
              {isSpotifyReady
                ? "La playlist final se guardara en tu propia biblioteca."
                : "Sin esta conexion no puedes guardar la sesion final en tu perfil."}
            </Text>
          </View>
        </View>
        <View style={styles.actionRow}>
          <AppButton
            icon="musical-notes"
            label="Conectar"
            loading={busyLabel === "Abriendo Spotify"}
            onPress={onConnectSpotify}
          />
          <AppButton icon="refresh" label="Verificar" onPress={onRefresh} variant="dark" />
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Sala del grupo</Text>
        {room.members.length === 0 ? (
          <EmptyState
            icon="people-outline"
            text="Comparte la sala y conecta cuentas reales para ver roasts, compatibilidad y playlist."
            title="La sala aun esta vacia"
          />
        ) : (
          room.members.map((member) => (
            <MemberMini
              key={member.id}
              isCurrentUser={member.id === currentMember?.id}
              member={member}
            />
          ))
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
          <TagSection color={THEME.accentDeep} items={member.profile.strengths} title="Fortalezas" />
          <TagSection color={THEME.danger} items={member.profile.crimes} title="Delitos musicales" />
          <TagSection color={THEME.accent} items={member.profile.badges} title="Insignias" />
        </View>
      ))}
    </>
  );
}

function SessionScreen({
  canUsePartyTools,
  currentMember,
  onGenerateSession,
  onSavePlaylist,
  playlist,
  roomCode,
  roomName,
}: {
  canUsePartyTools: boolean;
  currentMember: PartyMember | null;
  onGenerateSession: () => void;
  onSavePlaylist: () => void;
  playlist: PartyRoom["playlist"];
  roomCode: string;
  roomName: string;
}) {
  const canSaveOnSpotify = Boolean(currentMember);

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
        <View style={styles.spotifyStatusCard}>
          <Ionicons
            color={canSaveOnSpotify ? THEME.accent : THEME.accentDeep}
            name={canSaveOnSpotify ? "save-outline" : "musical-notes-outline"}
            size={22}
          />
          <View style={styles.spotifyStatusCopy}>
            <Text style={styles.spotifyStatusTitle}>
              {canSaveOnSpotify ? "Guardar en mi Spotify" : "Conecta tu Spotify para guardar"}
            </Text>
            <Text style={styles.spotifyStatusText}>
              {canSaveOnSpotify
                ? `La playlist se guardara como "${roomName || `Sala ${roomCode}`}" en la cuenta conectada de ${currentMember?.displayName}.`
                : "La sesion final se guarda en tu propia biblioteca, no en la de otro miembro."}
            </Text>
          </View>
        </View>
        <View style={styles.actionRow}>
          <AppButton
            disabled={!canUsePartyTools}
            icon="sparkles"
            label="Recalcular"
            onPress={onGenerateSession}
          />
          <AppButton
            disabled={!canSaveOnSpotify}
            icon="save"
            label="Guardar en Spotify"
            onPress={onSavePlaylist}
            variant="dark"
          />
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
              {busyLabel === vote ? <ActivityIndicator color={THEME.background} /> : <Text style={styles.voteText}>{vote}</Text>}
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
          <Ionicons color={THEME.accent} name="flash" size={16} />
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
      <TagSection color={THEME.accentDeep} items={summary.awards} title="Premios" />
    </View>
  );
}

function ProfileScreen({
  authenticatedUser,
  currentMember,
  isUpdateAvailable,
  onCheckUpdates,
  onConnectSpotify,
  onProfileSave,
  onUpdatePress,
  profileFavoriteMode,
  profileBusy,
  profileName,
  profilePhotoUrl,
  profileTagline,
  room,
  setProfileFavoriteMode,
  setProfileName,
  setProfilePhotoUrl,
  setProfileTagline,
  updateError,
  updateState,
}: {
  authenticatedUser: AuthenticatedUser;
  currentMember: PartyMember | null;
  isUpdateAvailable: boolean;
  onCheckUpdates: () => Promise<void>;
  onConnectSpotify: () => Promise<void>;
  onProfileSave: () => void;
  onUpdatePress: () => Promise<void>;
  profileFavoriteMode: PartyMode;
  profileBusy: boolean;
  profileName: string;
  profilePhotoUrl: string;
  profileTagline: string;
  room: PartyRoom;
  setProfileFavoriteMode: (value: PartyMode) => void;
  setProfileName: (value: string) => void;
  setProfilePhotoUrl: (value: string) => void;
  setProfileTagline: (value: string) => void;
  updateError: string;
  updateState: UpdateState;
}) {
  const updateBusy = updateState === "checking" || updateState === "downloading";
  const hasSpotifyProfile = Boolean(currentMember?.spotifyUrl);
  const updateSummary = updateError
    ? updateError
    : updateBusy
      ? "Buscando o descargando cambios para esta build."
      : isUpdateAvailable
        ? "Hay una nueva version OTA lista para aplicarse sin instalar otra APK."
        : "Esta build ya puede recibir cambios de interfaz y logica por OTA sin recompilar APK.";

  return (
    <>
      <LinearGradient colors={["#08120F", "#133026", "#255847"]} style={styles.profileHero}>
        <View style={styles.profileHeroTop}>
          <IdentityAvatar
            avatarUrl={profilePhotoUrl || authenticatedUser.avatarUrl}
            name={profileName || authenticatedUser.displayName}
            size={64}
          />
          <View style={styles.profileHeroCopy}>
            <Text style={styles.profileHeroName}>{profileName || authenticatedUser.displayName}</Text>
            <Text style={styles.profileHeroMeta}>
              {profileTagline.trim()
                ? `${profileTagline.trim()} · ${hasSpotifyProfile ? currentMember?.profile.archetype || "Spotify listo" : "Conecta Spotify para completar tu perfil"}`
                : hasSpotifyProfile
                  ? `${currentMember?.profile.archetype || "Spotify listo"} listo para guardar playlists en tu cuenta`
                  : "Conecta tu cuenta de Spotify para completar tu perfil y guardar la sesion final"}
            </Text>
          </View>
        </View>
        <View style={styles.profilePillRow}>
          <View style={styles.profilePill}>
            <Ionicons color={THEME.accent} name="albums-outline" size={14} />
            <Text style={styles.profilePillText}>{room.name || `Sala ${room.code}`}</Text>
          </View>
          <View style={styles.profilePill}>
            <Ionicons color={THEME.accent} name="people-outline" size={14} />
            <Text style={styles.profilePillText}>{room.members.length} conectados</Text>
          </View>
          <View style={styles.profilePill}>
            <Ionicons color={THEME.accent} name={hasSpotifyProfile ? "musical-notes-outline" : "radio-outline"} size={14} />
            <Text style={styles.profilePillText}>{hasSpotifyProfile ? "Spotify listo" : "Spotify pendiente"}</Text>
          </View>
          <View style={styles.profilePill}>
            <Ionicons color={THEME.accent} name="sparkles-outline" size={14} />
            <Text style={styles.profilePillText}>{MODES.find((mode) => mode.id === profileFavoriteMode)?.label || "Previa"}</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.statsGrid}>
        <Metric hot label="Fiesta" value={hasSpotifyProfile ? `${currentMember?.stats.partyScore}%` : "--"} />
        <Metric label="Caos" value={hasSpotifyProfile ? `${currentMember?.stats.chaosScore}%` : `${room.scores.chaos}%`} />
        <Metric label="Repeticion" value={hasSpotifyProfile ? `${currentMember?.stats.repeatRisk}%` : "--"} />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Estado de la app</Text>
        <Text style={styles.bodyText}>{updateSummary}</Text>
        <View style={styles.stageGrid}>
          <View style={styles.stageCard}>
            <Text style={styles.stageNumber}>Cuenta</Text>
            <Text style={styles.stageTitle}>Lista</Text>
            <Text style={styles.stageText}>Tu acceso ya esta activo dentro de kazp.</Text>
          </View>
          <View style={styles.stageCard}>
            <Text style={styles.stageNumber}>Spotify</Text>
            <Text style={styles.stageTitle}>{hasSpotifyProfile ? "Conectado" : "Pendiente"}</Text>
            <Text style={styles.stageText}>
              {hasSpotifyProfile
                ? "Tu biblioteca ya puede recibir la playlist final."
                : "Conecta tu cuenta para guardar la sesion en tu perfil."}
            </Text>
          </View>
          <View style={styles.stageCard}>
            <Text style={styles.stageNumber}>Updates</Text>
            <Text style={styles.stageTitle}>{isUpdateAvailable ? "Lista" : "Al dia"}</Text>
            <Text style={styles.stageText}>
              {isUpdateAvailable
                ? "Hay cambios esperandote dentro de la app."
                : "Los cambios visuales y de logica llegaran sin APK nueva."}
            </Text>
          </View>
        </View>
        <View style={styles.actionRow}>
          <AppButton
            icon="refresh"
            label="Buscar cambios"
            loading={updateState === "checking"}
            onPress={onCheckUpdates}
          />
          <AppButton
            disabled={!isUpdateAvailable}
            icon="download"
            label="Actualizar app"
            loading={updateState === "downloading"}
            onPress={onUpdatePress}
            variant="dark"
          />
        </View>
      </View>

      <ProfileSetupScreen
        authenticatedUser={authenticatedUser}
        busy={profileBusy}
        displayName={profileName}
        favoriteMode={profileFavoriteMode}
        photoUrl={profilePhotoUrl}
        onSave={onProfileSave}
        setFavoriteMode={setProfileFavoriteMode}
        setDisplayName={setProfileName}
        setPhotoUrl={setProfilePhotoUrl}
        setTagline={setProfileTagline}
        tagline={profileTagline}
      />

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Mi perfil musical</Text>
        {hasSpotifyProfile && currentMember ? (
          <>
            <View style={styles.profileMemberRow}>
              <Avatar member={currentMember} size={58} />
              <View style={styles.profileMemberCopy}>
                <Text style={styles.memberName}>{currentMember.displayName}</Text>
                <Text style={styles.archetype}>{currentMember.profile.archetype}</Text>
              </View>
              <Text style={styles.miniScore}>{currentMember.stats.partyScore}%</Text>
            </View>
            <Text style={styles.roastText}>{currentMember.profile.roast}</Text>
            <TagSection color={THEME.accentDeep} items={currentMember.profile.strengths} title="Fortalezas" />
            <TagSection color={THEME.danger} items={currentMember.profile.crimes} title="Delitos musicales" />
            <TagSection color={THEME.accent} items={currentMember.topArtists.slice(0, 4)} title="Top artistas" />
            <View style={styles.actionRow}>
              <AppButton
                icon="musical-notes-outline"
                label="Reconectar Spotify"
                onPress={onConnectSpotify}
              />
              <AppButton
                disabled={!currentMember.spotifyUrl}
                icon="open-outline"
                label="Abrir perfil"
                onPress={() => {
                  if (currentMember.spotifyUrl) {
                    void NativeLinking.openURL(currentMember.spotifyUrl);
                  }
                }}
                variant="ghost"
              />
            </View>
          </>
        ) : (
          <>
            <EmptyState
              icon="person-circle-outline"
              text="Todavia no hay un perfil de Spotify emparejado con esta cuenta dentro de la sala."
              title="Conecta tu Spotify"
            />
            <AppButton icon="musical-notes-outline" label="Conectar Spotify" onPress={onConnectSpotify} />
          </>
        )}
      </View>
    </>
  );
}

function ProfileSetupScreen({
  authenticatedUser,
  busy,
  displayName,
  favoriteMode,
  onSave,
  photoUrl,
  setFavoriteMode,
  setDisplayName,
  setPhotoUrl,
  setTagline,
  tagline,
}: {
  authenticatedUser: AuthenticatedUser;
  busy: boolean;
  displayName: string;
  favoriteMode: PartyMode;
  onSave: () => void;
  photoUrl: string;
  setFavoriteMode: (value: PartyMode) => void;
  setDisplayName: (value: string) => void;
  setPhotoUrl: (value: string) => void;
  setTagline: (value: string) => void;
  tagline: string;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Tu perfil</Text>
      <Text style={styles.bodyText}>
        Ajusta tu alias y tu foto antes de entrar en una sala. Asi tus amigos te veran bien al unirse.
      </Text>
      <View style={styles.profileEditorRow}>
        <IdentityAvatar
          avatarUrl={photoUrl || authenticatedUser.avatarUrl}
          name={displayName || authenticatedUser.displayName}
          size={64}
        />
        <View style={styles.profileEditorCopy}>
          <Text style={styles.profileEditorName}>{displayName || authenticatedUser.displayName}</Text>
          <Text style={styles.profileEditorHint}>Tu cuenta se usa para unirte a salas e invitaciones.</Text>
        </View>
      </View>
      <TextInput
        onChangeText={setDisplayName}
        placeholder="Tu alias en kazp"
        placeholderTextColor={THEME.mutedSoft}
        style={styles.input}
        value={displayName}
      />
      <TextInput
        autoCapitalize="none"
        onChangeText={setPhotoUrl}
        placeholder="URL de tu foto"
        placeholderTextColor={THEME.mutedSoft}
        style={styles.input}
        value={photoUrl}
      />
      <TextInput
        onChangeText={setTagline}
        placeholder="Tu frase o vibe"
        placeholderTextColor={THEME.mutedSoft}
        style={styles.input}
        value={tagline}
      />
      <Text style={styles.helperText}>Modo por defecto</Text>
      <View style={styles.modeRow}>
        {MODES.map((mode) => (
          <Pill
            key={mode.id}
            active={favoriteMode === mode.id}
            label={mode.label}
            onPress={() => setFavoriteMode(mode.id)}
          />
        ))}
      </View>
      <AppButton
        icon="save"
        label="Guardar perfil"
        loading={busy}
        onPress={onSave}
        variant="dark"
      />
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
          <Ionicons color={THEME.accent} name={item.icon} size={22} />
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

function MemberMini({
  isCurrentUser,
  member,
}: {
  isCurrentUser: boolean;
  member: PartyMember;
}) {
  return (
    <View style={[styles.memberMini, isCurrentUser && styles.memberMiniCurrent]}>
      <Avatar member={member} size={44} />
      <View style={styles.memberMiniText}>
        <View style={styles.memberMiniTopRow}>
          <Text style={styles.memberName}>{member.displayName}</Text>
          {isCurrentUser ? (
            <View style={styles.memberBadge}>
              <Text style={styles.memberBadgeText}>Tu cuenta</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={styles.memberMeta}>
          {member.profile.archetype}
        </Text>
        <View style={styles.memberTagRow}>
          {(member.stats.mainGenres.length > 0 ? member.stats.mainGenres : member.topArtists)
            .slice(0, 2)
            .map((item) => (
              <View key={item} style={styles.memberTag}>
                <Text style={styles.memberTagText}>{item}</Text>
              </View>
            ))}
        </View>
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
          <Ionicons color={THEME.accent} name="disc-outline" size={22} />
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
      <Ionicons color={THEME.accentDeep} name="open-outline" size={18} />
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
      {loading ? <ActivityIndicator color={variant === "dark" ? THEME.text : THEME.background} /> : <Ionicons color={variant === "dark" ? THEME.text : THEME.background} name={icon} size={18} />}
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
    <View style={styles.tabBarShell}>
      <View style={styles.tabBar}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={[styles.tabButton, activeTab === tab.id && styles.tabButtonActive]}
          >
            <Ionicons
              color={activeTab === tab.id ? THEME.background : THEME.muted}
              
              name={tab.icon}
              size={18}
            />
            <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function UpdateBanner({
  busy,
  error,
  onPress,
}: {
  busy: boolean;
  error: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.updateBanner}>
      <View style={styles.updateBannerCopy}>
        <Text style={styles.updateBannerTitle}>Nueva version disponible</Text>
        <Text style={styles.updateBannerText}>
          {busy
            ? "Descargando cambios y preparando el reinicio..."
            : "Descarga la actualizacion y aplicala ahora mismo."}
        </Text>
        {error ? <Text style={styles.updateBannerError}>{error}</Text> : null}
      </View>
      <Pressable disabled={busy} onPress={onPress} style={[styles.updateButton, busy && styles.buttonDisabled]}>
        {busy ? <ActivityIndicator color={THEME.background} /> : <Text style={styles.updateButtonText}>Actualizar</Text>}
      </Pressable>
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

function IdentityAvatar({ avatarUrl, name, size }: { avatarUrl: string; name: string; size: number }) {
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={{ borderRadius: size / 2, height: size, width: size }} />;
  }

  return (
    <View style={[styles.avatarFallback, { borderRadius: size / 2, height: size, width: size }]}>
      <Text style={styles.avatarInitial}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function Avatar({ member, size }: { member: PartyMember; size: number }) {
  return <IdentityAvatar avatarUrl={member.avatarUrl} name={member.displayName} size={size} />;
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
      <Ionicons color={THEME.accent} name={icon} size={32} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: THEME.background,
  },
  authLoading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  authLoadingText: {
    color: THEME.text,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 12,
  },
  screen: {
    flex: 1,
    backgroundColor: THEME.background,
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
    marginBottom: 18,
  },
  brandCopy: {
    flex: 1,
  },
  logo: {
    borderRadius: 16,
    height: 46,
    width: 46,
  },
  homeHero: {
    borderColor: THEME.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    overflow: "hidden",
    padding: 18,
  },
  homeEyebrow: {
    color: THEME.muted,
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  homeHeroTitle: {
    color: THEME.text,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 31,
  },
  homeHeroPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 16,
  },
  homeHeroPill: {
    alignItems: "center",
    backgroundColor: "rgba(167,227,190,0.10)",
    borderColor: "rgba(167,227,190,0.18)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  homeHeroPillText: {
    color: THEME.text,
    fontSize: 12,
    fontWeight: "800",
  },
  homeTabRow: {
    backgroundColor: THEME.panel,
    borderColor: THEME.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
    padding: 6,
  },
  homeTabButton: {
    alignItems: "center",
    borderRadius: 999,
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
  },
  homeTabButtonActive: {
    backgroundColor: THEME.accentSoft,
  },
  homeTabText: {
    color: THEME.muted,
    fontSize: 14,
    fontWeight: "900",
  },
  homeTabTextActive: {
    color: THEME.text,
  },
  appName: {
    color: THEME.text,
    fontSize: 20,
    fontWeight: "900",
  },
  caption: {
    color: THEME.muted,
    fontSize: 12,
    marginTop: 2,
  },
  roomHero: {
    borderColor: THEME.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    overflow: "hidden",
    padding: 16,
  },
  roomHeroEyebrow: {
    color: THEME.muted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  roomHeroTitle: {
    color: THEME.text,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 27,
    marginTop: 8,
  },
  roomHeroPillRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  roomHeroPill: {
    backgroundColor: "rgba(167,227,190,0.10)",
    borderColor: "rgba(167,227,190,0.18)",
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  roomHeroPillValue: {
    color: THEME.text,
    fontSize: 22,
    fontWeight: "900",
  },
  roomHeroPillLabel: {
    color: THEME.muted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 4,
  },
  profileHero: {
    borderColor: THEME.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    overflow: "hidden",
    padding: 16,
  },
  profileHeroTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  profileAvatar: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 18,
    borderWidth: 1,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  profileAvatarText: {
    color: THEME.text,
    fontSize: 24,
    fontWeight: "900",
  },
  profileHeroCopy: {
    flex: 1,
  },
  profileHeroName: {
    color: THEME.text,
    fontSize: 22,
    fontWeight: "900",
  },
  profileHeroEmail: {
    color: THEME.muted,
    fontSize: 13,
    marginTop: 2,
  },
  profileHeroMeta: {
    color: THEME.muted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 6,
  },
  profilePillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  profilePill: {
    alignItems: "center",
    backgroundColor: "rgba(167,227,190,0.10)",
    borderColor: "rgba(167,227,190,0.18)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  profilePillText: {
    color: THEME.text,
    fontSize: 12,
    fontWeight: "800",
  },
  profileEditorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 14,
  },
  profileEditorCopy: {
    flex: 1,
  },
  profileEditorName: {
    color: THEME.text,
    fontSize: 18,
    fontWeight: "900",
  },
  profileEditorHint: {
    color: THEME.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  title: {
    color: THEME.text,
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
    color: THEME.muted,
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  signOutButton: {
    alignItems: "center",
    backgroundColor: "rgba(167,227,190,0.10)",
    borderColor: "rgba(167,227,190,0.18)",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    height: 34,
    justifyContent: "center",
    minWidth: 78,
    paddingHorizontal: 10,
  },
  signOutText: {
    color: THEME.text,
    fontSize: 12,
    fontWeight: "900",
  },
  pill: {
    backgroundColor: THEME.panel,
    borderColor: THEME.border,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  pillActive: {
    backgroundColor: THEME.accent,
    borderColor: THEME.accent,
  },
  pillText: {
    color: THEME.text,
    fontSize: 12,
    fontWeight: "800",
  },
  pillTextActive: {
    color: THEME.background,
  },
  tabBar: {
    backgroundColor: THEME.panel,
    borderColor: THEME.border,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    padding: 6,
  },
  tabBarShell: {
    backgroundColor: THEME.background,
    borderBottomColor: THEME.border,
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  updateBanner: {
    alignItems: "center",
    backgroundColor: THEME.panelSoft,
    borderBottomColor: THEME.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  updateBannerCopy: {
    flex: 1,
  },
  updateBannerTitle: {
    color: THEME.text,
    fontSize: 14,
    fontWeight: "900",
  },
  updateBannerText: {
    color: THEME.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  updateBannerError: {
    color: "#B42318",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 4,
  },
  updateButton: {
    alignItems: "center",
    backgroundColor: THEME.accent,
    borderRadius: 14,
    height: 38,
    justifyContent: "center",
    minWidth: 102,
    paddingHorizontal: 14,
  },
  updateButtonText: {
    color: THEME.background,
    fontSize: 13,
    fontWeight: "900",
  },
  tabButton: {
    alignItems: "center",
    borderRadius: 999,
    flex: 1,
    gap: 3,
    justifyContent: "center",
    minWidth: 52,
    paddingVertical: 8,
  },
  tabButtonActive: {
    backgroundColor: THEME.accent,
  },
  tabText: {
    color: THEME.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  tabTextActive: {
    color: THEME.background,
  },
  content: {
    padding: 16,
    paddingBottom: 34,
  },
  panel: {
    backgroundColor: THEME.panel,
    borderColor: THEME.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  panelTitle: {
    color: THEME.text,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 10,
  },
  bodyText: {
    color: THEME.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  inviteCodeCard: {
    alignItems: "center",
    backgroundColor: THEME.panelSoft,
    borderColor: THEME.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  inviteCodeText: {
    color: THEME.text,
    fontSize: 28,
    fontVariant: ["tabular-nums"],
    fontWeight: "900",
    letterSpacing: 0,
  },
  inviteCodeHint: {
    color: THEME.mutedSoft,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  spotifyStatusCard: {
    alignItems: "flex-start",
    backgroundColor: THEME.panelSoft,
    borderColor: THEME.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
    padding: 12,
  },
  spotifyStatusCopy: {
    flex: 1,
  },
  spotifyStatusTitle: {
    color: THEME.text,
    fontSize: 14,
    fontWeight: "900",
  },
  spotifyStatusText: {
    color: THEME.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  helperText: {
    color: THEME.mutedSoft,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginBottom: 12,
  },
  input: {
    backgroundColor: THEME.input,
    borderColor: THEME.border,
    borderRadius: 14,
    borderWidth: 1,
    color: THEME.text,
    fontSize: 16,
    height: 48,
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: THEME.accent,
    borderRadius: 14,
    flexDirection: "row",
    gap: 8,
    height: 46,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  buttonDark: {
    backgroundColor: THEME.accentSoft,
  },
  buttonGhost: {
    backgroundColor: THEME.panelSoft,
    borderColor: THEME.border,
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    transform: [{ scale: 0.99 }],
  },
  buttonText: {
    color: THEME.background,
    fontSize: 15,
    fontWeight: "900",
  },
  buttonTextDark: {
    color: THEME.text,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  stageGrid: {
    gap: 10,
  },
  stageCard: {
    backgroundColor: THEME.panelSoft,
    borderColor: THEME.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  stageNumber: {
    color: THEME.accentDeep,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  stageTitle: {
    color: THEME.text,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },
  stageText: {
    color: THEME.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  featureGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  featureCard: {
    backgroundColor: THEME.panel,
    borderColor: THEME.border,
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: "48%",
    flexGrow: 1,
    minHeight: 118,
    padding: 14,
  },
  featureTitle: {
    color: THEME.text,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 8,
  },
  featureText: {
    color: THEME.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  codeBadge: {
    alignItems: "flex-end",
    backgroundColor: "rgba(167,227,190,0.10)",
    borderColor: "rgba(167,227,190,0.18)",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  codeLabel: {
    color: THEME.muted,
    fontSize: 10,
    fontWeight: "800",
  },
  codeText: {
    color: THEME.text,
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
    backgroundColor: THEME.panel,
    borderColor: THEME.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    padding: 12,
  },
  metricLabel: {
    color: THEME.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  metricValue: {
    color: THEME.accent,
    fontSize: 24,
    fontWeight: "900",
    marginTop: 4,
  },
  metricHot: {
    color: THEME.danger,
  },
  memberMini: {
    backgroundColor: THEME.panelSoft,
    borderColor: THEME.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
    padding: 12,
  },
  memberMiniCurrent: {
    backgroundColor: "#19382E",
    borderColor: THEME.accentDeep,
  },
  memberMiniText: {
    flex: 1,
  },
  memberMiniTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  memberName: {
    color: THEME.text,
    fontSize: 16,
    fontWeight: "900",
  },
  memberMeta: {
    color: THEME.muted,
    fontSize: 12,
    marginTop: 3,
  },
  miniScore: {
    color: THEME.accent,
    fontSize: 16,
    fontWeight: "900",
  },
  memberBadge: {
    backgroundColor: THEME.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  memberBadgeText: {
    color: THEME.text,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  memberTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  memberTag: {
    backgroundColor: THEME.panelRaised,
    borderColor: THEME.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  memberTagText: {
    color: THEME.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  scoreRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  scoreLabel: {
    color: THEME.text,
    fontSize: 13,
    fontWeight: "800",
    width: 70,
  },
  scoreTrack: {
    backgroundColor: THEME.input,
    borderRadius: 999,
    flex: 1,
    height: 9,
    overflow: "hidden",
  },
  scoreFill: {
    backgroundColor: THEME.accentDeep,
    height: 9,
  },
  scoreValue: {
    color: THEME.muted,
    fontSize: 12,
    fontWeight: "900",
    width: 38,
  },
  profileCard: {
    backgroundColor: THEME.panel,
    borderColor: THEME.border,
    borderRadius: 18,
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
  profileMemberRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  profileMemberCopy: {
    flex: 1,
  },
  profileHeaderText: {
    flex: 1,
  },
  archetype: {
    color: THEME.accent,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 3,
  },
  roastText: {
    color: THEME.text,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
    marginBottom: 12,
  },
  tagSection: {
    marginTop: 10,
  },
  tagTitle: {
    color: THEME.mutedSoft,
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
    color: THEME.text,
    fontSize: 12,
    fontWeight: "800",
  },
  phaseRow: {
    gap: 8,
    marginBottom: 12,
  },
  phaseCard: {
    backgroundColor: THEME.panelSoft,
    borderColor: THEME.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  phaseName: {
    color: THEME.text,
    fontSize: 14,
    fontWeight: "900",
  },
  phaseEnergy: {
    color: THEME.accent,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 4,
  },
  phaseIntent: {
    color: THEME.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  trackRow: {
    alignItems: "center",
    backgroundColor: THEME.panelSoft,
    borderColor: THEME.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
    padding: 9,
  },
  trackIndex: {
    color: THEME.mutedSoft,
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
    backgroundColor: THEME.input,
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
    color: THEME.text,
    fontSize: 15,
    fontWeight: "900",
  },
  trackArtist: {
    color: THEME.muted,
    fontSize: 13,
    marginTop: 3,
  },
  liveHero: {
    backgroundColor: THEME.panel,
    borderColor: THEME.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  liveLabel: {
    color: THEME.muted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  energyValue: {
    color: THEME.accent,
    fontSize: 54,
    fontWeight: "900",
    marginTop: 2,
  },
  liveComment: {
    color: THEME.text,
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
    backgroundColor: THEME.accent,
    borderRadius: 14,
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  voteText: {
    color: THEME.background,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  voteLog: {
    alignItems: "center",
    borderBottomColor: THEME.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 9,
  },
  voteLogText: {
    color: THEME.text,
    fontSize: 14,
    fontWeight: "800",
  },
  summaryLine: {
    borderBottomColor: THEME.border,
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  summaryLabel: {
    color: THEME.mutedSoft,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  summaryValue: {
    color: THEME.text,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 3,
  },
  finalVerdict: {
    color: THEME.accent,
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 24,
    marginTop: 14,
  },
  emptyState: {
    alignItems: "flex-start",
    backgroundColor: THEME.panelSoft,
    borderColor: THEME.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16,
  },
  emptyTitle: {
    color: THEME.text,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 10,
  },
  emptyText: {
    color: THEME.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 5,
  },
  avatarFallback: {
    alignItems: "center",
    backgroundColor: THEME.accentSoft,
    justifyContent: "center",
  },
  avatarInitial: {
    color: THEME.text,
    fontSize: 18,
    fontWeight: "900",
  },
});
