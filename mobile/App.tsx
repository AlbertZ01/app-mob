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
  authRedirectUrl,
  hasSupabaseConfig,
  supabase,
} from "./src/lib/supabase";
import type { PartyMember, PartyMode, PartyRoom, Track } from "./src/types/party";

type IconName = ComponentProps<typeof Ionicons>["name"];
type TabKey = "sala" | "perfiles" | "sesion" | "live" | "resumen" | "perfil";
type AuthProvider = "apple" | "google";
type AuthenticatedUser = {
  id: string;
  displayName: string;
  email: string;
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
            <ActivityIndicator color="#D9B44A" size="large" />
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
        onSignOut={handleSignOut}
        onUpdatePress={handleApplyUpdate}
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
  onSignOut,
  onUpdatePress,
  signingOut,
  updateError,
  updateState,
}: {
  authenticatedUser: AuthenticatedUser;
  isUpdateAvailable: boolean;
  onCheckUpdates: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onUpdatePress: () => Promise<void>;
  signingOut: boolean;
  updateError: string;
  updateState: UpdateState;
}) {
  const insets = useSafeAreaInsets();
  const [room, setRoom] = useState<PartyRoom | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("sala");
  const [selectedMode, setSelectedMode] = useState<PartyMode>("previa");
  const [displayName, setDisplayName] = useState(authenticatedUser.displayName);
  const [joinCode, setJoinCode] = useState("");
  const [busyLabel, setBusyLabel] = useState("");

  const memberCount = room?.members.length || 0;
  const canUsePartyTools = memberCount > 0 && !busyLabel;
  const currentMember = room ? findMatchingMember(room.members, authenticatedUser) : null;

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
      const login = await getSpotifyLoginUrl(room.code, displayName, authenticatedUser.id);
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
      message: `Unete a mi sala ${room.code} en kazp. Entra en la app, inicia sesion y usa este codigo para conectar tu Spotify: ${room.code}`,
      title: `Invitacion a la sala ${room.code}`,
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

    if (!currentMember) {
      Alert.alert(
        "Conecta tu Spotify",
        "La playlist se guarda en tu propia cuenta. Primero conecta Spotify con esta misma sesion.",
      );
      return;
    }

    await run("Guardando playlist", async () => {
      const saved = await savePlaylist(room.code, currentMember.id);
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
          colors={["#0D1321", "#1D7874"]}
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
                  onUpdatePress={onUpdatePress}
                  room={room}
                  updateError={updateError}
                  updateState={updateState}
                />
              ) : null}
            </ScrollView>
          </>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <HomeScreen
              authenticatedUser={authenticatedUser}
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
    id: session.user.id,
    displayName,
    email: session.user.email || "usuario sin correo",
  };
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
  setDisplayName,
  setJoinCode,
}: {
  authenticatedUser: AuthenticatedUser;
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
      <LinearGradient colors={["#10211E", "#1D7874"]} style={styles.homeHero}>
        <Text style={styles.homeEyebrow}>Tu grupo, una sola sala</Text>
        <Text style={styles.homeHeroTitle}>
          Crea la previa, comparte el codigo y deja que kazp ordene el caos musical.
        </Text>
        <View style={styles.homeHeroPillRow}>
          <View style={styles.homeHeroPill}>
            <Ionicons color="#D9B44A" name="person-circle-outline" size={14} />
            <Text style={styles.homeHeroPillText}>{authenticatedUser.displayName}</Text>
          </View>
          <View style={styles.homeHeroPill}>
            <Ionicons color="#D9B44A" name="share-social-outline" size={14} />
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
          onChangeText={setDisplayName}
          placeholder="Tu alias en la sala"
          placeholderTextColor="#7A8582"
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
          placeholderTextColor="#7A8582"
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
  const isSpotifyReady = Boolean(currentMember);

  return (
    <>
      <LinearGradient colors={["#10211E", "#163630"]} style={styles.roomHero}>
        <Text style={styles.roomHeroEyebrow}>Sala {room.code}</Text>
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
            color={isSpotifyReady ? "#1D7874" : "#D9B44A"}
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
  currentMember,
  onGenerateSession,
  onSavePlaylist,
  playlist,
  roomCode,
}: {
  canUsePartyTools: boolean;
  currentMember: PartyMember | null;
  onGenerateSession: () => void;
  onSavePlaylist: () => void;
  playlist: PartyRoom["playlist"];
  roomCode: string;
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
            color={canSaveOnSpotify ? "#1D7874" : "#D9B44A"}
            name={canSaveOnSpotify ? "save-outline" : "musical-notes-outline"}
            size={22}
          />
          <View style={styles.spotifyStatusCopy}>
            <Text style={styles.spotifyStatusTitle}>
              {canSaveOnSpotify ? "Guardar en mi Spotify" : "Conecta tu Spotify para guardar"}
            </Text>
            <Text style={styles.spotifyStatusText}>
              {canSaveOnSpotify
                ? `La playlist se guardara como "Sala ${roomCode}" en la cuenta conectada de ${currentMember?.displayName}.`
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

function ProfileScreen({
  authenticatedUser,
  currentMember,
  isUpdateAvailable,
  onCheckUpdates,
  onConnectSpotify,
  onUpdatePress,
  room,
  updateError,
  updateState,
}: {
  authenticatedUser: AuthenticatedUser;
  currentMember: PartyMember | null;
  isUpdateAvailable: boolean;
  onCheckUpdates: () => Promise<void>;
  onConnectSpotify: () => Promise<void>;
  onUpdatePress: () => Promise<void>;
  room: PartyRoom;
  updateError: string;
  updateState: UpdateState;
}) {
  const updateBusy = updateState === "checking" || updateState === "downloading";
  const updateSummary = updateError
    ? updateError
    : updateBusy
      ? "Buscando o descargando cambios para esta build."
      : isUpdateAvailable
        ? "Hay una nueva version OTA lista para aplicarse sin instalar otra APK."
        : "Esta build ya puede recibir cambios de interfaz y logica por OTA sin recompilar APK.";

  return (
    <>
      <LinearGradient colors={["#0D1321", "#1D7874"]} style={styles.profileHero}>
        <View style={styles.profileHeroTop}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>{initialsFor(authenticatedUser.displayName)}</Text>
          </View>
          <View style={styles.profileHeroCopy}>
            <Text style={styles.profileHeroName}>{authenticatedUser.displayName}</Text>
            <Text style={styles.profileHeroMeta}>
              {currentMember
                ? `${currentMember.profile.archetype} listo para guardar playlists en tu cuenta`
                : "Conecta tu cuenta de Spotify para completar tu perfil y guardar la sesion final"}
            </Text>
          </View>
        </View>
        <View style={styles.profilePillRow}>
          <View style={styles.profilePill}>
            <Ionicons color="#D9B44A" name="albums-outline" size={14} />
            <Text style={styles.profilePillText}>Sala {room.code}</Text>
          </View>
          <View style={styles.profilePill}>
            <Ionicons color="#D9B44A" name="people-outline" size={14} />
            <Text style={styles.profilePillText}>{room.members.length} conectados</Text>
          </View>
          <View style={styles.profilePill}>
            <Ionicons color="#D9B44A" name={currentMember ? "musical-notes-outline" : "radio-outline"} size={14} />
            <Text style={styles.profilePillText}>{currentMember ? "Spotify listo" : "Spotify pendiente"}</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.statsGrid}>
        <Metric hot label="Fiesta" value={currentMember ? `${currentMember.stats.partyScore}%` : "--"} />
        <Metric label="Caos" value={currentMember ? `${currentMember.stats.chaosScore}%` : `${room.scores.chaos}%`} />
        <Metric label="Repeticion" value={currentMember ? `${currentMember.stats.repeatRisk}%` : "--"} />
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
            <Text style={styles.stageTitle}>{currentMember ? "Conectado" : "Pendiente"}</Text>
            <Text style={styles.stageText}>
              {currentMember
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

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Mi perfil musical</Text>
        {currentMember ? (
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
            <TagSection color="#1D7874" items={currentMember.profile.strengths} title="Fortalezas" />
            <TagSection color="#EE4266" items={currentMember.profile.crimes} title="Delitos musicales" />
            <TagSection color="#D9B44A" items={currentMember.topArtists.slice(0, 4)} title="Top artistas" />
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
    <View style={styles.tabBarShell}>
      <View style={styles.tabBar}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={[styles.tabButton, activeTab === tab.id && styles.tabButtonActive]}
          >
            <Ionicons
              color={activeTab === tab.id ? "#0D1321" : "#D8E3E0"}
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
        {busy ? <ActivityIndicator color="#0D1321" /> : <Text style={styles.updateButtonText}>Actualizar</Text>}
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
    marginBottom: 18,
  },
  brandCopy: {
    flex: 1,
  },
  logo: {
    borderRadius: 14,
    height: 46,
    width: 46,
  },
  homeHero: {
    borderRadius: 8,
    marginBottom: 14,
    overflow: "hidden",
    padding: 18,
  },
  homeEyebrow: {
    color: "#B8CCC8",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  homeHeroTitle: {
    color: "#FFFFFF",
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
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  homeHeroPillText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
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
  roomHero: {
    borderRadius: 8,
    marginBottom: 14,
    overflow: "hidden",
    padding: 16,
  },
  roomHeroEyebrow: {
    color: "#B8CCC8",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  roomHeroTitle: {
    color: "#FFFFFF",
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
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  roomHeroPillValue: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  roomHeroPillLabel: {
    color: "#B8CCC8",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 4,
  },
  profileHero: {
    borderRadius: 8,
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
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
  },
  profileHeroCopy: {
    flex: 1,
  },
  profileHeroName: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  profileHeroEmail: {
    color: "#D8E3E0",
    fontSize: 13,
    marginTop: 2,
  },
  profileHeroMeta: {
    color: "#B8CCC8",
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
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  profilePillText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
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
    backgroundColor: "#10211E",
    borderRadius: 20,
    flexDirection: "row",
    gap: 6,
    padding: 6,
  },
  tabBarShell: {
    backgroundColor: "#F8F4E3",
    borderBottomColor: "#E3DED0",
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  updateBanner: {
    alignItems: "center",
    backgroundColor: "#E8FFF4",
    borderBottomColor: "#B6E8D0",
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
    color: "#0D1321",
    fontSize: 14,
    fontWeight: "900",
  },
  updateBannerText: {
    color: "#285145",
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
    backgroundColor: "#D9B44A",
    borderRadius: 8,
    height: 38,
    justifyContent: "center",
    minWidth: 102,
    paddingHorizontal: 14,
  },
  updateButtonText: {
    color: "#0D1321",
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
    backgroundColor: "#D9B44A",
  },
  tabText: {
    color: "#D8E3E0",
    fontSize: 11,
    fontWeight: "800",
  },
  tabTextActive: {
    color: "#0D1321",
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
  inviteCodeCard: {
    alignItems: "center",
    backgroundColor: "#F8F4E3",
    borderColor: "#E3DED0",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  inviteCodeText: {
    color: "#0D1321",
    fontSize: 28,
    fontVariant: ["tabular-nums"],
    fontWeight: "900",
    letterSpacing: 0,
  },
  inviteCodeHint: {
    color: "#6C7774",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  spotifyStatusCard: {
    alignItems: "flex-start",
    backgroundColor: "#F8F4E3",
    borderColor: "#E3DED0",
    borderRadius: 8,
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
    color: "#0D1321",
    fontSize: 14,
    fontWeight: "900",
  },
  spotifyStatusText: {
    color: "#596663",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  helperText: {
    color: "#6C7774",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
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
  stageGrid: {
    gap: 10,
  },
  stageCard: {
    backgroundColor: "#F8F4E3",
    borderColor: "#E3DED0",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  stageNumber: {
    color: "#1D7874",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  stageTitle: {
    color: "#0D1321",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },
  stageText: {
    color: "#596663",
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
    backgroundColor: "#F8F4E3",
    borderColor: "#E3DED0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
    padding: 12,
  },
  memberMiniCurrent: {
    backgroundColor: "#F0FBF8",
    borderColor: "#1D7874",
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
  memberBadge: {
    backgroundColor: "#10211E",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  memberBadgeText: {
    color: "#FFFFFF",
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
    backgroundColor: "#FFFFFF",
    borderColor: "#E3DED0",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  memberTagText: {
    color: "#596663",
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
