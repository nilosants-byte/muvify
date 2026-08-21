import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import * as Haptics from "expo-haptics";
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
import { MvButton, MvCard, MvDatePicker, MvInput, MvMediaPreviewModal, MvText } from "../../components/mv";
import { handleScreenError } from "../shared/api-helpers";
import { StepProgressBar } from "../../components/professional/UXReformComponents";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { getYouTubeThumbnailFromUrl } from "../../utils/youtube";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "TrainingCreation">;

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

function resolveExerciseMedia(mediaUrl?: string | null, mediaType?: ExerciseMediaType | null): ResolvedMedia | null {
  const normalizedUrl = mediaUrl?.trim();
  if (!normalizedUrl) return null;
  const resolvedType = mediaType ?? inferMediaTypeFromUrl(normalizedUrl);
  if (!resolvedType) return null;
  return { url: normalizedUrl, type: resolvedType };
}

function toDraftExercise(exercise: Exercise): DraftPlanExercise {
  const media = resolveExerciseMedia(exercise.mediaUrl, exercise.mediaType);
  // Exercícios do banco Muvify (prebuilt) usam o padrão fixo da plataforma.
  // Exercícios próprios do profissional usam os defaults salvos, com fallback para o padrão.
  const repetitionsSets = exercise.isPrebuilt
    ? "3x12"
    : (exercise.defaultRepetitionsSets?.trim() || "3x12");
  const restLabel = exercise.isPrebuilt
    ? "60s"
    : (exercise.defaultRestLabel?.trim() || "60s");
  return {
    uid: createUid(exercise.id),
    exerciseId: exercise.id,
    name: exercise.name,
    category: exercise.category,
    repetitionsSets,
    load: "0 kg",
    restLabel,
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
  if (!exercises.length) return "Adicione exercícios ao treino.";
  const hasInvalid = exercises.some(
    (exercise) =>
      !exercise.name.trim() || !exercise.repetitionsSets.trim() || !exercise.load.trim()
  );
  if (hasInvalid) {
    return "Preencha nome, séries x reps e carga de todos os exercícios.";
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

function ExerciseThumb({
  theme,
  media,
}: {
  theme: Record<string, any>;
  media: ResolvedMedia;
}) {
  const thumbnail =
    media.type === "YOUTUBE"
      ? getYouTubeThumbnailFromUrl(media.url)
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

export function ProfessionalTrainingCreationScreen({ navigation, route }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [prebuiltExercises, setPrebuiltExercises] = useState<Exercise[]>([]);
  const [providerPlans, setProviderPlans] = useState<TrainingPlan[]>([]);
  // Frente 5 (segunda camada), Lote 4: navigation.goBack() disparado logo
  // depois de um salvamento bem-sucedido não deve acionar o aviso de
  // "sair sem salvar" — o formulário ainda está preenchido nesse instante
  // (estado só é limpo depois), então sem esse ref o próprio fluxo de
  // sucesso ficaria bloqueado pelo aviso que essa correção introduz.
  const justSavedRef = useRef(false);

  const [selectedCategory, setSelectedCategory] = useState<ExerciseCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [showNewPlanBuilder, setShowNewPlanBuilder] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState("");
  const [newPlanDescription, setNewPlanDescription] = useState("");
  const [newPlanExercises, setNewPlanExercises] = useState<DraftPlanExercise[]>([]);
  const [savingNewPlan, setSavingNewPlan] = useState(false);

  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editingPlanTitle, setEditingPlanTitle] = useState("");
  const [editingPlanDescription, setEditingPlanDescription] = useState("");
  const [editingPlanExercises, setEditingPlanExercises] = useState<DraftPlanExercise[]>([]);
  // Frente 5 (segunda camada), Lote 6: entrando por aqui (lista "Treinos
  // criados") não existia campo de vigência nenhum — só entrando pela tela
  // do aluno (editPlanId, acima) dava pra mudar a data. Unifica as duas
  // capacidades.
  const [editingPlanValidUntil, setEditingPlanValidUntil] = useState<Date | null>(null);
  const [savingEditedPlan, setSavingEditedPlan] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [expandedPlanIds, setExpandedPlanIds] = useState<Record<string, boolean>>({});

  const [targetExercise, setTargetExercise] = useState<Exercise | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewState>(null);
  const [step, setStep] = useState(0);
  const targetContractId = route.params?.contractId;
  const contractValidUntil = route.params?.contractValidUntil ? new Date(route.params.contractValidUntil) : null;
  const [newPlanValidUntil, setNewPlanValidUntil] = useState<Date | null>(contractValidUntil);

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

  const trainingQuery = useAuthQuery(
    queryKeys.exercises.trainingScreen(),
    async (token) => {
      const [prebuilt, plans, credentials] = await Promise.all([
        exerciseApi.listPrebuilt(),
        consultancyApi.providerPlans(token).catch((error) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }),
        providersApi.myCredentials(token).catch(() => null),
      ]);
      const allPlans = (plans as TrainingPlan[] | null) ?? [];
      const filteredPlans = plans
        ? allPlans.filter((plan) => plan.isPrebuilt && !plan.contractId && plan.isActive !== false)
        : null;
      return {
        prebuiltExercises: prebuilt as Exercise[],
        providerPlans: filteredPlans ?? [],
        allProviderPlans: allPlans,
        needsProfileSetup: plans === null,
        crefApproved: (credentials as any)?.crefValidationStatus === "APPROVED",
      };
    },
  );

  const loading = trainingQuery.isLoading;
  const needsProfileSetup = trainingQuery.data?.needsProfileSetup ?? false;
  const crefApproved = trainingQuery.data?.crefApproved ?? false;
  const editPlanId = route.params?.editPlanId;

  useEffect(() => {
    const data = trainingQuery.data;
    if (!data) return;
    setPrebuiltExercises(data.prebuiltExercises);
    setProviderPlans(data.providerPlans);
  }, [trainingQuery.data]);

  // Chegando com "editar este treino" (vindo do perfil do aluno) — pre-carrega
  // o construtor de treino ja preenchido em vez de exigir que o profissional
  // comece do zero.
  const hydratedEditRef = useRef(false);
  useEffect(() => {
    if (!editPlanId || hydratedEditRef.current) return;
    const target = trainingQuery.data?.allProviderPlans.find((plan) => plan.id === editPlanId);
    if (!target) return;
    hydratedEditRef.current = true;
    setNewPlanTitle(target.title);
    setNewPlanDescription(target.description ?? "");
    setNewPlanExercises(target.exercises.map((item, index) => toDraftExerciseFromPlanItem(item, index)));
    setNewPlanValidUntil(target.validUntil ? new Date(target.validUntil) : contractValidUntil);
    setShowNewPlanBuilder(true);
  }, [editPlanId, trainingQuery.data]);

  useEffect(() => {
    if (trainingQuery.error) {
      handleScreenError({
        error: trainingQuery.error,
        showToast,
        fallbackMessage: "Falha ao carregar banco de exercícios.",
        navigation,
      });
    }
  }, [trainingQuery.error, showToast, navigation]);

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

  const displayExercises = filteredPrebuilt;

  const addToNewPlanBuilder = useCallback(
    (exercise: Exercise) => {
      setShowNewPlanBuilder(true);
      setNewPlanExercises((current) => [...current, toDraftExercise(exercise)]);
      showToast(`${exercise.name} adicionado ao treino em criação.`, "success");
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
    setEditingPlanValidUntil(plan.validUntil ? new Date(plan.validUntil) : null);
    setExpandedPlanIds((current) => ({ ...current, [plan.id]: true }));
  }

  // Frente 5 (segunda camada), Lote 9: era possível ter um treino novo em
  // construção (showNewPlanBuilder) e uma edição inline de outro treino
  // abertas ao mesmo tempo, sem nenhum aviso — o profissional podia perder
  // de vista qual das duas estava pendente de salvar. Mesmo aviso que já
  // existe pra trocar entre duas edições inline (handleAddExerciseToPlan).
  function handleStartInlinePlanEdit(plan: TrainingPlan) {
    const hasNewPlanInProgress =
      showNewPlanBuilder && (newPlanTitle.trim().length > 0 || newPlanExercises.length > 0);
    if (hasNewPlanInProgress) {
      Alert.alert(
        "Treino em criação será descartado",
        "Existe um treino novo em construção nesta tela. Editar outro treino agora descarta o que você criou até aqui.",
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Continuar",
            onPress: () => {
              resetNewPlanBuilder();
              startInlinePlanEdit(plan);
            },
          },
        ]
      );
      return;
    }
    startInlinePlanEdit(plan);
  }

  function resetInlinePlanEdit() {
    setEditingPlanId(null);
    setEditingPlanValidUntil(null);
    setEditingPlanTitle("");
    setEditingPlanDescription("");
    setEditingPlanExercises([]);
  }

  function togglePlanExpanded(planId: string) {
    setExpandedPlanIds((current) => ({ ...current, [planId]: !current[planId] }));
  }

  // Frente 5 (segunda camada), Lote 4: sair da tela (botão voltar, gesto,
  // botão físico) descartava um treino em construção ou edição sem
  // nenhuma confirmação — mesmo padrão de risco já corrigido em
  // ProfessionalStudentDetailScreen (avaliação física), agora replicado
  // aqui via beforeRemove + preventDefault (intercepta qualquer forma de
  // sair, não só o botão do cabeçalho).
  const hasUnsavedTrainingWork =
    Boolean(editingPlanId) ||
    (showNewPlanBuilder && (newPlanTitle.trim().length > 0 || newPlanExercises.length > 0));

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (justSavedRef.current || !hasUnsavedTrainingWork) return;
      e.preventDefault();
      Alert.alert(
        "Sair sem salvar?",
        "As alterações no treino ainda não foram salvas e serão perdidas.",
        [
          { text: "Continuar editando", style: "cancel" },
          { text: "Sair sem salvar", style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, hasUnsavedTrainingWork]);

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
        "Trocar treino em edição?",
        "Existe um treino com alterações abertas. Se continuar, a edição atual será substituída.",
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
    showToast(`${targetExercise.name} adicionado ao treino em criação.`, "success");
    setTargetExercise(null);
  }

  async function saveNewPlan() {
    const errorMessage = planValidationError(newPlanTitle, newPlanExercises);
    if (errorMessage) return showToast(errorMessage, "error");

    try {
      setSavingNewPlan(true);
      const exercisesPayload = newPlanExercises.map((exercise, index) => ({
        sortOrder: index,
        exerciseId: exercise.exerciseId,
        name: exercise.name.trim(),
        repetitionsSets: exercise.repetitionsSets.trim(),
        load: exercise.load.trim(),
        restLabel: exercise.restLabel.trim() || undefined,
        demoVideoUrl: exercise.demoVideoUrl?.trim() || undefined,
      }));

      if (editPlanId) {
        await runWithAuth((token) =>
          consultancyApi.updateProviderPlan(token, editPlanId, {
            title: newPlanTitle.trim(),
            description: newPlanDescription.trim() || undefined,
            exercises: exercisesPayload,
            ...(newPlanValidUntil ? { validUntil: newPlanValidUntil.toISOString() } : {}),
          })
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast("Treino atualizado com sucesso.", "success");
        justSavedRef.current = true;
        navigation.goBack();
      } else if (targetContractId) {
        await runWithAuth((token) =>
          consultancyApi.deliverContract(token, targetContractId, {
            title: newPlanTitle.trim(),
            description: newPlanDescription.trim() || undefined,
            exercises: exercisesPayload,
            validUntil: newPlanValidUntil ? newPlanValidUntil.toISOString() : undefined,
          })
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast("Treino entregue ao aluno com sucesso.", "success");
        justSavedRef.current = true;
        navigation.goBack();
      } else {
        await runWithAuth((token) =>
          consultancyApi.createProviderPlan(token, {
            title: newPlanTitle.trim(),
            description: newPlanDescription.trim() || undefined,
            isPrebuilt: true,
            exercises: exercisesPayload,
          })
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await new Promise<void>(resolve => setTimeout(resolve, 200));
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        showToast("Treino criado com sucesso.", "success");
        resetNewPlanBuilder();
        setStep(0);
        void trainingQuery.refetch();
      }
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
          ...(editingPlanValidUntil ? { validUntil: editingPlanValidUntil.toISOString() } : {}),
        })
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await new Promise<void>(resolve => setTimeout(resolve, 200));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      showToast("Treino atualizado com sucesso.", "success");
      resetInlinePlanEdit();
      void trainingQuery.refetch();
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
            void trainingQuery.refetch();
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
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.backBtn,
            borderWidth: 1,
            borderColor: theme.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text1} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 24, letterSpacing: -0.3 }}>
            {editPlanId ? "Editar Treino" : targetContractId ? "Criar Treino" : "Banco de Exercícios"}
          </MvText>
          <MvText variant="body4" color="secondary">
            {editPlanId ? "Alterações ficam visíveis pro aluno" : targetContractId ? "Montagem e entrega de treino" : "Exercícios Muvify e Criar Treinos"}
          </MvText>
        </View>
      </View>

      {/* Indicador de etapas */}
      <StepProgressBar
        steps={["Dados gerais", "Exercícios", "Revisão"]}
        currentStep={step + 1}
      />

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
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Math.max(120, insets.bottom + 80), gap: 12 }}
        showsVerticalScrollIndicator={false}
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
              O acesso as telas permanece normal. Para salvar exercícios e treinos, finalize seu
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

        {step === 0 ? (
          <>
            <MvCard>
              <MvInput
                placeholder="Nome do Treino *"
                value={newPlanTitle}
                onChangeText={setNewPlanTitle}
                maxLength={100}
              />
              <MvInput
                placeholder="Descrição (opcional)"
                value={newPlanDescription}
                onChangeText={setNewPlanDescription}
                multiline
                numberOfLines={2}
                style={{ marginTop: 8 }}
              />
              {/* Chips de objetivo — adicionam texto ao nome do treino */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, marginTop: 10, paddingBottom: 2 }}
              >
                {["Hipertrofia", "Emagrecimento", "Força", "Resistência", "Mobilidade", "Condicionamento"].map((obj) => (
                  <TouchableOpacity
                    key={obj}
                    onPress={() => setNewPlanTitle((t) => t ? `${t} — ${obj}` : obj)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                      borderWidth: 1, borderColor: "rgba(34,197,94,0.30)",
                      backgroundColor: theme.primarySubtle,
                    }}
                  >
                    <MvText variant="semi3" style={{ color: theme.textGreen, fontSize: 12 }}>{obj}</MvText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {editPlanId || targetContractId ? (
                <View style={{ marginTop: 8, padding: 8, borderRadius: 10, backgroundColor: "rgba(33,150,243,0.08)", borderWidth: 1, borderColor: "rgba(33,150,243,0.25)" }}>
                  <MvText variant="body4" style={{ color: "#2196F3" }}>
                    {editPlanId
                      ? "O aluno será avisado que este treino foi atualizado."
                      : "Este treino será entregue para a consultoria contratada."}
                  </MvText>
                </View>
              ) : null}

              {editPlanId || targetContractId ? (
                <View style={{ marginTop: 10 }}>
                  <MvText variant="body4" color="secondary" style={{ marginBottom: 6 }}>
                    Vigência do treino
                  </MvText>
                  <MvDatePicker
                    value={newPlanValidUntil ?? contractValidUntil ?? new Date()}
                    onChange={setNewPlanValidUntil}
                  />
                  {contractValidUntil ? (
                    <MvText variant="caption" color="secondary" style={{ marginTop: 4 }}>
                      Não pode passar de {contractValidUntil.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" })}, quando a consultoria contratada vence.
                    </MvText>
                  ) : null}
                </View>
              ) : null}
            </MvCard>

            {providerPlans.length > 0 ? (
              <MvCard>
                <MvText variant="semi2" style={{ marginBottom: 4 }}>Usar como base</MvText>
                <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
                  Copie os exercícios de um treino existente como ponto de partida.
                </MvText>
                <View style={{ gap: 8 }}>
                  {providerPlans.map((plan) => (
                    <TouchableOpacity
                      key={plan.id}
                      onPress={() => {
                        const loaded = plan.exercises.map((item, idx) => toDraftExerciseFromPlanItem(item, idx));
                        setNewPlanExercises(loaded);
                        showToast(`${loaded.length} exercícios de "${plan.title}" carregados.`, "success");
                      }}
                      style={{
                        borderWidth: 1,
                        borderColor: theme.border,
                        borderRadius: 10,
                        backgroundColor: theme.bg,
                        padding: 10,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <MvText variant="semi3">{plan.title}</MvText>
                        <MvText variant="body4" color="secondary">{plan.exercises.length} exercícios</MvText>
                      </View>
                      <Ionicons name="copy-outline" size={18} color={theme.textGreen} />
                    </TouchableOpacity>
                  ))}
                </View>
              </MvCard>
            ) : null}
          </>
        ) : null}

        {step === 1 ? (
          <>
            {newPlanExercises.length > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
                <Ionicons name="checkmark-circle" size={16} color={theme.textGreen} />
                <MvText variant="body4" style={{ color: theme.textGreen }}>
                  {newPlanExercises.length} exercícios selecionado(s)
                </MvText>
              </View>
            ) : null}

        <MvCard>
          <View style={{ marginBottom: 10 }}>
            <MvText variant="semi3">Exercícios Muvify</MvText>
            <MvText variant="badge" color="secondary">
              {filteredPrebuilt.length} exercícios
            </MvText>
          </View>

          <MvInput
            placeholder="Buscar exercícios..."
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
                      backgroundColor: active ? theme.primarySubtle : theme.chipBg,
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

        </MvCard>

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 8 }}>
            Lista de exercícios
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
              contentContainerStyle={{ padding: 10 }}
              {...listIndicatorProps}
            >
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                {displayExercises.map((exercise) => {
                  const media = resolveExerciseMedia(exercise.mediaUrl, exercise.mediaType);
                  return (
                    <TouchableOpacity
                      key={exercise.id}
                      activeOpacity={0.8}
                      onPress={() => addToNewPlanBuilder(exercise)}
                      style={{
                        width: "22%",
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: theme.border,
                        backgroundColor: theme.bg,
                        padding: 8,
                        alignItems: "center",
                        gap: 5,
                        minHeight: 108,
                        justifyContent: "flex-start",
                      }}
                    >
                      {/* Thumbnail — toque direto faz preview de mídia */}
                      {media ? (
                        <TouchableOpacity onPress={() => openMediaPreview(media, exercise.name)} activeOpacity={0.85}>
                          <ExerciseThumb theme={theme as Record<string, any>} media={media} />
                        </TouchableOpacity>
                      ) : (
                        <View style={{ width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.chipBg, borderWidth: 1, borderColor: theme.border }}>
                          <Ionicons name="barbell-outline" size={20} color={theme.text3} />
                        </View>
                      )}
                      <MvText
                        numberOfLines={2}
                        style={{ fontFamily: "DMSans_400Regular", fontSize: 10, textAlign: "center", color: theme.text1, lineHeight: 13 }}
                      >
                        {exercise.name}
                      </MvText>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="add-circle" size={14} color={theme.textGreen} />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {!loading && displayExercises.length === 0 ? (
                <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
                  Nenhum exercício encontrado.
                </MvText>
              ) : null}
            </ScrollView>
          </View>
        </MvCard>
          </>
        ) : null}

        {step === 2 ? (
          <MvCard>
            <MvText variant="semi2" style={{ marginBottom: 8 }}>Revisão</MvText>
            <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
              {newPlanTitle.trim() || "(sem título)"} · {newPlanExercises.length} exercícios
            </MvText>
            <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 12, backgroundColor: theme.inputBg }}>
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
                      style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, backgroundColor: theme.bg, padding: 10, gap: 6 }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        {media ? (
                          <TouchableOpacity onPress={() => openMediaPreview(media, exercise.name)} activeOpacity={0.85}>
                            <ExerciseThumb theme={theme as Record<string, any>} media={media} />
                          </TouchableOpacity>
                        ) : null}
                        <View style={{ flex: 1 }}>
                          <MvText variant="semi3">{index + 1}. {exercise.name}</MvText>
                          {exercise.category ? (
                            <MvText variant="body4" color="secondary">{exercise.category}</MvText>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          onPress={() => removeDraftExercise(setNewPlanExercises, exercise.uid)}
                          accessibilityRole="button"
                          accessibilityLabel={`Excluir exercício ${exercise.name}`}
                        >
                          <Ionicons name="trash-outline" size={16} color={theme.danger} />
                        </TouchableOpacity>
                      </View>
                      <MvInput
                        placeholder="Séries x Reps (ex: 4x12)"
                        value={exercise.repetitionsSets}
                        onChangeText={(v) => patchDraftExercise(setNewPlanExercises, exercise.uid, { repetitionsSets: v })}
                      />
                      <MvInput
                        placeholder="Carga *"
                        value={exercise.load}
                        onChangeText={(v) => patchDraftExercise(setNewPlanExercises, exercise.uid, { load: v })}
                      />
                      <MvInput
                        placeholder="Tempo de descanso (opcional)"
                        value={exercise.restLabel}
                        onChangeText={(v) => patchDraftExercise(setNewPlanExercises, exercise.uid, { restLabel: v })}
                      />
                    </View>
                  );
                })}
                {newPlanExercises.length === 0 ? (
                  <MvText variant="body4" color="secondary">
                    Nenhum exercício. Volte à etapa anterior para adicionar.
                  </MvText>
                ) : null}
              </ScrollView>
            </View>
          </MvCard>
        ) : null}

        {step === 0 ? (
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
                            {plan.exercises.length} exercícios
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
                          onPress={() => handleStartInlinePlanEdit(plan)}
                          accessibilityRole="button"
                          accessibilityLabel={`Editar treino ${plan.title}`}
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 17,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: theme.primarySubtle,
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
                                      accessibilityRole="button"
                                      accessibilityLabel={`Excluir exercício ${exercise.name}`}
                                    >
                                      <Ionicons name="trash-outline" size={16} color={theme.danger} />
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
                                Nenhum exercício neste treino.
                              </MvText>
                            ) : null}
                          </ScrollView>
                        </View>

                        {plan.contractId ? (
                          <View>
                            <MvText variant="body4" color="secondary" style={{ marginBottom: 6 }}>
                              Vigência do treino
                            </MvText>
                            <MvDatePicker
                              value={editingPlanValidUntil ?? new Date()}
                              onChange={setEditingPlanValidUntil}
                            />
                          </View>
                        ) : null}

                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <View style={{ flex: 1 }}>
                            <MvButton
                              label="Salvar alterações"
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
                        Toque no nome do treino para abrir a lista de exercícios.
                      </MvText>
                    )}

                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {!isEditing ? (
                        <View style={{ flex: 1 }}>
                          <MvButton variant="outline" label="Editar" onPress={() => handleStartInlinePlanEdit(plan)} />
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
        ) : null}
      </ScrollView>

      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          paddingBottom: Math.max(16, insets.bottom),
          paddingHorizontal: 16,
          paddingTop: 10,
          backgroundColor: theme.bg,
          borderTopWidth: 1,
          borderTopColor: theme.border,
          flexDirection: "row",
          gap: 10,
        }}
      >
        {step > 0 ? (
          <View style={{ flex: 1 }}>
            <MvButton variant="outline" label="← Voltar" onPress={() => setStep((s) => s - 1)} />
          </View>
        ) : null}
        {step < 2 ? (
          <View style={{ flex: 1 }}>
            <MvButton
              label="Próximo →"
              disabled={step === 0 ? !newPlanTitle.trim() : newPlanExercises.length === 0}
              onPress={() => setStep((s) => s + 1)}
            />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <MvButton
              label={editPlanId ? "Salvar alterações" : targetContractId ? "Entregar treino" : "Salvar treino"}
              loading={savingNewPlan}
              disabled={!crefApproved}
              onPress={() => void saveNewPlan()}
            />
          </View>
        )}
      </View>

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
            <MvText variant="semi2">Adicionar exercício a um treino</MvText>
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
                    <MvText variant="semi3">Treino em criação</MvText>
                    <MvText variant="body4" color="secondary">
                      {newPlanTitle.trim() || "Sem nome"} - {newPlanExercises.length} exercícios
                    </MvText>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  onPress={handleAddExerciseToNewPlan}
                  style={{
                    borderWidth: 1,
                    borderColor: "rgba(34,197,94,0.35)",
                    borderRadius: 10,
                    backgroundColor: theme.primarySubtle,
                    paddingVertical: 10,
                    paddingHorizontal: 10,
                  }}
                >
                  <MvText variant="semi3" style={{ color: theme.textGreen }}>
                    Criar novo treino com este exercício
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
                      {plan.exercises.length} exercícios
                    </MvText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <MvButton variant="outline" label="Fechar" onPress={() => setTargetExercise(null)} />
          </View>
        </View>
      </Modal>

      <MvMediaPreviewModal
        visible={Boolean(mediaPreview)}
        onClose={() => setMediaPreview(null)}
        mediaUrl={mediaPreview?.url}
        mediaType={mediaPreview?.type}
        title={mediaPreview?.title}
        orientation="vertical"
      />
    </View>
  );
}
