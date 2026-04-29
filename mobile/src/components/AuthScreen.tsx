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
      <LinearGradient colors={["#0D1321", "#1D7874"]} style={styles.header}>
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
            placeholderTextColor="#6C7774"
            style={styles.input}
            value={email}
          />
          <TextInput
            autoCapitalize="none"
            autoComplete="password"
            onChangeText={setPassword}
            placeholder="Contrasena"
            placeholderTextColor="#6C7774"
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
        <ActivityIndicator color={variant === "dark" ? "#F8F4E3" : "#0D1321"} />
      ) : (
        <>
          {icon ? (
            <Ionicons
              color={variant === "dark" ? "#F8F4E3" : "#0D1321"}
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
    backgroundColor: "#0D1321",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 24,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 32,
    fontWeight: "900",
  },
  subtitle: {
    color: "#D8E3E0",
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
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 18,
  },
  cardTitle: {
    color: "#0D1321",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 14,
  },
  metaText: {
    color: "#596663",
    fontSize: 13,
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
    color: "#6C7774",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginBottom: 10,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#D9B44A",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    height: 48,
    justifyContent: "center",
    marginBottom: 10,
  },
  buttonDark: {
    backgroundColor: "#0D1321",
  },
  buttonGhost: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E3DED0",
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.55,
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
  separatorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginVertical: 12,
  },
  separatorLine: {
    backgroundColor: "#E3DED0",
    flex: 1,
    height: 1,
  },
  separatorLabel: {
    color: "#6C7774",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
});
