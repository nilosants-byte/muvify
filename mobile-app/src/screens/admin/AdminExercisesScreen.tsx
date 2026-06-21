import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { MvButton } from "../../components/mv/MvButton";
import { MvInput } from "../../components/mv/MvInput";
import { MvText } from "../../components/mv/MvText";
import { PressableScale } from "../../components/polish/PressableScale";
import {
  adminExerciseApi,
  Exercise,
  EXERCISE_CATEGORIES,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { AdminScaffold } from "./AdminScaffold";
import { handleScreenError } from "../shared/api-helpers";
import { useMvTheme } from "../../theme/MvThemeContext";

type Props = { navigation: any };

// Padrão fixo para todos os exercícios do banco Muvify
const DEFAULT_REPS = "3x12";
const DEFAULT_REST = "60s";
const DEFAULT_LOAD = "0 kg";

type FormState = {
  name: string;
  category: string;
  youtubeUrl: string;
};

const emptyForm = (): FormState => ({
  name: "",
  category: EXERCISE_CATEGORIES[0],
  youtubeUrl: "",
});

function exerciseToForm(ex: Exercise): FormState {
  return {
    name: ex.name,
    category: ex.category,
    youtubeUrl: ex.mediaType === "YOUTUBE" ? (ex.mediaUrl ?? "") : "",
  };
}

function isValidYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

function SearchBar({ value, onChangeText, onClear }: { value: string; onChangeText: (t: string) => void; onClear: () => void }) {
  const { theme } = useMvTheme();
  return (
    <View style={{
      flexDirection: "row", alignItems: "center",
      backgroundColor: theme.inputBg, borderRadius: 12,
      borderWidth: 1, borderColor: theme.border,
      paddingHorizontal: 12, height: 44,
    }}>
      <Ionicons name="search" size={16} color={theme.text3} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Buscar por nome..."
        placeholderTextColor={theme.text3}
        maxLength={100}
        accessibilityLabel="Buscar exercício por nome"
        style={{ flex: 1, marginLeft: 8, color: theme.text1, fontFamily: "DMSans_400Regular", fontSize: 14 }}
      />
      {value.length > 0 && (
        <PressableScale
          onPress={onClear}
          accessibilityRole="button"
          style={{ padding: 6, minHeight: 44, justifyContent: "center" }}
        >
          <Ionicons name="close-circle" size={16} color={theme.text3} />
        </PressableScale>
      )}
    </View>
  );
}

export function AdminExercisesScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { runWithAuth, showToast } = useAppState();

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        const data = await runWithAuth((token) =>
          adminExerciseApi.list(token, {
            category: selectedCategory ?? undefined,
            q: searchQuery || undefined,
          })
        );
        setExercises(data);
      } catch (error) {
        handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar exercícios.", navigation });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [navigation, runWithAuth, selectedCategory, searchQuery, showToast]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, []);

  useEffect(() => {
    if (!modalVisible) {
      setForm(emptyForm());
      setEditingId(null);
    }
  }, [modalVisible]);

  function handleSearchChange(text: string) {
    setSearchQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void load(), 400);
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setModalVisible(true);
  }

  function openEdit(ex: Exercise) {
    setEditingId(ex.id);
    setForm(exerciseToForm(ex));
    setModalVisible(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      showToast("Nome é obrigatório.", "error");
      return;
    }
    const youtubeUrl = form.youtubeUrl.trim();
    if (youtubeUrl && !isValidYouTubeUrl(youtubeUrl)) {
      showToast("URL inválida. Use um link do YouTube (youtube.com ou youtu.be).", "error");
      return;
    }
    try {
      setSaving(true);
      const body = {
        name: form.name.trim(),
        category: form.category,
        defaultRepetitionsSets: DEFAULT_REPS,
        defaultRestLabel: DEFAULT_REST,
        mediaUrl: youtubeUrl || undefined,
        mediaType: youtubeUrl ? ("YOUTUBE" as const) : undefined,
      };
      if (editingId) {
        const updated = await runWithAuth((token) =>
          adminExerciseApi.update(token, editingId, body)
        );
        setExercises((prev) => prev.map((e) => (e.id === editingId ? updated : e)));
        showToast("Exercício atualizado.", "success");
      } else {
        const created = await runWithAuth((token) =>
          adminExerciseApi.create(token, body)
        );
        setExercises((prev) => [created, ...prev]);
        showToast("Exercício criado.", "success");
      }
      setModalVisible(false);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar exercício.", navigation });
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(ex: Exercise) {
    Alert.alert(
      "Remover exercício?",
      `Remover "${ex.name ?? "este exercício"}" permanentemente?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Remover",
          style: "destructive",
          onPress: async () => {
            try {
              await runWithAuth((token) => adminExerciseApi.delete(token, ex.id));
              setExercises((prev) => prev.filter((e) => e.id !== ex.id));
              showToast("Exercício removido.", "success");
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Falha ao remover.", navigation });
            }
          },
        },
      ]
    );
  }

  return (
    <AdminScaffold title="Banco de exercícios" navigation={navigation} currentScreen="AdminExercises">
      <View style={{ flex: 1 }}>
        {/* Legenda do padrão */}
        <View style={{
          marginHorizontal: 16, marginTop: 10, marginBottom: 4,
          paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
          backgroundColor: theme.primarySubtle,
          borderWidth: 1, borderColor: theme.primarySubtleBorder,
          flexDirection: "row", alignItems: "center", gap: 8,
        }}>
          <Ionicons name="information-circle-outline" size={16} color={theme.primary} />
          <MvText variant="body4" style={{ color: theme.primary, flex: 1 }}>
            Padrão: {DEFAULT_REPS} · {DEFAULT_REST} · {DEFAULT_LOAD} — editável pelo profissional no treino
          </MvText>
        </View>

        {/* Search bar */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}>
          <SearchBar
            value={searchQuery}
            onChangeText={handleSearchChange}
            onClear={() => { setSearchQuery(""); void load(); }}
          />
        </View>

        {/* Category filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ maxHeight: 44 }}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: "center" }}
        >
          <PressableScale
            onPress={() => setSelectedCategory(null)}
            style={{
              paddingHorizontal: 14, height: 32, borderRadius: 16, borderWidth: 1,
              justifyContent: "center",
              borderColor: !selectedCategory ? theme.primary : theme.border,
              backgroundColor: !selectedCategory ? theme.primarySubtle : "transparent",
            }}
          >
            <MvText variant="caption" style={{ color: !selectedCategory ? theme.primary : theme.text2 }}>Todas</MvText>
          </PressableScale>
          {EXERCISE_CATEGORIES.map((cat) => (
            <PressableScale
              key={cat}
              onPress={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
              style={{
                paddingHorizontal: 14, height: 32, borderRadius: 16, borderWidth: 1,
                justifyContent: "center",
                borderColor: selectedCategory === cat ? theme.primary : theme.border,
                backgroundColor: selectedCategory === cat ? theme.primarySubtle : "transparent",
              }}
            >
              <MvText variant="caption" style={{ color: selectedCategory === cat ? theme.primary : theme.text2 }}>{cat}</MvText>
            </PressableScale>
          ))}
        </ScrollView>

        {/* Exercise list */}
        <FlatList
          data={exercises}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 60 }}>
              <Ionicons name="barbell-outline" size={48} color={theme.text3} />
              <MvText variant="body3" color="secondary" style={{ marginTop: 12, textAlign: "center" }}>
                {loading ? "Carregando..." : "Nenhum exercício encontrado"}
              </MvText>
            </View>
          }
          renderItem={({ item }) => (
            <PressableScale
              onPress={() => openEdit(item)}
              onLongPress={() => confirmDelete(item)}
              accessibilityRole="button"
              accessibilityLabel={`Exercício: ${item.name ?? "Sem nome"}`}
              accessibilityHint="Toque para editar. Pressione e segure para excluir."
              style={{
                backgroundColor: theme.cardBg,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.border,
                padding: 14,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <MvText variant="semi3" numberOfLines={1} style={{ flex: 1 }}>{item.name}</MvText>
                    {item.mediaType === "YOUTUBE" && (
                      <View style={{ backgroundColor: "rgba(255,0,0,0.10)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <MvText variant="caption" style={{ color: "#e00" }}>YT</MvText>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                    <MvText variant="body4" color="secondary">{item.category ?? "—"}</MvText>
                    <MvText variant="body4" color="secondary">· {DEFAULT_REPS}</MvText>
                    <MvText variant="body4" color="secondary">· {DEFAULT_REST}</MvText>
                    <MvText variant="body4" color="secondary">· {DEFAULT_LOAD}</MvText>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.text3} />
              </View>
            </PressableScale>
          )}
        />

        {/* FAB */}
        <PressableScale
          onPress={openCreate}
          accessibilityRole="button"
          accessibilityLabel="Novo exercício"
          style={{
            position: "absolute",
            bottom: 24,
            right: 20,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: theme.primary,
            alignItems: "center",
            justifyContent: "center",
            shadowColor: theme.primary,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.4,
            shadowRadius: 8,
            elevation: 6,
          }}
        >
          <Ionicons name="add" size={28} color={theme.textOnPrimary} />
        </PressableScale>
      </View>

      {/* Create / Edit Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setModalVisible(false); setForm(emptyForm()); setEditingId(null); }}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: theme.bg }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* Modal header */}
          <View style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
          }}>
            <PressableScale
              onPress={() => setModalVisible(false)}
              style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }}
            >
              <MvText variant="body2" color="secondary">Cancelar</MvText>
            </PressableScale>
            <MvText variant="semi2">{editingId ? "Editar exercício" : "Novo exercício"}</MvText>
            <PressableScale
              onPress={() => { if (!saving) void handleSave(); }}
              style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 4, opacity: saving ? 0.5 : 1 }}
            >
              <MvText variant="semi2" style={{ color: saving ? theme.text3 : theme.primary }}>
                {saving ? "Salvando..." : "Salvar"}
              </MvText>
            </PressableScale>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 20, gap: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Name */}
            <MvInput
              label="Nome *"
              value={form.name}
              onChangeText={(v) => setForm((p) => ({ ...p, name: v }))}
              placeholder="Ex: Supino reto com barra"
              maxLength={80}
            />

            {/* Category */}
            <View style={{ gap: 6 }}>
              <MvText variant="caption" color="secondary">Categoria</MvText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ maxHeight: 44 }}
                contentContainerStyle={{ gap: 8, alignItems: "center" }}
              >
                {EXERCISE_CATEGORIES.map((cat) => (
                  <PressableScale
                    key={cat}
                    onPress={() => setForm((p) => ({ ...p, category: cat }))}
                    style={{
                      paddingHorizontal: 14, height: 34, borderRadius: 17, borderWidth: 1,
                      justifyContent: "center",
                      borderColor: form.category === cat ? theme.primary : theme.border,
                      backgroundColor: form.category === cat ? theme.primarySubtle : "transparent",
                    }}
                  >
                    <MvText variant="caption" style={{ color: form.category === cat ? theme.primary : theme.text2 }}>{cat}</MvText>
                  </PressableScale>
                ))}
              </ScrollView>
            </View>

            {/* Padrão fixo — somente informativo */}
            <View style={{
              padding: 12, borderRadius: 10,
              backgroundColor: theme.inputBg,
              borderWidth: 1, borderColor: theme.border,
              gap: 4,
            }}>
              <MvText variant="caption" color="secondary">Configuração padrão (não editável)</MvText>
              <MvText variant="body3">{DEFAULT_REPS} · {DEFAULT_REST} · Carga {DEFAULT_LOAD}</MvText>
              <MvText variant="body4" color="tertiary">O profissional ajusta esses valores ao montar o treino.</MvText>
            </View>

            {/* YouTube URL */}
            <MvInput
              label="URL do YouTube (opcional)"
              value={form.youtubeUrl}
              onChangeText={(v) => setForm((p) => ({ ...p, youtubeUrl: v }))}
              placeholder="https://youtube.com/watch?v=..."
              autoCapitalize="none"
              keyboardType="url"
              maxLength={2048}
            />

            {/* Delete button in edit mode */}
            {editingId && (
              <MvButton
                variant="danger"
                label="Remover exercício"
                style={{ marginTop: 8 }}
                onPress={() => {
                  const ex = exercises.find((e) => e.id === editingId);
                  if (ex) {
                    setModalVisible(false);
                    setTimeout(() => confirmDelete(ex), 300);
                  }
                }}
              />
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </AdminScaffold>
  );
}
