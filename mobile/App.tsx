import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { getRecommendations } from "./src/services/api";
import type { RecommendationResponse, Track } from "./src/types/recommendations";

const SUGGESTIONS = [
  "Entrenar con energia",
  "Cena tranquila",
  "Concentracion para programar",
  "Viaje de noche",
];

export default function App() {
  const [prompt, setPrompt] = useState("Concentracion para programar");
  const [data, setData] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = useMemo(() => prompt.trim().length > 1 && !loading, [loading, prompt]);

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    setLoading(true);

    try {
      const response = await getRecommendations(prompt.trim());
      setData(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo conectar con el servidor.";
      Alert.alert("Error", message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", android: undefined })}
        style={styles.screen}
      >
        <LinearGradient colors={["#101820", "#183A37"]} style={styles.header}>
          <View style={styles.brandRow}>
            <Image source={require("./assets/icon.png")} style={styles.logo} />
            <View>
              <Text style={styles.appName}>MoodMix</Text>
              <Text style={styles.caption}>AI + Spotify discovery</Text>
            </View>
          </View>

          <Text style={styles.title}>Encuentra canciones para cualquier momento.</Text>

          <View style={styles.searchPanel}>
            <TextInput
              accessibilityLabel="Mood or plan"
              multiline
              onChangeText={setPrompt}
              placeholder="Describe tu mood, plan o momento"
              placeholderTextColor="#72817E"
              style={styles.input}
              value={prompt}
            />
            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={handleSubmit}
              style={({ pressed }) => [
                styles.submitButton,
                !canSubmit && styles.submitButtonDisabled,
                pressed && styles.submitButtonPressed,
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#101820" />
              ) : (
                <>
                  <Ionicons color="#101820" name="sparkles" size={18} />
                  <Text style={styles.submitText}>Crear mix</Text>
                </>
              )}
            </Pressable>
          </View>
        </LinearGradient>

        <View style={styles.content}>
          <FlatList
            ListHeaderComponent={
              <>
                <View style={styles.suggestionRow}>
                  {SUGGESTIONS.map((suggestion) => (
                    <Pressable
                      key={suggestion}
                      onPress={() => setPrompt(suggestion)}
                      style={styles.suggestion}
                    >
                      <Text style={styles.suggestionText}>{suggestion}</Text>
                    </Pressable>
                  ))}
                </View>

                {data ? (
                  <View style={styles.briefPanel}>
                    <Text style={styles.briefTitle}>{data.brief.title}</Text>
                    <Text style={styles.briefText}>{data.brief.vibe}</Text>
                    <Text style={styles.queryText}>Busqueda: {data.brief.searchQuery}</Text>
                  </View>
                ) : (
                  <View style={styles.emptyState}>
                    <Ionicons color="#D9B44A" name="musical-notes-outline" size={34} />
                    <Text style={styles.emptyTitle}>Tu primer mix espera.</Text>
                    <Text style={styles.emptyText}>
                      Prueba una idea y la app generara una busqueda musical con OpenAI.
                    </Text>
                  </View>
                )}
              </>
            }
            contentContainerStyle={styles.listContent}
            data={data?.tracks || []}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <TrackRow track={item} />}
            showsVerticalScrollIndicator={false}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function TrackRow({ track }: { track: Track }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        if (track.spotifyUrl) {
          Linking.openURL(track.spotifyUrl);
        }
      }}
      style={({ pressed }) => [styles.trackRow, pressed && styles.trackRowPressed]}
    >
      {track.imageUrl ? (
        <Image source={{ uri: track.imageUrl }} style={styles.cover} />
      ) : (
        <View style={styles.coverFallback}>
          <Ionicons color="#D9B44A" name="disc-outline" size={24} />
        </View>
      )}
      <View style={styles.trackInfo}>
        <Text numberOfLines={1} style={styles.trackTitle}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={styles.trackArtist}>
          {track.artist}
        </Text>
        <Text numberOfLines={1} style={styles.trackAlbum}>
          {track.album}
        </Text>
      </View>
      <Ionicons color="#183A37" name="open-outline" size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#101820",
  },
  screen: {
    flex: 1,
    backgroundColor: "#F4F1EA",
  },
  header: {
    paddingBottom: 26,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  logo: {
    borderRadius: 16,
    height: 48,
    width: 48,
  },
  appName: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  caption: {
    color: "#B7C7C3",
    fontSize: 12,
    marginTop: 2,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36,
    marginBottom: 18,
  },
  searchPanel: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    gap: 12,
    padding: 12,
  },
  input: {
    color: "#101820",
    fontSize: 16,
    lineHeight: 22,
    minHeight: 78,
    textAlignVertical: "top",
  },
  submitButton: {
    alignItems: "center",
    backgroundColor: "#D9B44A",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    height: 48,
    justifyContent: "center",
  },
  submitButtonDisabled: {
    opacity: 0.55,
  },
  submitButtonPressed: {
    transform: [{ scale: 0.99 }],
  },
  submitText: {
    color: "#101820",
    fontSize: 16,
    fontWeight: "800",
  },
  content: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    paddingBottom: 34,
  },
  suggestionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  suggestion: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E0DDD5",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  suggestionText: {
    color: "#183A37",
    fontSize: 13,
    fontWeight: "700",
  },
  briefPanel: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    marginBottom: 14,
    padding: 16,
  },
  briefTitle: {
    color: "#101820",
    fontSize: 20,
    fontWeight: "800",
  },
  briefText: {
    color: "#41504D",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 6,
  },
  queryText: {
    color: "#7A6A36",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 12,
  },
  emptyState: {
    alignItems: "flex-start",
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    marginBottom: 14,
    padding: 18,
  },
  emptyTitle: {
    color: "#101820",
    fontSize: 20,
    fontWeight: "800",
    marginTop: 12,
  },
  emptyText: {
    color: "#55625F",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  trackRow: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
    padding: 10,
  },
  trackRowPressed: {
    opacity: 0.82,
  },
  cover: {
    borderRadius: 6,
    height: 58,
    width: 58,
  },
  coverFallback: {
    alignItems: "center",
    backgroundColor: "#183A37",
    borderRadius: 6,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    color: "#101820",
    fontSize: 16,
    fontWeight: "800",
  },
  trackArtist: {
    color: "#41504D",
    fontSize: 14,
    marginTop: 3,
  },
  trackAlbum: {
    color: "#7B8784",
    fontSize: 12,
    marginTop: 2,
  },
});
