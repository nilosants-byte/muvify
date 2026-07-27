import React, { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientTabParamList } from "../../navigation/route-types";
import {
  communityApi,
  consultancyApi,
  ConsultancyContract,
  ConsultancyPaymentMethod,
  ConsultancyRequest,
  MyTrainingResponse,
  TrainingPlan,
  TrainingPlanExercise,
  uploadsApi,
} from "../../services/api/client";
import { useAppState, ToastType } from "../../state/AppState";
import { hapticWorkoutStart, hapticWorkoutFinish, hapticCta } from "../../utils/haptics";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { MvMediaPreviewButton, MvMediaViewer } from "../../components/mv";
import { formatDateLabel, formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { useMvTheme } from "../../theme/MvThemeContext";
import type { MvTheme } from "../../theme/MvColors";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { ClientBottomNavV2 } from "../../components/navigation/ClientBottomNavV2";

type Props = BottomTabScreenProps<ClientTabParamList, "MyTraining">;
type TrainingTab = "active" | "pending" | "history";

// ── Helpers ────────────────────────────────────────────────────────────────────
function parseRestSeconds(input?: string | null): number | null {
  if (!input) return null;
  const n = input.trim().toLowerCase();
  const mmss = n.match(/^(\d{1,2}):(\d{1,2})$/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const min = n.match(/(\d+)\s*(min|m)\b/);
  if (min) return Number(min[1]) * 60;
  const num = n.match(/(\d+)/);
  return num ? Number(num[1]) : null;
}

function fmtTimer(total: number) {
  const s = Math.max(0, total);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function contractStatusStyle(status: string, theme: MvTheme) {
  const isDark = theme.mode === "dark";
  if (status === "ACTIVE") return { label: "Ativo", color: theme.primary, bg: theme.primarySubtle, border: theme.primarySubtleBorder };
  if (status === "PENDING_PAYMENT") return { label: "Pagamento pendente", color: C.amber, bg: C.amberDim, border: C.amberBorder };
  if (status === "DELIVERED") return { label: "Entregue", color: theme.text2, bg: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border: theme.border };
  return { label: "Arquivado", color: theme.text3, bg: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", border: theme.border };
}

// O que decide se um treino pode ser aberto/executado e a vigencia DELE mesmo, nao
// o status do contrato (um contrato "Entregue" pode continuar tendo treinos vigentes).
function planValidityStyle(isVigente: boolean, theme: MvTheme) {
  const isDark = theme.mode === "dark";
  if (isVigente) return { label: "Vigente", color: theme.primary, bg: theme.primarySubtle, border: theme.primarySubtleBorder };
  return { label: "Vencido", color: theme.text3, bg: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", border: theme.border };
}

// ── Flat plan list helper ──────────────────────────────────────────────────────
type FlatPlan = TrainingPlan & {
  contractStatus: string;
  providerName: string;
  contractId: string;
  contractDeliveredAt: string | null;
};

function flatPlans(contracts: ConsultancyContract[]): FlatPlan[] {
  return contracts.flatMap((c) =>
    (c.trainingPlans ?? []).map((p) => ({
      ...p,
      contractStatus: c.status,
      providerName: c.provider?.displayName ?? "Personal",
      contractId: c.id,
      contractDeliveredAt: c.deliveredAt ?? null,
    }))
  );
}

const DELIVERY_CONTEST_WINDOW_MS = 48 * 60 * 60 * 1000;
function canContestDelivery(plan: FlatPlan) {
  if (plan.contractStatus !== "DELIVERED" || !plan.contractDeliveredAt) return false;
  return Date.now() - new Date(plan.contractDeliveredAt).getTime() <= DELIVERY_CONTEST_WINDOW_MS;
}

// Consultoria em andamento (ja com pelo menos uma ficha entregue) pode ser
// encerrada pelo aluno a qualquer momento - cada ficha ja recebida ja foi
// cobrada de forma justa na hora da entrega, entao nao ha reembolso
// envolvido, so para de valer (ver cancelContract no backend).
function canEndOngoingConsultancy(plan: FlatPlan) {
  return plan.contractStatus === "DELIVERED" && Boolean(plan.isVigente);
}

// ── WorkoutDetailModal ────────────────────────────────────────────────────────
function WorkoutDetailModal({
  plan,
  onClose,
  showToast,
  runWithAuth,
  onCompleted,
}: {
  plan: FlatPlan;
  onClose: () => void;
  showToast: (msg: string, type?: ToastType) => void;
  runWithAuth: <T>(fn: (token: string) => Promise<T>) => Promise<T>;
  onCompleted: () => void;
}) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [finished, setFinished] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimestampRef = useRef<number | null>(null);

  // ── Opt-in de foto pro feed de evolução (não obrigatório) ─────────────────
  const [sharePhotoStage, setSharePhotoStage] = useState<"idle" | "capturing" | "uploading" | "done">("idle");

  // Chave de persistência do timer — específica por plano (guard contra id undefined)
  const TIMER_KEY = plan?.id ? `@muvify/workoutTimer_${plan.id}` : null;

  // Ao montar: verifica se há um timer em andamento salvo (app foi fechado/bloqueado)
  useEffect(() => {
    if (!TIMER_KEY) return;
    AsyncStorage.getItem(TIMER_KEY).then((saved) => {
      if (!saved) return;
      try {
        const { startedAt } = JSON.parse(saved) as { startedAt: number };
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        startTimestampRef.current = startedAt;
        setSeconds(elapsed);
        setStarted(true);
      } catch { /* dado corrompido — ignora */ }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rest timer
  const [restVisible, setRestVisible] = useState(false);
  const [restLabel, setRestLabel] = useState("");
  const [restInitial, setRestInitial] = useState(0);
  const [restRemaining, setRestRemaining] = useState(0);
  const [restBlink, setRestBlink] = useState(true);

  // Media viewer
  const [expandedMediaId, setExpandedMediaId] = useState<string | null>(null);

  // Main timer — sincroniza com timestamp real para não acumular drift
  useEffect(() => {
    if (started && !finished) {
      timerRef.current = setInterval(() => {
        if (startTimestampRef.current !== null) {
          setSeconds(Math.floor((Date.now() - startTimestampRef.current) / 1000));
        } else {
          setSeconds((s) => s + 1);
        }
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [started, finished]);

  // Rest timer countdown
  useEffect(() => {
    if (!restVisible) return;
    if (restRemaining > 0) {
      const t = setInterval(() => setRestRemaining((r) => Math.max(0, r - 1)), 1000);
      return () => clearInterval(t);
    }
    const t = setInterval(() => setRestBlink((b) => !b), 450);
    return () => clearInterval(t);
  }, [restVisible, restRemaining]);

  function openRest(exerciseName: string, secs: number) {
    setRestLabel(exerciseName);
    setRestInitial(secs);
    setRestRemaining(secs);
    setRestBlink(true);
    setRestVisible(true);
  }

  function toggleDone(id: string) {
    if (!started) return;
    setDone((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleFinish() {
    try {
      setCompleting(true);
      await runWithAuth((token) => consultancyApi.completeTrainingPlan(token, plan.id));
      hapticWorkoutFinish(); // Momento 5 — treino finalizado
      setShowFinishConfirm(false);
      setFinished(true);
      if (timerRef.current) clearInterval(timerRef.current);
      // Limpa o timer persistido — treino encerrado manualmente
      if (TIMER_KEY) AsyncStorage.removeItem(TIMER_KEY).catch(() => {});
      showToast("Treino concluído! +50 pts", "success");
      onCompleted();
    } catch (error) {
      setShowFinishConfirm(false);
      showToast(
        error instanceof Error ? error.message : "Não foi possível registrar a conclusão do treino.",
        "error"
      );
    } finally {
      setCompleting(false);
    }
  }

  // Abre a câmera do celular na hora (frontal por padrão, mas o próprio app
  // de câmera nativo permite trocar) — nunca da galeria, pra garantir que a
  // foto é do momento, igual ao opt-in do presencial.
  async function captureAndSharePhoto() {
    try {
      setSharePhotoStage("capturing");
      if (Platform.OS !== "web") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (permission.status !== "granted") {
          showToast("Permissão de câmera negada.", "error");
          setSharePhotoStage("idle");
          return;
        }
      }
      const result =
        Platform.OS === "web"
          ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"] as ImagePicker.MediaType[], quality: 0.5, base64: true })
          : await ImagePicker.launchCameraAsync({ cameraType: "front" as ImagePicker.CameraType, allowsEditing: false, quality: 0.5, base64: true });

      if (result.canceled) {
        setSharePhotoStage("idle");
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.base64) {
        showToast("Falha ao capturar a foto.", "error");
        setSharePhotoStage("idle");
        return;
      }

      setSharePhotoStage("uploading");
      const { url } = await runWithAuth((token) =>
        uploadsApi.uploadMedia(
          token,
          { uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg", fileName: "feed-photo.jpg" },
          "feed-photos"
        )
      );
      await runWithAuth((token) => communityApi.createPost(token, { imageUrl: url, caption: "Treino concluído! 💪" }));
      setSharePhotoStage("done");
      showToast("Foto publicada no feed de evolução!", "success");
    } catch {
      showToast("Não foi possível publicar a foto. Tente novamente.", "error");
      setSharePhotoStage("idle");
    }
  }

  const exercises = plan.exercises ?? [];

  // ── Tela pós-treino ─────────────────────────────────────────────────────────
  if (finished) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} />
        <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <TouchableOpacity onPress={onClose} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="close" size={18} color={theme.text1} />
          </TouchableOpacity>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3, marginLeft: 10 }}>Tá pago!</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 40, paddingTop: 20, gap: 16, alignItems: "center" }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 34, color: theme.text1, letterSpacing: -0.02 * 34, textAlign: "center" }}>Tá pago!</Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center" }}>
            Tempo: {fmtTimer(seconds)} · {done.size}/{exercises.length} exercícios marcados
          </Text>
          {/* Badges de conquista */}
          <View style={{ flexDirection: "row", gap: 12, justifyContent: "center" }}>
            {[
              { icon: "flash" as const, label: "+50 pts", color: theme.primary },
              { icon: "flame" as const, label: "Sequência", color: "#f97316" },
            ].map((b) => (
              <View key={b.label} style={{ alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 18, padding: 14 }}>
                <Ionicons name={b.icon} size={24} color={b.color} />
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text1 }}>{b.label}</Text>
              </View>
            ))}
          </View>

          {/* Opt-in de foto pro feed de evolução — não obrigatório */}
          {sharePhotoStage === "idle" ? (
            <View style={{ width: "100%", gap: 10, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1, textAlign: "center" }}>
                Quer postar uma foto desse treino no feed de evolução?
              </Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, textAlign: "center" }}>
                Não é obrigatório — só pra mostrar pros seus amigos que você treinou.
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setSharePhotoStage("done")}
                  style={{ flex: 1, height: 44, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>Agora não</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void captureAndSharePhoto()}
                  style={{ flex: 1, height: 44, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>Tirar foto</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : sharePhotoStage === "capturing" || sharePhotoStage === "uploading" ? (
            <View style={{ alignItems: "center", gap: 8 }}>
              <ActivityIndicator color={theme.primary} />
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>
                {sharePhotoStage === "capturing" ? "Abrindo câmera..." : "Publicando foto..."}
              </Text>
            </View>
          ) : null}

          {/* CTA */}
          <TouchableOpacity
            onPress={onClose}
            style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", width: "100%", marginTop: 8, shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>Voltar para Treinos</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} />

      {/* Header */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity onPress={onClose} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.02 * 22 }} numberOfLines={1}>{plan.title}</Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>{plan.providerName} · treino personalizado</Text>
        </View>
        {started && (
          <View style={{ backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 14, color: theme.primary, letterSpacing: -0.013 * 14 }}>{fmtTimer(seconds)}</Text>
          </View>
        )}
      </View>

      {/* Timer banner (quando em andamento) */}
      {started && (
        <View style={{ marginHorizontal: S.px, marginTop: 12, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, borderRadius: 16, padding: "10px 16px" as any, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.primary }}>Treino em andamento</Text>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.primary, letterSpacing: -0.013 * 20 }}>{fmtTimer(seconds)}</Text>
        </View>
      )}

      {/* Lista de exercícios */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 120, paddingTop: 14, gap: 10 }} showsVerticalScrollIndicator={false}>
        {exercises.map((ex) => {
          const isDone = done.has(ex.id);
          const restSecs = ex.restSeconds ?? parseRestSeconds(ex.restLabel);
          const restDisplay = restSecs
            ? restSecs >= 60 ? `${Math.floor(restSecs / 60)}min${restSecs % 60 ? ` ${restSecs % 60}s` : ""}` : `${restSecs}s`
            : ex.restLabel ?? null;
          const mediaUrl = ex.exercise?.mediaUrl ?? ex.demoVideoUrl ?? null;
          const mediaType = ex.exercise?.mediaType ?? (ex.demoVideoUrl ? "YOUTUBE" : null);
          const hasMedia = Boolean(mediaUrl && mediaType);
          const isExpanded = expandedMediaId === ex.id;

          return (
            <View key={ex.id} style={{
              borderRadius: S.cardR, borderWidth: 1,
              borderColor: isDone ? theme.primarySubtleBorder : theme.border,
              backgroundColor: isDone ? theme.primarySubtle : theme.cardBg,
              overflow: "hidden",
            }}>
              <View style={{ flexDirection: "row", gap: 12, padding: 14 }}>
                {/* Check button — mínimo 44×44px */}
                <TouchableOpacity
                  onPress={() => toggleDone(ex.id)}
                  disabled={!started}
                  style={{
                    width: 44, height: 44, flexShrink: 0, borderRadius: 16,
                    borderWidth: 1,
                    borderColor: isDone ? theme.primary : theme.border,
                    backgroundColor: isDone ? theme.primary : "rgba(255,255,255,0.04)",
                    alignItems: "center", justifyContent: "center",
                    opacity: started ? 1 : 0.5,
                  }}
                >
                  {isDone
                    ? <Ionicons name="checkmark" size={18} color={theme.textOnPrimary} />
                    : <Ionicons name="barbell-outline" size={18} color={theme.text3} />
                  }
                </TouchableOpacity>

                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }} numberOfLines={2}>{ex.name}</Text>
                  {ex.exercise?.category && (
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginTop: 2 }}>{ex.exercise.category}</Text>
                  )}

                  {/* Stats grid 4 colunas */}
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                    {[
                      { label: "séries/reps", value: ex.repetitionsSets },
                      { label: "carga", value: ex.load || "—" },
                      ...(restDisplay ? [{ label: "descanso", value: restDisplay, tappable: (restSecs ?? 0) > 0 }] : []),
                    ].map((stat, i) => (
                      <TouchableOpacity
                        key={i}
                        disabled={!stat.tappable}
                        onPress={stat.tappable ? () => openRest(ex.name, restSecs!) : undefined}
                        style={{
                          backgroundColor: stat.tappable ? theme.primarySubtle : "rgba(0,0,0,0.24)",
                          borderRadius: 12, padding: "8px 6px" as any, paddingHorizontal: 8, paddingVertical: 6,
                          alignItems: "center", minWidth: 56,
                          borderWidth: 1, borderColor: stat.tappable ? theme.primarySubtleBorder : "transparent",
                        }}
                      >
                        <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 9, color: theme.labelColor, textTransform: "uppercase", letterSpacing: 0.5 }}>{stat.label}</Text>
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: stat.tappable ? theme.primary : theme.text1, marginTop: 3 }}>{stat.value}</Text>
                      </TouchableOpacity>
                    ))}
                    {hasMedia && (
                      <MvMediaPreviewButton
                        mediaUrl={mediaUrl!}
                        mediaType={mediaType!}
                        expanded={isExpanded}
                        onToggle={() => setExpandedMediaId(isExpanded ? null : ex.id)}
                      />
                    )}
                  </View>
                </View>
              </View>

              {ex.exercise?.description && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>{ex.exercise.description}</Text>
                </View>
              )}

              {hasMedia && isExpanded && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                  <MvMediaViewer mediaUrl={mediaUrl!} mediaType={mediaType!} height={200} borderRadius={10} />
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Botões fixos com safe area — Finalizar (esq, secundário) + Iniciar (dir, primário) */}
      <View style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        paddingHorizontal: S.px, paddingBottom: Math.max(12, insets.bottom + 12), paddingTop: 12,
        backgroundColor: `${theme.bg}f0`, borderTopWidth: 1, borderTopColor: theme.border,
        flexDirection: "row", gap: 10,
      }}>
        <TouchableOpacity
          onPress={() => setShowFinishConfirm(true)}
          style={{ flex: 1, height: S.btnH, borderRadius: S.btnR, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>Finalizar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            if (!started) {
              hapticWorkoutStart(); // Momento 4 — treino iniciado
              const now = Date.now();
              startTimestampRef.current = now;
              // Persiste o timestamp de início — sobrevive a fechamento/bloqueio do app
              if (TIMER_KEY) AsyncStorage.setItem(TIMER_KEY, JSON.stringify({ startedAt: now })).catch(() => {});
            }
            setStarted(true);
          }}
          style={{ flex: 1.4, height: S.btnH, borderRadius: S.btnR, backgroundColor: started ? theme.primarySubtle : theme.primary, borderWidth: 1, borderColor: started ? theme.primarySubtleBorder : "transparent", alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: started ? 0 : 0.28, shadowRadius: 10, elevation: started ? 0 : 4 }}
        >
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: started ? theme.primary : theme.textOnPrimary }}>
            {started ? "Em andamento" : "Iniciar treino"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Modal de confirmação de finalização */}
      <Modal animationType="slide" transparent visible={showFinishConfirm} onRequestClose={() => setShowFinishConfirm(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowFinishConfirm(false)} />
          <View style={{ backgroundColor: theme.inputBg, borderRadius: "24px 24px 0 0" as any, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.border }}>
            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.02 * 22 }}>Finalizar treino?</Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginTop: 8 }}>
              Você marcou {done.size} de {exercises.length} exercícios. Tem certeza?
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
              <TouchableOpacity
                disabled={completing}
                onPress={() => setShowFinishConfirm(false)}
                style={{ flex: 1, height: S.btnH, borderRadius: S.btnR, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", opacity: completing ? 0.6 : 1 }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>Continuar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={completing}
                onPress={() => void handleFinish()}
                style={{ flex: 1, height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4, opacity: completing ? 0.7 : 1 }}
              >
                {completing ? (
                  <ActivityIndicator color={theme.textOnPrimary} />
                ) : (
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>Finalizar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal de descanso */}
      <Modal animationType="fade" transparent visible={restVisible} onRequestClose={() => setRestVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 }} onPress={() => setRestVisible(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: "90%", maxWidth: 340, borderRadius: 24, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, padding: 24, gap: 10, alignItems: "center" }}>
            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.02 * 22 }}>Descanso</Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>{restLabel}</Text>
            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 48, lineHeight: 56, color: restRemaining === 0 ? (restBlink ? theme.danger : theme.text3) : theme.primary, letterSpacing: -0.02 * 48 }}>
              {fmtTimer(restRemaining)}
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, textAlign: "center" }}>
              {restRemaining === 0 ? "Tempo finalizado!" : `Tempo inicial: ${fmtTimer(restInitial)}`}
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.labelColor }}>Toque fora para fechar</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── MyTrainingScreen principal ────────────────────────────────────────────────
export function MyTrainingScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [decidingRequestId, setDecidingRequestId] = useState<string | null>(null);
  const [cancellingContractId, setCancellingContractId] = useState<string | null>(null);
  const [contestingContractId, setContestingContractId] = useState<string | null>(null);
  const [paymentByRequestId, setPaymentByRequestId] = useState<Record<string, ConsultancyPaymentMethod>>({});
  const [installmentsByRequestId, setInstallmentsByRequestId] = useState<Record<string, number>>({});
  const [consentByRequestId, setConsentByRequestId] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<TrainingTab>("active");
  const [selectedPlan, setSelectedPlan] = useState<FlatPlan | null>(null);

  const trainingQuery = useAuthQuery(
    queryKeys.consultancy.myTraining(),
    async (token) => {
      const [trainingResult, requestsResult] = await Promise.all([
        consultancyApi.myTraining(token),
        consultancyApi.myRequests(token),
      ]);
      return { training: trainingResult, requests: requestsResult };
    }
  );

  const loading = trainingQuery.isLoading;
  const data: MyTrainingResponse | null = trainingQuery.data?.training ?? null;
  const requests: ConsultancyRequest[] = trainingQuery.data?.requests ?? [];

  useEffect(() => {
    if (trainingQuery.error) {
      handleScreenError({ error: trainingQuery.error, showToast, fallbackMessage: "Falha ao carregar treinos.", navigation });
    }
  }, [trainingQuery.error, showToast, navigation]);

  useEffect(() => {
    const requestsResult = trainingQuery.data?.requests;
    if (!requestsResult) return;
    setPaymentByRequestId((current) => {
      const next = { ...current };
      requestsResult.forEach((r) => { if (!next[r.id]) next[r.id] = "CREDIT_CARD"; });
      return next;
    });
  }, [trainingQuery.data]);

  const contracts = data?.contracts ?? [];
  const respondedRequests = useMemo(() => requests.filter((r) => r.status === "RESPONDED"), [requests]);
  const waitingDelivery = data?.waitingDelivery ?? [];

  // Planos por tab — separados pela vigencia de CADA treino, nao pelo status do
  // contrato (um contrato "Entregue" continua podendo ter treinos vigentes e
  // vencidos ao mesmo tempo, ja que agora um contrato pode receber varios treinos).
  const allPlans = useMemo(() => flatPlans(contracts), [contracts]);
  const activePlans = useMemo(() => allPlans.filter((p) => p.isVigente), [allPlans]);
  const pendingPlans = useMemo(() => flatPlans(contracts.filter((c) => c.status === "PENDING_PAYMENT")), [contracts]);
  const historyPlans = useMemo(() => allPlans.filter((p) => !p.isVigente), [allPlans]);

  const tabs: Array<{ key: TrainingTab; label: string; count: number }> = useMemo(() => [
    { key: "active", label: "Ativos", count: activePlans.length },
    { key: "pending", label: "Pendentes", count: pendingPlans.length + respondedRequests.length + waitingDelivery.length },
    { key: "history", label: "Histórico", count: historyPlans.length },
  ], [activePlans.length, historyPlans.length, pendingPlans.length, respondedRequests.length, waitingDelivery.length]);

  async function decideRequest(requestId: string, decision: "ACCEPT" | "REFUSE", pm?: ConsultancyPaymentMethod, installments?: number) {
    try {
      setDecidingRequestId(requestId);
      await runWithAuth((token) =>
        consultancyApi.decideRequest(token, requestId, {
          decision,
          paymentMethod: pm,
          ...(decision === "ACCEPT" && pm === "CREDIT_CARD" && installments && installments > 1 ? { installments } : {}),
          ...(decision === "ACCEPT" ? { acknowledgedImmediateExecution: true } : {})
        })
      );
      showToast(decision === "ACCEPT" ? "Proposta aceita com sucesso." : "Proposta recusada.", "success");
      await trainingQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao registrar decisão.", navigation });
    } finally { setDecidingRequestId(null); }
  }

  function handleCancelContract(contractId: string) {
    Alert.alert(
      "Cancelar consultoria",
      "Como a ficha ainda não foi entregue, você pode desistir agora e receber o valor de volta integralmente. Deseja cancelar?",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Cancelar consultoria",
          style: "destructive",
          onPress: async () => {
            try {
              setCancellingContractId(contractId);
              await runWithAuth((token) => consultancyApi.cancelContract(token, contractId));
              showToast("Consultoria cancelada e valor estornado.", "success");
              await trainingQuery.refetch();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Não foi possível cancelar.", navigation });
            } finally {
              setCancellingContractId(null);
            }
          },
        },
      ]
    );
  }

  function handleEndOngoingConsultancy(contractId: string) {
    Alert.alert(
      "Encerrar consultoria",
      "Isso encerra sua consultoria com este profissional. As fichas já recebidas continuam disponíveis, mas nenhuma ficha nova será entregue ou cobrada. Deseja encerrar?",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Encerrar consultoria",
          style: "destructive",
          onPress: async () => {
            try {
              setCancellingContractId(contractId);
              await runWithAuth((token) => consultancyApi.cancelContract(token, contractId));
              showToast("Consultoria encerrada.", "success");
              await trainingQuery.refetch();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Não foi possível encerrar.", navigation });
            } finally {
              setCancellingContractId(null);
            }
          },
        },
      ]
    );
  }

  function handleContestDelivery(contractId: string) {
    Alert.alert(
      "Contestar entrega",
      "Use isso se a ficha entregue não faz sentido pro seu objetivo (ex.: vazia, incompleta). Um administrador vai analisar o caso. Deseja contestar?",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Contestar",
          style: "destructive",
          onPress: async () => {
            try {
              setContestingContractId(contractId);
              await runWithAuth((token) => consultancyApi.contestDelivery(token, contractId));
              showToast("Contestação enviada. Um administrador vai analisar.", "success");
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Não foi possível contestar.", navigation });
            } finally {
              setContestingContractId(null);
            }
          },
        },
      ]
    );
  }

  function goToArchived() {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate("ArchivedRequests");
  }

  function renderPlanCard(item: FlatPlan) {
    const isVigente = Boolean(item.isVigente);
    const bs = planValidityStyle(isVigente, theme);
    const hasExercises = (item.exercises?.length ?? 0) > 0;
    const canOpen = isVigente && hasExercises;
    const validUntilLabel = item.validUntil
      ? new Date(item.validUntil).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" })
      : null;
    return (
      <PressableScale
        key={item.id}
        disabled={!canOpen}
        onPress={() => canOpen && setSelectedPlan(item)}
        style={{
          borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border,
          backgroundColor: theme.cardBg, padding: S.cardPad,
          opacity: isVigente ? 1 : 0.65,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 18, color: theme.text1, letterSpacing: -0.013 * 18, flex: 1, marginRight: 10 }} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={{ backgroundColor: bs.bg, borderWidth: 1, borderColor: bs.border, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3, flexShrink: 0 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: bs.color }}>{bs.label}</Text>
          </View>
        </View>
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 6 }}>
          {item.description ? item.description : "Plano personalizado"}
        </Text>
        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: isVigente ? theme.primary : theme.text3, marginTop: 10 }}>
          {item.providerName} · {isVigente
            ? hasExercises ? `${item.exercises!.length} exercício${item.exercises!.length !== 1 ? "s" : ""}` : "Sem exercícios cadastrados"
            : "Sem acesso — vigência encerrada"}
        </Text>
        {validUntilLabel ? (
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginTop: 2 }}>
            {isVigente ? `Válido até ${validUntilLabel}` : `Venceu em ${validUntilLabel}`}
          </Text>
        ) : null}
        {canContestDelivery(item) ? (
          <TouchableOpacity
            onPress={() => handleContestDelivery(item.contractId)}
            disabled={contestingContractId === item.contractId}
            style={{ marginTop: 10 }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.text2, textDecorationLine: "underline" }}>
              {contestingContractId === item.contractId ? "Enviando..." : "Contestar esta entrega"}
            </Text>
          </TouchableOpacity>
        ) : null}
        {canEndOngoingConsultancy(item) ? (
          <TouchableOpacity
            onPress={() => handleEndOngoingConsultancy(item.contractId)}
            disabled={cancellingContractId === item.contractId}
            style={{ marginTop: 6 }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.danger, textDecorationLine: "underline" }}>
              {cancellingContractId === item.contractId ? "Encerrando..." : "Encerrar consultoria"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </PressableScale>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.training">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Treinos</Text>
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginTop: 4 }}>planos comprados e liberados</Text>
      </View>

      <ScreenEntrance>
      <FlatList
        contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 120, paddingTop: 16, gap: 10 }}
        data={activeTab === "active" ? activePlans : activeTab === "pending" ? pendingPlans : historyPlans}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={trainingQuery.isRefetching} onRefresh={() => void trainingQuery.refetch()} tintColor={theme.primary} colors={[theme.primary]} />}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 4 }}>
            {/* Tabs V2 */}
            <View style={{ flexDirection: "row", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: S.chipR, padding: 3, gap: 3 }}>
              {tabs.map((tab) => {
                const active = tab.key === activeTab;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    onPress={() => setActiveTab(tab.key)}
                    style={{
                      flex: 1, height: 34, borderRadius: S.chipR,
                      backgroundColor: active ? theme.primarySubtle : "transparent",
                      alignItems: "center", justifyContent: "center",
                      borderWidth: active ? 1 : 0, borderColor: theme.primarySubtleBorder,
                    }}
                  >
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: active ? theme.primary : theme.text3 }}>
                      {tab.label} {tab.count > 0 ? `(${tab.count})` : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Seção extra: Propostas aguardando decisão (tab pending) */}
            {activeTab === "pending" && respondedRequests.length > 0 && (
              <View style={{ gap: 10 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Propostas aguardando decisão</Text>
                {respondedRequests.map((req) => (
                  <View key={req.id} style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: C.amberBorder, backgroundColor: C.amberDim, padding: 14, gap: 10 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>{req.provider?.displayName ?? "Profissional"}</Text>
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>{req.providerResponseText ?? "Sem resposta detalhada."}</Text>
                    {req.quotedOffer && (
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: C.amber }}>
                        Contratar por {formatCurrencyBRL(req.quotedOffer.priceCents / 100)}
                      </Text>
                    )}
                    {/* Método de pagamento — filtrado pelo que a oferta aceita */}
                    {(() => {
                      const offerAcceptsPix = req.quotedOffer?.acceptsPix ?? true;
                      const offerAcceptsDebit = req.quotedOffer?.acceptsDebitCard ?? true;
                      const offerAcceptsCredit = req.quotedOffer?.acceptsCreditCard ?? true;
                      const maxInstallments = req.quotedOffer?.maxCreditInstallments ?? 1;
                      const allowedMethods = (["CREDIT_CARD", "DEBIT_CARD", "PIX"] as ConsultancyPaymentMethod[]).filter(
                        (pm) =>
                          (pm === "CREDIT_CARD" && offerAcceptsCredit) ||
                          (pm === "DEBIT_CARD" && offerAcceptsDebit) ||
                          (pm === "PIX" && offerAcceptsPix)
                      );
                      const selectedMethod = paymentByRequestId[req.id] ?? allowedMethods[0];
                      const selectedInstallments = installmentsByRequestId[req.id] ?? 1;
                      return (
                        <>
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            {allowedMethods.map((pm) => {
                              const active = selectedMethod === pm;
                              return (
                                <TouchableOpacity
                                  key={pm}
                                  onPress={() => setPaymentByRequestId((c) => ({ ...c, [req.id]: pm }))}
                                  style={{ flex: 1, height: S.touchMin, borderRadius: S.chipR, backgroundColor: active ? theme.primarySubtle : "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: active ? theme.primarySubtleBorder : theme.border, alignItems: "center", justifyContent: "center" }}
                                >
                                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: active ? theme.primary : theme.text2 }}>
                                    {pm === "CREDIT_CARD" ? "Crédito" : pm === "DEBIT_CARD" ? "Débito" : "PIX"}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          {selectedMethod === "CREDIT_CARD" && maxInstallments > 1 ? (
                            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                              {Array.from({ length: maxInstallments }, (_, i) => i + 1).map((n) => {
                                const active = selectedInstallments === n;
                                return (
                                  <TouchableOpacity
                                    key={n}
                                    onPress={() => setInstallmentsByRequestId((c) => ({ ...c, [req.id]: n }))}
                                    style={{ height: 30, paddingHorizontal: 10, borderRadius: S.chipR, backgroundColor: active ? theme.primarySubtle : "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: active ? theme.primarySubtleBorder : theme.border, alignItems: "center", justifyContent: "center" }}
                                  >
                                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: active ? theme.primary : theme.text2 }}>{n}x</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          ) : null}
                        </>
                      );
                    })()}
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, lineHeight: 16 }}>
                      Depois de aceitar, o profissional tem até 48h para entregar sua ficha de treino. Você pode desistir e ser reembolsado integralmente a qualquer momento antes da entrega.
                      {req.quotedOffer?.fichaValidityDays
                        ? ` Cada ficha vale ${req.quotedOffer.fichaValidityDays} dias — a cada renovação, você será cobrado de novo, automaticamente, o mesmo valor (${formatCurrencyBRL(req.quotedOffer.priceCents / 100)}).`
                        : ""}
                      {req.quotedOffer?.fichaValidityDays && (paymentByRequestId[req.id] ?? (req.quotedOffer?.acceptsCreditCard ?? true ? "CREDIT_CARD" : "PIX")) === "PIX"
                        ? " Pagando por Pix agora, você vai precisar cadastrar um cartão antes da primeira renovação — a renovação não pode ser cobrada por Pix."
                        : ""}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setConsentByRequestId((c) => ({ ...c, [req.id]: !c[req.id] }))}
                      style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}
                    >
                      <Ionicons
                        name={consentByRequestId[req.id] ? "checkbox" : "square-outline"}
                        size={18}
                        color={consentByRequestId[req.id] ? theme.primary : theme.text3}
                      />
                      <Text style={{ flex: 1, fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text2 }}>
                        Peço o início imediato do atendimento e estou ciente de que, após a entrega da primeira ficha de treino, perco o direito de arrependimento de 7 dias previsto no CDC.
                      </Text>
                    </TouchableOpacity>
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity onPress={() => void decideRequest(req.id, "REFUSE")} disabled={decidingRequestId === req.id} style={{ flex: 1, height: S.btnH, borderRadius: S.btnR, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>Recusar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() =>
                          void decideRequest(
                            req.id,
                            "ACCEPT",
                            paymentByRequestId[req.id] ?? (req.quotedOffer?.acceptsCreditCard ?? true ? "CREDIT_CARD" : "PIX"),
                            installmentsByRequestId[req.id] ?? 1
                          )
                        }
                        disabled={decidingRequestId === req.id || !consentByRequestId[req.id]}
                        style={{ flex: 1.4, height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4, opacity: consentByRequestId[req.id] ? 1 : 0.5 }}
                      >
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>Aceitar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Em entrega (tab pending) */}
            {activeTab === "pending" && waitingDelivery.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Em preparação</Text>
                {waitingDelivery.map((item) => (
                  <View key={item.contractId} style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: C.skyBorder, backgroundColor: C.skyDim, padding: 14, gap: 8 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>{item.providerName}</Text>
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>Entrega até {formatDateLabel(item.deliveryDeadlineAt)}</Text>
                    <TouchableOpacity
                      onPress={() => handleCancelContract(item.contractId)}
                      disabled={cancellingContractId === item.contractId}
                      style={{ alignSelf: "flex-start" }}
                    >
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text2, textDecorationLine: "underline" }}>
                        {cancellingContractId === item.contractId ? "Cancelando..." : "Cancelar consultoria"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Botão para arquivados (tab history) */}
            {activeTab === "history" && (
              <TouchableOpacity
                onPress={goToArchived}
                style={{ height: S.touchMin, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.04)", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
              >
                <Ionicons name="archive-outline" size={16} color={theme.text2} />
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: C.zinc300 }}>Ver solicitações arquivadas</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={({ item }) => renderPlanCard(item)}
        ListEmptyComponent={
          !loading ? (
            <View style={{ paddingTop: 40, alignItems: "center", gap: 10 }}>
              <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="barbell-outline" size={28} color={theme.primary} />
              </View>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center" }}>
                {activeTab === "active" ? "Nenhum plano vigente. Solicite uma consultoria para começar." :
                 activeTab === "pending" ? "Nenhum item pendente." :
                 "Nenhum treino vencido ainda."}
              </Text>
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />
      </ScreenEntrance>

      <ClientBottomNavV2
        activeTab="trainings"
        onNavigate={(tab) => {
          if (tab === "home") navigation.navigate("ClientHome");
          if (tab === "agenda") navigation.navigate("ClientBookings");
          if (tab === "community") navigation.navigate("Community");
          if (tab === "profile") navigation.navigate("ClientProfile");
        }}
      />

      {/* WorkoutDetailScreen como Modal full-screen */}
      <Modal
        visible={selectedPlan !== null}
        animationType="slide"
        onRequestClose={() => setSelectedPlan(null)}
        statusBarTranslucent
      >
        {selectedPlan && (
          <WorkoutDetailModal
            plan={selectedPlan}
            onClose={() => setSelectedPlan(null)}
            showToast={showToast}
            runWithAuth={runWithAuth}
            onCompleted={() => void trainingQuery.refetch()}
          />
        )}
      </Modal>
    </View>
  );
}
