import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Provider = "apple" | "google";

const THEME = {
  accent: "#A7E3BE",
  accentSoft: "#173429",
  background: "#07110D",
  border: "#28483B",
  input: "#0D1713",
  muted: "#9CB8AD",
  mutedSoft: "#6F8A7E",
  panel: "#0F1D18",
  panelSoft: "#142720",
  text: "#F2FFF7",
};

export function AuthScreen({
  busy,
  canUseAuth,
  onSignIn,
  onSignUp,
  onSocial,
}: {
  busy: string;
  canUseAuth: boolean;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<void>;
  onSocial: (provider: Provider) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState("");
  const [password, setPassword] = useState("");

  function validateCredentials() {
    if (!canUseAuth) {
      return "Esta APK no lleva la configuracion de Supabase. Instala la build nueva antes de probar el login.";
    }

    if (!email.includes("@") || email.trim().length < 6) {
      return "Escribe un correo real antes de continuar.";
    }

    if (password.length < 6) {
      return "La contrasena necesita al menos 6 caracteres.";
    }

    return null;
  }

  async function handleEmailAction(action: "signin" | "signup") {
    const nextFeedback = validateCredentials();

    if (nextFeedback) {
      setFeedback(nextFeedback);
      return;
    }

    setFeedback("");

    if (action === "signin") {
      await onSignIn(email.trim(), password);
      return;
    }

    await onSignUp(email.trim(), password);
  }

  async function handleSocial(provider: Provider) {
    if (!canUseAuth) {
      setFeedback(
        "Esta APK no lleva Supabase embebido. Reinstala la build que muestre un proyecto valido en esta pantalla.",
      );
      return;
    }

    setFeedback("");
    await onSocial(provider);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={["#07110D", "#163429", "#255847"]} style={styles.header}>
        <Text style={styles.title}>kazp</Text>
        <Text style={styles.subtitle}>
          Antes de entrar en la fiesta, cada persona necesita cuenta propia.
        </Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Inicia sesion</Text>
          <Text style={styles.metaText}>Entra para crear sala, conectar Spotify y arrancar la fiesta.</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="correo@ejemplo.com"
            placeholderTextColor={THEME.mutedSoft}
            style={styles.input}
            value={email}
          />
          <TextInput
            autoCapitalize="none"
            autoComplete="password"
            onChangeText={setPassword}
            placeholder="Contrasena"
            placeholderTextColor={THEME.mutedSoft}
            secureTextEntry
            style={styles.input}
            value={password}
          />

          {feedback ? <Text style={styles.feedbackError}>{feedback}</Text> : null}
          {!feedback ? (
            <Text style={styles.feedbackHint}>
              Usa un correo real y una contrasena de al menos 6 caracteres.
            </Text>
          ) : null}

          <ButtonRow
            busy={busy}
            label="Entrar"
            loadingKey="signin"
            onPress={() => void handleEmailAction("signin")}
          />
          <ButtonRow
            busy={busy}
            label="Crear cuenta"
            loadingKey="signup"
            onPress={() => void handleEmailAction("signup")}
            variant="ghost"
          />

          <Separator label="o sigue con" />

          <ButtonRow
            busy={busy}
            icon="logo-google"
            label="Google"
            loadingKey="google"
            onPress={() => void handleSocial("google")}
          />
          {Platform.OS === "ios" ? (
            <ButtonRow
              busy={busy}
              icon="logo-apple"
              label="Apple"
              loadingKey="apple"
              onPress={() => void handleSocial("apple")}
              variant="dark"
            />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Separator({ label }: { label: string }) {
  return (
    <View style={styles.separatorRow}>
      <View style={styles.separatorLine} />
      <Text style={styles.separatorLabel}>{label}</Text>
      <View style={styles.separatorLine} />
    </View>
  );
}

function ButtonRow({
  busy,
  icon,
  label,
  loadingKey,
  onPress,
  variant = "primary",
}: {
  busy: string;
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  loadingKey: string;
  onPress: () => void;
  variant?: "dark" | "ghost" | "primary";
}) {
  const loading = busy === loadingKey;

  return (
    <Pressable
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "dark" && styles.buttonDark,
        variant === "ghost" && styles.buttonGhost,
        loading && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "dark" ? THEME.text : THEME.background} />
      ) : (
        <>
          {icon ? (
            <Ionicons
              color={variant === "dark" ? THEME.text : THEME.background}
              name={icon}
              size={18}
            />
          ) : null}
          <Text style={[styles.buttonText, variant === "dark" && styles.buttonTextDark]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: THEME.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 24,
  },
  title: {
    color: THEME.text,
    fontSize: 32,
    fontWeight: "900",
  },
  subtitle: {
    color: THEME.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    maxWidth: 420,
  },
  content: {
    padding: 18,
    paddingBottom: 34,
  },
  card: {
    backgroundColor: THEME.panel,
    borderColor: THEME.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  cardTitle: {
    color: THEME.text,
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 14,
  },
  metaText: {
    color: THEME.muted,
    fontSize: 13,
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
    height: 50,
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  feedbackError: {
    color: "#B42318",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
    marginBottom: 10,
  },
  feedbackHint: {
    color: THEME.mutedSoft,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginBottom: 10,
  },
  button: {
    alignItems: "center",
    backgroundColor: THEME.accent,
    borderRadius: 14,
    flexDirection: "row",
    gap: 8,
    height: 48,
    justifyContent: "center",
    marginBottom: 10,
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
    opacity: 0.55,
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
  separatorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginVertical: 12,
  },
  separatorLine: {
    backgroundColor: THEME.border,
    flex: 1,
    height: 1,
  },
  separatorLabel: {
    color: THEME.mutedSoft,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
});
