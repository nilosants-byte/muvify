import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import {
  ApiError,
  consultancyApi,
  EXERCISE_CATEGORIES,
  Exercise,
  ExerciseCategory,
  ExerciseMediaType,
  exerciseApi,
  providersApi,
  TrainingPlan,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvInput, MvMediaViewer, MvText } from "../../components/mv";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "TrainingCreation">;
type ActiveTab = "mine" | "prebuilt";

type DraftPlanExercise = {
  uid: string;
  exerciseId?: string;
  name: string;
  category?: string;
  repetitionsSets: string;
  load: string;
  restLabel: string;
  demoVideoUrl?: string;
  mediaUrl?: string;
  mediaType?: ExerciseMediaType | null;
};

type CreateExerciseForm = {
  name: string;
  category: ExerciseCategory | "";
  repetitionsSets: string;
  restLabel: string;
  description: string;
  mediaUrl: string;
  mediaType: ExerciseMediaType | "";
};

type ResolvedMedia = {
  url: string;
  type: ExerciseMediaType;
};

type MediaPreviewState = {
  url: string;
  type: ExerciseMediaType;
  title: string;
} | null;

const LIST_BOX_MAX_HEIGHT = 392;
const MAX_MEDIA_UPLOAD_BYTES = 5_500_000;
const MAX_MEDIA_PAYLOAD_CHARS = 7_500_000;
const VIDEO_MAX_DURATION_SECONDS = 30; // ~30s é o limite razoável para demo de exercício

const EMPTY_EXERCISE_FORM: CreateExerciseForm = {
  name: "",
  category: "",
  repetitionsSets: "",
  restLabel: "",
  description: "",
  mediaUrl: "",
  mediaType: "",
};

function createUid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isYouTubeUrl(url: string) {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm|m3u8)(\?.*)?$/i.test(url);
}

function isGifUrl(url: string) {
  return /\.gif(\?.*)?$/i.test(url);
}

function inferMediaTypeFromUrl(url: string): ExerciseMediaType | "" {
  const normalized = url.trim().toLowerCase();
  if (!normalized) return "";
  if (isYouTubeUrl(normalized)) return "YOUTUBE";
  if (normalized.startsWith("data:video/") || normalized.startsWith("file://") || isVideoUrl(normalized)) return "VIDEO";
  if (normalized.startsWith("data:image/gif") || isGifUrl(normalized)) return "GIF";
  if (normalized.startsWith("data:image/")) return "IMAGE";
  if (/^https?:\/\//i.test(normalized)) {
    if (isGifUrl(normalized)) return "GIF";
    if (isVideoUrl(normalized)) return "VIDEO";
    return "IMAGE";
  }
  return "";
}

function extractYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\s?/]+)/i);
  return match?.[1] ?? null;
}

function getYouTubeThumbnail(url: string): string | null {
  const id = extractYouTubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
}

function resolveExerciseMedia(mediaUrl?: string | null, mediaType?: ExerciseMediaType | null): ResolvedMedia | null {
  const normalizedUrl = mediaUrl?.trim();
  if (!normalizedUrl) return null;
  const resolvedType = mediaType ?? inferMediaTypeFromUrl(normalizedUrl);
  if (!resolvedType) return null;
  return { url: normalizedUrl, type: resolvedType };
}

function toDraftExercise(exercise: Exercise): DraftPlanExercise {
  const media = resolveExerciseMedia(exercise.mediaUrl, exercise.mediaType);
  return {
    uid: createUid(exercise.id),
    exerciseId: exercise.id,
    name: exercise.name,
    category: exercise.category,
    repetitionsSets: exercise.defaultRepetitionsSets?.trim() || "4x12",
    load: "A definir",
    restLabel: exercise.defaultRestLabel?.trim() || "60s",
    demoVideoUrl:
      exercise.mediaType === "YOUTUBE" && exercise.mediaUrl
        ? exercise.mediaUrl
        : undefined,
    mediaUrl: media?.url,
    mediaType: media?.type ?? null,
  };
}

function toDraftExerciseFromPlanItem(
  item: TrainingPlan["exercises"][number],
  index: number
): DraftPlanExercise {
  const media =
    resolveExerciseMedia(item.exercise?.mediaUrl, item.exercise?.mediaType) ??
    resolveExerciseMedia(item.demoVideoUrl, item.demoVideoUrl ? "YOUTUBE" : null);

  return {
    uid: item.id ?? `${item.exerciseId ?? "exercise"}-${index}`,
    exerciseId: item.exerciseId ?? item.exercise?.id ?? undefined,
    name: item.name,
    category: item.exercise?.category ?? undefined,
    repetitionsSets: item.repetitionsSets,
    load: item.load,
    restLabel: item.restLabel ?? (item.restSeconds ? `${item.restSeconds}s` : ""),
    demoVideoUrl: item.demoVideoUrl ?? item.exercise?.mediaUrl ?? undefined,
    mediaUrl: media?.url,
    mediaType: media?.type ?? null,
  };
}

function planValidationError(title: string, exercises: DraftPlanExercise[]): string | null {
  if (!title.trim()) return "Informe o nome do treino.";
  if (!exercises.length) return "Adicione exercicios ao treino.";
  const hasInvalid = exercises.some(
    (exercise) =>
      !exercise.name.trim() || !exercise.repetitionsSets.trim() || !exercise.load.trim()
  );
  if (hasInvalid) {
    return "Preencha nome, series x reps e carga de todos os exercicios.";
  }
  return null;
}

function patchDraftExercise(
  setter: React.Dispatch<React.SetStateAction<DraftPlanExercise[]>>,
  uid: string,
  patch: Partial<DraftPlanExercise>
) {
  setter((current) =>
    current.map((exercise) => (exercise.uid === uid ? { ...exercise, ...patch } : exercise))
  );
}

function removeDraftExercise(
  setter: React.Dispatch<React.SetStateAction<DraftPlanExercise[]>>,
  uid: string
) {
  setter((current) => current.filter((exercise) => exercise.uid !== uid));
}

async function fileUriToDataUri(uri: string, mimeType: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao processar arquivo local."));
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result.startsWith("data:") ? reader.result : `data:${mimeType};base64,${reader.result}`);
        return;
      }
      reject(new Error("Falha ao converter arquivo em base64."));
    };
    reader.readAsDataURL(blob);
  });
}

function ExerciseThumb({
  theme,
  media,
}: {
  theme: Record<string, any>;
  media: ResolvedMedia;
}) {
  const thumbnail =
    media.type === "YOUTUBE"
      ? getYouTubeThumbnail(media.url)
      : media.type === "IMAGE" || media.type === "GIF"
      ? media.url
      : null;

  if (thumbnail) {
    return (
      <Image
        source={{ uri: thumbnail }}
        style={{ width: 56, height: 56, borderRadius: 10 }}
        resizeMode="cover"
      />
    );
  }

  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.chipBg,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <Ionicons
        name={media.type === "VIDEO" || media.type === "YOUTUBE" ? "play-circle-outline" : "image-outline"}
        size={22}
        color={media.type === "VIDEO" || media.type === "YOUTUBE" ? "#FF4D4D" : theme.textGreen}
      />
    </View>
  );
}

export function ProfessionalTrainingCreationScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [mineExercises, setMineExercises] = useState<Exercise[]>([]);
  const [prebuiltExercises, setPrebuiltExercises] = useState<Exercise[]>([]);
  const [providerPlans, setProviderPlans] = useState<TrainingPlan[]>([]);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [crefApproved, setCrefApproved] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>("mine");
  const [selectedCategory, setSelectedCategory] = useState<ExerciseCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [showCreateExerciseForm, setShowCreateExerciseForm] = useState(false);
  const [exerciseForm, setExerciseForm] = useState<CreateExerciseForm>(EMPTY_EXERCISE_FORM);
  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [savingExercise, setSavingExercise] = useState(false);
  const [deletingExerciseId, setDeletingExerciseId] = useState<string | null>(null);
  const [attachingMedia, setAttachingMedia] = useState(false);

  const [showNewPlanBuilder, setShowNewPlanBuilder] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState("");
  const [newPlanDescription, setNewPlanDescription] = useState("");
  const [newPlanExercises, setNewPlanExercises] = useState<DraftPlanExercise[]>([]);
  const [savingNewPlan, setSavingNewPlan] = useState(false);

  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editingPlanTitle, setEditingPlanTitle] = useState("");
  const [editingPlanDescription, setEditingPlanDescription] = useState("");
  const [editingPlanExercises, setEditingPlanExercises] = useState<DraftPlanExercise[]>([]);
  const [savingEditedPlan, setSavingEditedPlan] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [expandedPlanIds, setExpandedPlanIds] = useState<Record<string, boolean>>({});

  const [targetExercise, setTargetExercise] = useState<Exercise | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewState>(null);

  const listIndicatorProps = useMemo(
    () => ({
      nestedScrollEnabled: true,
      showsVerticalScrollIndicator: true,
      persistentScrollbar: true,
      indicatorStyle: (theme.mode === "dark" ? "white" : "black") as "white" | "black",
      scrollIndicatorInsets: { right: 1 },
    }),
    [theme.mode]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [mine, prebuilt, plans, credentials] = await Promise.all([
        runWithAuth((token) => exerciseApi.listMine(token)).catch((error) => {
          if (error instanceof ApiError && error.status === 404) return [] as Exercise[];
          throw error;
        }),
        exerciseApi.listPrebuilt(),
        runWithAuth((token) => consultancyApi.providerPlans(token)).catch((error) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }),
        runWithAuth((token) => providersApi.myCredentials(token)).catch(() => null),
      ]);

      setCrefApproved((credentials as any)?.crefValidationStatus === "APPROVED");
      setMineExercises(mine);
      setPrebuiltExercises(prebuilt);

      if (!plans) {
        setNeedsProfileSetup(true);
        setProviderPlans([]);
      } else {
        setNeedsProfileSetup(false);
        setProviderPlans(
          plans.filter((plan) => plan.isPrebuilt && !plan.contractId && plan.isActive !== false)
        );
      }
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar banco de exercicios.",
        navigation,
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredMine = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    return mineExercises.filter((exercise) => {
      const matchCategory = selectedCategory === "all" || exercise.category === selectedCategory;
      const matchQuery =
        !normalized ||
        exercise.name.toLowerCase().includes(normalized) ||
        exercise.category.toLowerCase().includes(normalized);
      return matchCategory && matchQuery;
    });
  }, [mineExercises, searchQuery, selectedCategory]);

  const filteredPrebuilt = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    return prebuiltExercises.filter((exercise) => {
      const matchCategory = selectedCategory === "all" || exercise.category === selectedCategory;
      const matchQuery =
        !normalized ||
        exercise.name.toLowerCase().includes(normalized) ||
        exercise.category.toLowerCase().includes(normalized);
      return matchCategory && matchQuery;
    });
  }, [prebuiltExercises, searchQuery, selectedCategory]);

  const displayExercises = activeTab === "mine" ? filteredMine : filteredPrebuilt;

  const selectedFormMedia = resolveExerciseMedia(
    exerciseForm.mediaUrl,
    exerciseForm.mediaType || null
  );

  const addToNewPlanBuilder = useCallback(
    (exercise: Exercise) => {
      setShowNewPlanBuilder(true);
      setNewPlanExercises((current) => [...current, toDraftExercise(exercise)]);
      showToast(`${exercise.name} adicionado ao treino em criacao.`, "success");
    },
    [showToast]
  );

  function resetNewPlanBuilder() {
    setShowNewPlanBuilder(false);
    setNewPlanTitle("");
    setNewPlanDescription("");
    setNewPlanExercises([]);
  }

  function startInlinePlanEdit(plan: TrainingPlan, extraExercise?: Exercise) {
    const draftItems = plan.exercises.map((item, index) => toDraftExerciseFromPlanItem(item, index));
    if (extraExercise) {
      draftItems.push(toDraftExercise(extraExercise));
    }

    setEditingPlanId(plan.id);
    setEditingPlanTitle(plan.title);
    setEditingPlanDescription(plan.description ?? "");
    setEditingPlanExercises(draftItems);
    setExpandedPlanIds((current) => ({ ...current, [plan.id]: true }));
  }

  function resetInlinePlanEdit() {
    setEditingPlanId(null);
    setEditingPlanTitle("");
    setEditingPlanDescription("");
    setEditingPlanExercises([]);
  }

  function togglePlanExpanded(planId: string) {
    setExpandedPlanIds((current) => ({ ...current, [planId]: !current[planId] }));
  }

  useEffect(() => {
    setExpandedPlanIds((current) => {
      const next: Record<string, boolean> = {};
      providerPlans.forEach((plan) => {
        if (current[plan.id]) next[plan.id] = true;
      });
      if (editingPlanId) next[editingPlanId] = true;
      return next;
    });
  }, [providerPlans, editingPlanId]);

  function handleAddExerciseToPlan(planId: string) {
    if (!targetExercise) return;
    const plan = providerPlans.find((item) => item.id === planId);
    if (!plan) {
      showToast("Treino não encontrado.", "error");
      return;
    }

    const selected = targetExercise;
    const execute = () => {
      if (editingPlanId === planId) {
        setEditingPlanExercises((current) => [...current, toDraftExercise(selected)]);
      } else {
        startInlinePlanEdit(plan, selected);
      }
      showToast(`${selected.name} adicionado em ${plan.title}.`, "success");
      setTargetExercise(null);
    };

    if (editingPlanId && editingPlanId !== planId) {
      Alert.alert(
        "Trocar treino em edicao?",
        "Existe um treino com alteracoes abertas. Se continuar, a edicao atual sera substituida.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Continuar", onPress: execute },
        ]
      );
      return;
    }

    execute();
  }

  function handleAddExerciseToNewPlan() {
    if (!targetExercise) return;
    addToNewPlanBuilder(targetExercise);
    setTargetExercise(null);
  }

  function handleAddExerciseToOpenBuilder() {
    if (!targetExercise) return;
    if (!showNewPlanBuilder) {
      addToNewPlanBuilder(targetExercise);
      setTargetExercise(null);
      return;
    }
    setNewPlanExercises((current) => [...current, toDraftExercise(targetExercise)]);
    showToast(`${targetExercise.name} adicionado ao treino em criacao.`, "success");
    setTargetExercise(null);
  }

  async function pickMediaFromLibrary(kind: "image" | "video") {
    try {
      setAttachingMedia(true);
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== "granted") {
        showToast("Permissão da galeria não concedida.", "error");
        return;
      }

      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes:
          kind === "image"
            ? ImagePicker.MediaTypeOptions.Images
            : ImagePicker.MediaTypeOptions.Videos,
        // allowsEditing=true em vídeos abre o seletor/recorte nativo (estilo WhatsApp):
        // - iOS: exibe a barra de trim para escolher o trecho desejado
        // - Android: depende da galeria do dispositivo (maioria suporta)
        allowsEditing: kind === "video",
        videoMaxDuration: VIDEO_MAX_DURATION_SECONDS,
        quality: kind === "video" ? 0.5 : 0.7,
        base64: kind === "image",
      });

      if (pickerResult.canceled) return;
      const asset = pickerResult.assets?.[0];
      if (!asset?.uri) return;

      if ((asset.fileSize ?? 0) > MAX_MEDIA_UPLOAD_BYTES) {
        showToast(
          `Arquivo ainda muito grande após o recorte (máx. 5.5 MB).\nSelecione um trecho mais curto ou use qualidade menor.`,
          "error"
        );
        return;
      }

      const mimeType =
        asset.mimeType ??
        (kind === "video"
          ? "video/mp4"
          : asset.uri.toLowerCase().includes(".gif")
          ? "image/gif"
          : "image/jpeg");

      let resolvedUrl = "";

      if (kind === "image" && asset.base64) {
        resolvedUrl = `data:${mimeType};base64,${asset.base64}`;
      } else {
        try {
          resolvedUrl = await fileUriToDataUri(asset.uri, mimeType);
        } catch {
          if (kind === "video") {
            resolvedUrl = asset.uri;
          } else {
            throw new Error("Não foi possivel processar esta midia.");
          }
        }
      }

      if (resolvedUrl.length > MAX_MEDIA_PAYLOAD_CHARS) {
        showToast("Midia muito grande para salvar. Use arquivo menor.", "error");
        return;
      }

      const resolvedType: ExerciseMediaType =
        kind === "video"
          ? "VIDEO"
          : mimeType.toLowerCase().includes("gif")
          ? "GIF"
          : "IMAGE";

      setExerciseForm((current) => ({
        ...current,
        mediaUrl: resolvedUrl,
        mediaType: resolvedType,
      }));
      setMediaUrlInput("");
      showToast(
        kind === "video"
          ? "Video anexado com sucesso."
          : "Imagem/GIF anexado com sucesso.",
        "success"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao anexar midia.";
      showToast(message, "error");
    } finally {
      setAttachingMedia(false);
    }
  }

  function handleMediaUrlChange(value: string) {
    setMediaUrlInput(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setExerciseForm((current) => ({
        ...current,
        mediaUrl: "",
        mediaType: "",
      }));
      return;
    }
    setExerciseForm((current) => ({
      ...current,
      mediaUrl: trimmed,
      mediaType: inferMediaTypeFromUrl(trimmed),
    }));
  }

  function clearExerciseMedia() {
    setExerciseForm((current) => ({
      ...current,
      mediaUrl: "",
      mediaType: "",
    }));
    setMediaUrlInput("");
  }

  async function saveExercise() {
    if (!exerciseForm.name.trim()) return showToast("Informe o nome do exercicio.", "error");
    if (!exerciseForm.category) return showToast("Selecione uma categoria.", "error");
    if (!exerciseForm.repetitionsSets.trim()) return showToast("Informe series x reps.", "error");

    try {
      setSavingExercise(true);

      const normalizedMediaUrl = exerciseForm.mediaUrl.trim();
      const normalizedMediaType = normalizedMediaUrl
        ? exerciseForm.mediaType || inferMediaTypeFromUrl(normalizedMediaUrl) || "IMAGE"
        : undefined;

      await runWithAuth((token) =>
        exerciseApi.create(token, {
          name: exerciseForm.name.trim(),
          category: exerciseForm.category as ExerciseCategory,
          description: exerciseForm.description.trim() || undefined,
          defaultRepetitionsSets: exerciseForm.repetitionsSets.trim(),
          defaultRestLabel: exerciseForm.restLabel.trim() || undefined,
          mediaUrl: normalizedMediaUrl || undefined,
          mediaType: normalizedMediaType,
        })
      );

      showToast("Exercicio criado com sucesso.", "success");
      setExerciseForm(EMPTY_EXERCISE_FORM);
      setMediaUrlInput("");
      setShowCreateExerciseForm(false);
      setActiveTab("mine");
      await loadData();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao criar exercicio.",
        navigation,
      });
    } finally {
      setSavingExercise(false);
    }
  }

  function removeExercise(exerciseId: string) {
    Alert.alert("Remover exercicio", "Deseja remover este exercicio?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover",
        style: "destructive",
        onPress: async () => {
          try {
            setDeletingExerciseId(exerciseId);
            await runWithAuth((token) => exerciseApi.delete(token, exerciseId));
            setMineExercises((current) =>
              current.filter((exercise) => exercise.id !== exerciseId)
            );
            showToast("Exercicio removido.", "success");
          } catch (error) {
            handleScreenError({
              error,
              showToast,
              fallbackMessage: "Falha ao remover exercicio.",
              navigation,
            });
          } finally {
            setDeletingExerciseId(null);
          }
        },
      },
    ]);
  }

  async function saveNewPlan() {
    const errorMessage = planValidationError(newPlanTitle, newPlanExercises);
    if (errorMessage) return showToast(errorMessage, "error");

    try {
      setSavingNewPlan(true);
      await runWithAuth((token) =>
        consultancyApi.createProviderPlan(token, {
          title: newPlanTitle.trim(),
          description: newPlanDescription.trim() || undefined,
          isPrebuilt: true,
          exercises: newPlanExercises.map((exercise, index) => ({
            sortOrder: index,
            exerciseId: exercise.exerciseId,
            name: exercise.name.trim(),
            repetitionsSets: exercise.repetitionsSets.trim(),
            load: exercise.load.trim(),
            restLabel: exercise.restLabel.trim() || undefined,
            demoVideoUrl: exercise.demoVideoUrl?.trim() || undefined,
          })),
        })
      );
      showToast("Treino criado com sucesso.", "success");
      resetNewPlanBuilder();
      await loadData();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao salvar treino.",
        navigation,
      });
    } finally {
      setSavingNewPlan(false);
    }
  }

  async function saveEditedPlan() {
    if (!editingPlanId) return;
    const errorMessage = planValidationError(editingPlanTitle, editingPlanExercises);
    if (errorMessage) return showToast(errorMessage, "error");

    try {
      setSavingEditedPlan(true);
      await runWithAuth((token) =>
        consultancyApi.updateProviderPlan(token, editingPlanId, {
          title: editingPlanTitle.trim(),
          description: editingPlanDescription.trim() || undefined,
          exercises: editingPlanExercises.map((exercise, index) => ({
            sortOrder: index,
            exerciseId: exercise.exerciseId,
            name: exercise.name.trim(),
            repetitionsSets: exercise.repetitionsSets.trim(),
            load: exercise.load.trim(),
            restLabel: exercise.restLabel.trim() || undefined,
            demoVideoUrl: exercise.demoVideoUrl?.trim() || undefined,
          })),
        })
      );
      showToast("Treino atualizado com sucesso.", "success");
      resetInlinePlanEdit();
      await loadData();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao atualizar treino.",
        navigation,
      });
    } finally {
      setSavingEditedPlan(false);
    }
  }

  function deletePlan(planId: string) {
    Alert.alert("Excluir treino", "Deseja excluir este treino?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: async () => {
          try {
            setDeletingPlanId(planId);
            await runWithAuth((token) => consultancyApi.deleteProviderPlan(token, planId));
            if (editingPlanId === planId) {
              resetInlinePlanEdit();
            }
            showToast("Treino excluido.", "success");
            await loadData();
          } catch (error) {
            handleScreenError({
              error,
              showToast,
              fallbackMessage: "Falha ao excluir treino.",
              navigation,
            });
          } finally {
            setDeletingPlanId(null);
          }
        },
      },
    ]);
  }

  function openMediaPreview(media: ResolvedMedia, title: string) {
    setMediaPreview({
      url: media.url,
      type: media.type,
      title,
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar
        barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={theme.bg}
      />

      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: theme.backBtn,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text2} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <MvText variant="semi1">Banco de Exercícios</MvText>
          <MvText variant="body4" color="secondary">
            Meus exercicios, Treinos Muvify e Criar Treinos
          </MvText>
        </View>

        <TouchableOpacity
          onPress={() => setShowCreateExerciseForm((current) => !current)}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: showCreateExerciseForm
              ? "rgba(244,67,54,0.12)"
              : "rgba(34,197,94,0.12)",
          }}
        >
          <Ionicons
            name={showCreateExerciseForm ? "close" : "add"}
            size={20}
            color={showCreateExerciseForm ? "#f44336" : "#22C55E"}
          />
        </TouchableOpacity>
      </View>

      {!crefApproved && !loading && (
        <View style={{
          marginHorizontal: 16, marginBottom: 4, marginTop: 2,
          padding: 12, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 10,
          backgroundColor: theme.mode === "dark" ? "rgba(245,158,11,0.10)" : "rgba(245,158,11,0.08)",
          borderWidth: 1, borderColor: "rgba(245,158,11,0.28)",
        }}>
          <Ionicons name="ribbon-outline" size={18} color="#F59E0B" />
          <MvText variant="body4" style={{ flex: 1, color: "#F59E0B", lineHeight: 18 }}>
            Criação de exercícios e treinos ficará disponível quando seu CREF for aprovado.
          </MvText>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 90, gap: 12 }}
        showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {needsProfileSetup ? (
          <MvCard>
            <MvText variant="semi2" style={{ marginBottom: 8 }}>
              Salve seu perfil para liberar o cadastro completo
            </MvText>
            <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
              O acesso as telas permanece normal. Para salvar exercicios e treinos, finalize seu
              perfil profissional.
            </MvText>
            <MvButton
              label="Ir para Meu Perfil"
              variant="outline"
              onPress={() =>
                navigation.navigate("ProfessionalTabs", {
                  screen: "ProfessionalProfileEditor",
                })
              }
            />
          </MvCard>
        ) : null}

        <MvCard>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
            {(["mine", "prebuilt"] as ActiveTab[]).map((tab) => {
              const active = activeTab === tab;
              const count = tab === "mine" ? filteredMine.length : filteredPrebuilt.length;
              return (
                <TouchableOpacity
                  key={tab}
                  onPress={() => setActiveTab(tab)}
                  style={{
                    flex: 1,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: active ? "rgba(34,197,94,0.35)" : theme.border,
                    backgroundColor: active ? "rgba(34,197,94,0.12)" : theme.chipBg,
                    paddingVertical: 8,
                    alignItems: "center",
                  }}
                >
                  <MvText
                    variant="semi3"
                    style={{ color: active ? theme.textGreen : theme.text2 }}
                  >
                    {tab === "mine" ? "Meus exercicios" : "Treinos Muvify"}
                  </MvText>
                  <MvText variant="badge" color="secondary">
                    {count} exercicios
                  </MvText>
                </TouchableOpacity>
              );
            })}
          </View>

          <MvInput
            placeholder="Buscar exercicios..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, marginTop: 8 }}
          >
            {(["all", ...EXERCISE_CATEGORIES] as (ExerciseCategory | "all")[]).map(
              (category) => {
                const active = selectedCategory === category;
                return (
                  <TouchableOpacity
                    key={category}
                    onPress={() => setSelectedCategory(category)}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: active ? "rgba(34,197,94,0.35)" : theme.border,
                      backgroundColor: active ? "rgba(34,197,94,0.12)" : theme.chipBg,
                    }}
                  >
                    <MvText
                      variant="badge"
                      style={{ color: active ? theme.textGreen : theme.text2 }}
                    >
                      {category === "all" ? "Todos" : category}
                    </MvText>
                  </TouchableOpacity>
                );
              }
            )}
          </ScrollView>

          {showCreateExerciseForm ? (
            <View style={{ gap: 8, marginTop: 10 }}>
              <MvInput
                placeholder="Nome do exercicio *"
                value={exerciseForm.name}
                onChangeText={(value) =>
                  setExerciseForm((current) => ({ ...current, name: value }))
                }
              />

              <MvText variant="body4" color="secondary">
                Categoria *
              </MvText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6 }}
              >
                {EXERCISE_CATEGORIES.map((category) => (
                  <TouchableOpacity
                    key={category}
                    onPress={() =>
                      setExerciseForm((current) => ({ ...current, category }))
                    }
                    style={{
                      paddingHorizontal: 9,
                      paddingVertical: 5,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor:
                        exerciseForm.category === category
                          ? "rgba(34,197,94,0.35)"
                          : theme.border,
                      backgroundColor:
                        exerciseForm.category === category
                          ? "rgba(34,197,94,0.12)"
                          : theme.chipBg,
                    }}
                  >
                    <MvText
                      variant="body4"
                      style={{
                        color:
                          exerciseForm.category === category
                            ? theme.textGreen
                            : theme.text2,
                      }}
                    >
                      {category}
                    </MvText>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <MvInput
                placeholder="Séries x Reps (ex: 4x12)"
                value={exerciseForm.repetitionsSets}
                onChangeText={(value) =>
                  setExerciseForm((current) => ({ ...current, repetitionsSets: value }))
                }
              />
              <MvInput
                placeholder="Tempo de descanso (ex: 60s)"
                value={exerciseForm.restLabel}
                onChangeText={(value) =>
                  setExerciseForm((current) => ({ ...current, restLabel: value }))
                }
              />

              <MvInput
                placeholder="Mídia por URL (YouTube, imagem, GIF ou vídeo)"
                value={mediaUrlInput}
                onChangeText={handleMediaUrlChange}
                autoCapitalize="none"
              />

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <MvButton
                    variant="outline"
                    label={attachingMedia ? "Anexando..." : "Galeria imagem/GIF"}
                    onPress={() => void pickMediaFromLibrary("image")}
                    disabled={attachingMedia}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <MvButton
                    variant="outline"
                    label={attachingMedia ? "Anexando..." : "Galeria video"}
                    onPress={() => void pickMediaFromLibrary("video")}
                    disabled={attachingMedia}
                  />
                </View>
              </View>

              {selectedFormMedia ? (
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    backgroundColor: theme.inputBg,
                    padding: 10,
                    gap: 8,
                  }}
                >
                  <MvText variant="semi3">Mídia selecionada</MvText>
                  <MvMediaViewer
                    mediaUrl={selectedFormMedia.url}
                    mediaType={selectedFormMedia.type}
                    height={170}
                    borderRadius={10}
                  />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <MvButton
                        variant="outline"
                        label="Ver em tela"
                        onPress={() =>
                          openMediaPreview(selectedFormMedia, exerciseForm.name || "Mídia do exercício")
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <MvButton variant="outline" label="Remover mídia" onPress={clearExerciseMedia} />
                    </View>
                  </View>
                </View>
              ) : null}

              <MvInput
                placeholder="Descrição (opcional)"
                value={exerciseForm.description}
                onChangeText={(value) =>
                  setExerciseForm((current) => ({ ...current, description: value }))
                }
                multiline
                numberOfLines={2}
              />

              <MvButton
                label="Salvar exercicio"
                loading={savingExercise}
                disabled={!crefApproved}
                onPress={() => void saveExercise()}
              />
            </View>
          ) : null}
        </MvCard>

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 8 }}>
            Lista de exercicios
          </MvText>
          {loading ? (
            <MvText variant="body4" color="secondary" style={{ marginBottom: 8 }}>
              Carregando...
            </MvText>
          ) : null}

          <View
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 12,
              backgroundColor: theme.inputBg,
            }}
          >
            <ScrollView
              style={{ maxHeight: LIST_BOX_MAX_HEIGHT }}
              contentContainerStyle={{ padding: 10, gap: 8 }}
              {...listIndicatorProps}
            >
              {displayExercises.map((exercise) => {
                const media = resolveExerciseMedia(exercise.mediaUrl, exercise.mediaType);
                return (
                  <View
                    key={exercise.id}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 10,
                      backgroundColor: theme.bg,
                      padding: 10,
                      gap: 8,
                    }}
                  >
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      {media ? (
                        <TouchableOpacity
                          onPress={() => openMediaPreview(media, exercise.name)}
                          activeOpacity={0.85}
                        >
                          <ExerciseThumb theme={theme as Record<string, any>} media={media} />
                        </TouchableOpacity>
                      ) : (
                        <View
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: 10,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: theme.chipBg,
                            borderWidth: 1,
                            borderColor: theme.border,
                          }}
                        >
                          <Ionicons name="barbell-outline" size={20} color={theme.text3} />
                        </View>
                      )}

                      <View style={{ flex: 1, gap: 2 }}>
                        <MvText variant="semi3">{exercise.name}</MvText>
                        <MvText variant="body4" color="secondary">
                          {exercise.category}
                        </MvText>
                        <MvText variant="body4" color="secondary">
                          Séries x Reps: {exercise.defaultRepetitionsSets?.trim() || "-"}
                        </MvText>
                        <MvText variant="body4" color="secondary">
                          Descanso: {exercise.defaultRestLabel?.trim() || "-"}
                        </MvText>
                      </View>

                      <View style={{ gap: 6 }}>
                        <TouchableOpacity
                          onPress={() => setTargetExercise(exercise)}
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 17,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: "rgba(34,197,94,0.12)",
                            borderWidth: 1,
                            borderColor: "rgba(34,197,94,0.35)",
                          }}
                        >
                          <Ionicons name="add" size={16} color={theme.textGreen} />
                        </TouchableOpacity>

                        {media ? (
                          <TouchableOpacity
                            onPress={() => openMediaPreview(media, exercise.name)}
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 17,
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: "rgba(33,150,243,0.12)",
                              borderWidth: 1,
                              borderColor: "rgba(33,150,243,0.30)",
                            }}
                          >
                            <Ionicons name="play-outline" size={16} color="#2196F3" />
                          </TouchableOpacity>
                        ) : null}

                        {!exercise.isPrebuilt ? (
                          <TouchableOpacity
                            onPress={() => removeExercise(exercise.id)}
                            disabled={deletingExerciseId === exercise.id}
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 17,
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: "rgba(244,67,54,0.10)",
                              borderWidth: 1,
                              borderColor: "rgba(244,67,54,0.25)",
                            }}
                          >
                            <Ionicons name="trash-outline" size={14} color="#f44336" />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}

              {!loading && displayExercises.length === 0 ? (
                <MvText variant="body4" color="secondary">
                  Nenhum exercicio encontrado.
                </MvText>
              ) : null}
            </ScrollView>
          </View>
        </MvCard>

        <MvCard>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <MvText variant="semi2">Criar Treinos</MvText>
            <TouchableOpacity
              onPress={() => setShowNewPlanBuilder((current) => !current)}
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(34,197,94,0.12)",
                borderWidth: 1,
                borderColor: "rgba(34,197,94,0.35)",
              }}
            >
              <Ionicons name={showNewPlanBuilder ? "close" : "add"} size={16} color={theme.textGreen} />
            </TouchableOpacity>
          </View>
          {showNewPlanBuilder ? (
            <View style={{ gap: 8 }}>
              <MvInput placeholder="Nome do Treino *" value={newPlanTitle} onChangeText={setNewPlanTitle} />
              <MvInput
                placeholder="Descrição (opcional)"
                value={newPlanDescription}
                onChangeText={setNewPlanDescription}
                multiline
                numberOfLines={2}
              />

              <MvText variant="body4" color="secondary">
                {newPlanExercises.length} exercicio(s) selecionado(s)
              </MvText>

              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  backgroundColor: theme.inputBg,
                }}
              >
                <ScrollView
                  style={{ maxHeight: LIST_BOX_MAX_HEIGHT }}
                  contentContainerStyle={{ padding: 10, gap: 8 }}
                  {...listIndicatorProps}
                >
                  {newPlanExercises.map((exercise, index) => {
                    const media = resolveExerciseMedia(exercise.mediaUrl, exercise.mediaType);
                    return (
                      <View
                        key={exercise.uid}
                        style={{
                          borderWidth: 1,
                          borderColor: theme.border,
                          borderRadius: 10,
                          backgroundColor: theme.bg,
                          padding: 10,
                          gap: 6,
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          {media ? (
                            <TouchableOpacity
                              onPress={() => openMediaPreview(media, exercise.name)}
                              activeOpacity={0.85}
                            >
                              <ExerciseThumb theme={theme as Record<string, any>} media={media} />
                            </TouchableOpacity>
                          ) : null}
                          <View style={{ flex: 1 }}>
                            <MvText variant="semi3">
                              {index + 1}. {exercise.name}
                            </MvText>
                            {exercise.category ? (
                              <MvText variant="body4" color="secondary">
                                {exercise.category}
                              </MvText>
                            ) : null}
                          </View>
                          <TouchableOpacity onPress={() => removeDraftExercise(setNewPlanExercises, exercise.uid)}>
                            <Ionicons name="trash-outline" size={16} color="#f44336" />
                          </TouchableOpacity>
                        </View>
                        <MvInput
                          placeholder="Séries x Reps (ex: 4x12)"
                          value={exercise.repetitionsSets}
                          onChangeText={(value) =>
                            patchDraftExercise(setNewPlanExercises, exercise.uid, {
                              repetitionsSets: value,
                            })
                          }
                        />
                        <MvInput
                          placeholder="Carga *"
                          value={exercise.load}
                          onChangeText={(value) =>
                            patchDraftExercise(setNewPlanExercises, exercise.uid, { load: value })
                          }
                        />
                        <MvInput
                          placeholder="Tempo de descanso (opcional)"
                          value={exercise.restLabel}
                          onChangeText={(value) =>
                            patchDraftExercise(setNewPlanExercises, exercise.uid, {
                              restLabel: value,
                            })
                          }
                        />
                      </View>
                    );
                  })}

                  {newPlanExercises.length === 0 ? (
                    <MvText variant="body4" color="secondary">
                      Use o botao + nos exercicios para montar este treino.
                    </MvText>
                  ) : null}
                </ScrollView>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <MvButton
                    label="Salvar treino"
                    loading={savingNewPlan}
                    disabled={!crefApproved}
                    onPress={() => void saveNewPlan()}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <MvButton variant="outline" label="Cancelar" onPress={resetNewPlanBuilder} />
                </View>
              </View>
            </View>
          ) : (
            <MvText variant="body4" color="secondary">
              Toque em + para criar um novo treino e usar os exercicios selecionados.
            </MvText>
          )}
        </MvCard>

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 8 }}>
            Treinos criados
          </MvText>

          <View
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 12,
              backgroundColor: theme.inputBg,
            }}
          >
            <ScrollView
              style={{ maxHeight: LIST_BOX_MAX_HEIGHT }}
              contentContainerStyle={{ padding: 10, gap: 8 }}
              {...listIndicatorProps}
            >
              {providerPlans.map((plan) => {
                const isEditing = editingPlanId === plan.id;
                const isExpanded = Boolean(expandedPlanIds[plan.id]) || isEditing;
                return (
                  <View
                    key={plan.id}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 10,
                      backgroundColor: theme.bg,
                      padding: 10,
                      gap: 8,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => {
                          if (!isEditing) togglePlanExpanded(plan.id);
                        }}
                        style={{
                          flex: 1,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <MvText variant="semi3">{plan.title}</MvText>
                          <MvText variant="body4" color="secondary">
                            {plan.exercises.length} exercicio(s)
                          </MvText>
                        </View>
                        <Ionicons
                          name={isExpanded ? "chevron-up" : "chevron-down"}
                          size={16}
                          color={theme.text3}
                        />
                      </TouchableOpacity>
                      {!isEditing ? (
                        <TouchableOpacity
                          onPress={() => startInlinePlanEdit(plan)}
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 17,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: "rgba(34,197,94,0.12)",
                            borderWidth: 1,
                            borderColor: "rgba(34,197,94,0.35)",
                          }}
                        >
                          <Ionicons name="create-outline" size={16} color={theme.textGreen} />
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {isEditing ? (
                      <View style={{ gap: 8 }}>
                        <MvInput
                          placeholder="Nome do Treino *"
                          value={editingPlanTitle}
                          onChangeText={setEditingPlanTitle}
                        />
                        <MvInput
                          placeholder="Descrição (opcional)"
                          value={editingPlanDescription}
                          onChangeText={setEditingPlanDescription}
                          multiline
                          numberOfLines={2}
                        />

                        <View
                          style={{
                            borderWidth: 1,
                            borderColor: theme.border,
                            borderRadius: 12,
                            backgroundColor: theme.inputBg,
                          }}
                        >
                          <ScrollView
                            style={{ maxHeight: LIST_BOX_MAX_HEIGHT }}
                            contentContainerStyle={{ padding: 10, gap: 8 }}
                            {...listIndicatorProps}
                          >
                            {editingPlanExercises.map((exercise, index) => {
                              const media = resolveExerciseMedia(exercise.mediaUrl, exercise.mediaType);
                              return (
                                <View
                                  key={exercise.uid}
                                  style={{
                                    borderWidth: 1,
                                    borderColor: theme.border,
                                    borderRadius: 10,
                                    backgroundColor: theme.bg,
                                    padding: 10,
                                    gap: 6,
                                  }}
                                >
                                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                    {media ? (
                                      <TouchableOpacity
                                        onPress={() => openMediaPreview(media, exercise.name)}
                                        activeOpacity={0.85}
                                      >
                                        <ExerciseThumb theme={theme as Record<string, any>} media={media} />
                                      </TouchableOpacity>
                                    ) : null}
                                    <View style={{ flex: 1 }}>
                                      <MvText variant="semi3">
                                        {index + 1}. {exercise.name}
                                      </MvText>
                                      {exercise.category ? (
                                        <MvText variant="body4" color="secondary">
                                          {exercise.category}
                                        </MvText>
                                      ) : null}
                                    </View>
                                    <TouchableOpacity
                                      onPress={() =>
                                        removeDraftExercise(setEditingPlanExercises, exercise.uid)
                                      }
                                    >
                                      <Ionicons name="trash-outline" size={16} color="#f44336" />
                                    </TouchableOpacity>
                                  </View>
                                  <MvInput
                                    placeholder="Séries x Reps (ex: 4x12)"
                                    value={exercise.repetitionsSets}
                                    onChangeText={(value) =>
                                      patchDraftExercise(setEditingPlanExercises, exercise.uid, {
                                        repetitionsSets: value,
                                      })
                                    }
                                  />
                                  <MvInput
                                    placeholder="Carga *"
                                    value={exercise.load}
                                    onChangeText={(value) =>
                                      patchDraftExercise(setEditingPlanExercises, exercise.uid, {
                                        load: value,
                                      })
                                    }
                                  />
                                  <MvInput
                                    placeholder="Tempo de descanso (opcional)"
                                    value={exercise.restLabel}
                                    onChangeText={(value) =>
                                      patchDraftExercise(setEditingPlanExercises, exercise.uid, {
                                        restLabel: value,
                                      })
                                    }
                                  />
                                </View>
                              );
                            })}

                            {editingPlanExercises.length === 0 ? (
                              <MvText variant="body4" color="secondary">
                                Nenhum exercicio neste treino.
                              </MvText>
                            ) : null}
                          </ScrollView>
                        </View>

                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <View style={{ flex: 1 }}>
                            <MvButton
                              label="Salvar alteracoes"
                              loading={savingEditedPlan}
                              disabled={!crefApproved}
                              onPress={() => void saveEditedPlan()}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <MvButton variant="outline" label="Cancelar" onPress={resetInlinePlanEdit} />
                          </View>
                        </View>
                      </View>
                    ) : isExpanded ? (
                      <View
                        style={{
                          borderWidth: 1,
                          borderColor: theme.border,
                          borderRadius: 10,
                          backgroundColor: theme.inputBg,
                        }}
                      >
                        <ScrollView
                          style={{ maxHeight: 280 }}
                          contentContainerStyle={{ padding: 8, gap: 6 }}
                          {...listIndicatorProps}
                        >
                          {plan.exercises.map((exercise, index) => {
                            const media =
                              resolveExerciseMedia(
                                exercise.exercise?.mediaUrl,
                                exercise.exercise?.mediaType
                              ) ??
                              resolveExerciseMedia(
                                exercise.demoVideoUrl,
                                exercise.demoVideoUrl ? "YOUTUBE" : null
                              );
                            return (
                              <View
                                key={exercise.id}
                                style={{
                                  borderWidth: 1,
                                  borderColor: theme.border,
                                  borderRadius: 10,
                                  backgroundColor: theme.bg,
                                  padding: 8,
                                  flexDirection: "row",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                {media ? (
                                  <TouchableOpacity
                                    onPress={() => openMediaPreview(media, exercise.name)}
                                    activeOpacity={0.85}
                                  >
                                    <ExerciseThumb theme={theme as Record<string, any>} media={media} />
                                  </TouchableOpacity>
                                ) : null}
                                <View style={{ flex: 1 }}>
                                  <MvText variant="semi3">
                                    {index + 1}. {exercise.name}
                                  </MvText>
                                  <MvText variant="body4" color="secondary">
                                    Séries x Reps: {exercise.repetitionsSets}
                                  </MvText>
                                  <MvText variant="body4" color="secondary">
                                    Descanso: {exercise.restLabel?.trim() || "-"}
                                  </MvText>
                                </View>
                              </View>
                            );
                          })}
                        </ScrollView>
                      </View>
                    ) : (
                      <MvText variant="body4" color="secondary">
                        Toque no nome do treino para abrir a lista de exercicios.
                      </MvText>
                    )}

                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {!isEditing ? (
                        <View style={{ flex: 1 }}>
                          <MvButton variant="outline" label="Editar" onPress={() => startInlinePlanEdit(plan)} />
                        </View>
                      ) : null}
                      <View style={{ flex: 1 }}>
                        <MvButton
                          variant="outline"
                          label={deletingPlanId === plan.id ? "Excluindo..." : "Excluir"}
                          onPress={() => deletePlan(plan.id)}
                          disabled={deletingPlanId === plan.id}
                        />
                      </View>
                    </View>
                  </View>
                );
              })}

              {!loading && providerPlans.length === 0 ? (
                <MvText variant="body4" color="secondary">
                  Nenhum treino criado ainda.
                </MvText>
              ) : null}
            </ScrollView>
          </View>
        </MvCard>
      </ScrollView>

      <Modal
        visible={Boolean(targetExercise)}
        transparent
        animationType="fade"
        onRequestClose={() => setTargetExercise(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.5)",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <Pressable
            onPress={() => setTargetExercise(null)}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <View
            style={{
              width: "100%",
              maxWidth: 420,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.bg,
              padding: 14,
              gap: 10,
            }}
          >
            <MvText variant="semi2">Adicionar exercicio a um treino</MvText>
            <MvText variant="body4" color="secondary">
              {targetExercise?.name}
            </MvText>

            <View
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 10,
                backgroundColor: theme.inputBg,
              }}
            >
              <ScrollView
                style={{ maxHeight: 280 }}
                contentContainerStyle={{ padding: 8, gap: 8 }}
                {...listIndicatorProps}
              >
                {showNewPlanBuilder ? (
                  <TouchableOpacity
                    onPress={handleAddExerciseToOpenBuilder}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 10,
                      backgroundColor: theme.bg,
                      paddingVertical: 10,
                      paddingHorizontal: 10,
                    }}
                  >
                    <MvText variant="semi3">Treino em criacao</MvText>
                    <MvText variant="body4" color="secondary">
                      {newPlanTitle.trim() || "Sem nome"} - {newPlanExercises.length} exercicio(s)
                    </MvText>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  onPress={handleAddExerciseToNewPlan}
                  style={{
                    borderWidth: 1,
                    borderColor: "rgba(34,197,94,0.35)",
                    borderRadius: 10,
                    backgroundColor: "rgba(34,197,94,0.12)",
                    paddingVertical: 10,
                    paddingHorizontal: 10,
                  }}
                >
                  <MvText variant="semi3" style={{ color: theme.textGreen }}>
                    Criar novo treino com este exercicio
                  </MvText>
                </TouchableOpacity>

                {providerPlans.length ? (
                  <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
                    Treinos existentes
                  </MvText>
                ) : null}

                {providerPlans.map((plan) => (
                  <TouchableOpacity
                    key={plan.id}
                    onPress={() => handleAddExerciseToPlan(plan.id)}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 10,
                      backgroundColor: theme.bg,
                      paddingVertical: 10,
                      paddingHorizontal: 10,
                    }}
                  >
                    <MvText variant="semi3">{plan.title}</MvText>
                    <MvText variant="body4" color="secondary">
                      {plan.exercises.length} exercicio(s)
                    </MvText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <MvButton variant="outline" label="Fechar" onPress={() => setTargetExercise(null)} />
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(mediaPreview)}
        transparent
        animationType="fade"
        onRequestClose={() => setMediaPreview(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <Pressable
            onPress={() => setMediaPreview(null)}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <View
            style={{
              width: "100%",
              maxWidth: 480,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.bg,
              padding: 14,
              gap: 10,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <MvText variant="semi2" style={{ flex: 1 }}>
                {mediaPreview?.title ?? "Midia"}
              </MvText>
              <TouchableOpacity
                onPress={() => setMediaPreview(null)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.chipBg,
                  borderWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <Ionicons name="close" size={16} color={theme.text2} />
              </TouchableOpacity>
            </View>

            {mediaPreview ? (
              <MvMediaViewer
                mediaUrl={mediaPreview.url}
                mediaType={mediaPreview.type}
                height={280}
                borderRadius={10}
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}
