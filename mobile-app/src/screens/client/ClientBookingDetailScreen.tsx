import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
} from "react-native-reanimated";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import QRCode from "react-native-qrcode-svg";
import { ClientStackParamList } from "../../navigation/route-types";
import {
  AttendanceCodeResponse,
  bookingsApi,
  Booking,
  CompletionProofInput,
  paymentsApi,
  PaymentStatusResponse,
  reviewsApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { SelfieProofCapture } from "../../components/media/SelfieProofCapture";
import { MvAvatar } from "../../components/mv";
import { formatBRDate, formatBRDateTime, formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { resolveMediaUrl } from "../../utils/media";
import { useMvTheme } from "../../theme/MvThemeContext";
import type { MvTheme } from "../../theme/MvColors";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { hapticCodeValidated, hapticCta } from "../../utils/haptics";
import { SkeletonBookingDetail } from "../../components/polish/SkeletonCard";

type Props = NativeStackScreenProps<ClientStackParamList, "ClientBookingDetail">;
type Stage = "scheduled" | "started" | "post" | "done";

const LAST_WORKOUT_KEY = "@personalapp/lastWorkout";

const REVIEW_TAGS = ["Didático", "Pontual", "Motivador", "Atencioso", "Técnico"];

function fmtTimer(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function paymentLabel(status?: PaymentStatusResponse["status"]) {
  if (!status) return "—";
  const m: Record<PaymentStatusResponse["status"], string> = {
    PENDING_AUTH: "Aguardando pré-auth",
    AUTHORIZING: "Autorizando",
    AUTHORIZED: "Pré-autorizado",
    CAPTURED: "Capturado",
    CANCELED: "Cancelado",
    REFUNDED: "Estornado",
    FAILED: "Falha",
  };
  return m[status];
}

function bookingStatusStyle(status: Booking["status"], theme: MvTheme) {
  const isDark = theme.mode === "dark";
  if (status === "CONFIRMED") return { label: "Confirmado", color: theme.primary, bg: theme.primarySubtle, border: theme.primarySubtleBorder };
  if (status === "PENDING") return { label: "Pendente", color: C.amber, bg: C.amberDim, border: C.amberBorder };
  if (status === "COMPLETED") return { label: "Concluído", color: theme.text2, bg: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border: theme.border };
  return { label: "Cancelado", color: theme.danger, bg: isDark ? "rgba(239,68,68,0.12)" : "rgba(220,38,38,0.09)", border: isDark ? "rgba(239,68,68,0.20)" : "rgba(220,38,38,0.15)" };
}

function getInitials(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export function ClientBookingDetailScreen({ route, navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const bookingId = route.params.bookingId;
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isValidBookingId = UUID_REGEX.test(bookingId);

  // ── Data query ─────────────────────────────────────────────────────────────
  const detailQuery = useAuthQuery(
    queryKeys.bookings.detail(bookingId),
    async (token) => {
      const [bookings, paymentData] = await Promise.all([
        bookingsApi.me(token),
        paymentsApi.bookingPayment(token, bookingId),
      ]);
      const found = bookings.find((b) => b.id === bookingId) ?? null;
      let attendanceData: AttendanceCodeResponse | null = null;
      if (found && (found.status === "PENDING" || found.status === "CONFIRMED")) {
        attendanceData = await bookingsApi.attendanceCode(token, found.id).catch(() => null);
      }
      return { booking: found, payment: paymentData, attendance: attendanceData };
    },
    { enabled: isValidBookingId }
  );

  const loading = detailQuery.isLoading;
  const booking = detailQuery.data?.booking ?? null;
  const payment = detailQuery.data?.payment ?? null;

  // ── Local attendance state (also refreshable on-demand via button) ─────────
  const [attendance, setAttendance] = useState<AttendanceCodeResponse | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reportingNoShow, setReportingNoShow] = useState(false);
  const [contestingNoShow, setContestingNoShow] = useState(false);

  useEffect(() => {
    if (detailQuery.data) setAttendance(detailQuery.data.attendance);
  }, [detailQuery.data]);

  useEffect(() => {
    if (!isValidBookingId) {
      showToast("ID de agendamento inválido.", "error");
      navigation.goBack();
    }
  }, [isValidBookingId, showToast, navigation]);

  useEffect(() => {
    if (detailQuery.error) {
      handleScreenError({ error: detailQuery.error, showToast, fallbackMessage: "Falha ao carregar detalhes.", navigation });
    }
  }, [detailQuery.error, showToast, navigation]);

  // ── V2 stage state ─────────────────────────────────────────────────────────
  const [stage, setStage] = useState<Stage>("scheduled");
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Post-class state (completion + review) ─────────────────────────────────
  const [completionProof, setCompletionProof] = useState<CompletionProofInput | null>(null);
  const [rating, setRating] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (stage === "started") {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [stage]);

  // ── Data loading ───────────────────────────────────────────────────────────
  const loadAttendance = useCallback(async (b: Booking | null) => {
    if (!b || (b.status !== "PENDING" && b.status !== "CONFIRMED")) { setAttendance(null); return; }
    try {
      setAttendanceLoading(true);
      const payload = await runWithAuth((token) => bookingsApi.attendanceCode(token, b.id));
      setAttendance(payload);
    } catch { setAttendance(null); }
    finally { setAttendanceLoading(false); }
  }, [runWithAuth]);


  // ── Computed ───────────────────────────────────────────────────────────────
  const isActive = useMemo(() =>
    booking?.status === "PENDING" || booking?.status === "CONFIRMED",
    [booking?.status]
  );
  const isValidated = attendance?.validated === true;
  const canReportNoShow = useMemo(() =>
    booking?.status === "CONFIRMED" && !isValidated && new Date(booking.scheduledAt) < new Date(),
    [booking?.status, booking?.scheduledAt, isValidated]
  );

  // A tela e sempre do proprio cliente, entao "eu fui reportado" e comparar
  // com o clientId do booking, sem precisar buscar o usuario logado.
  const noShowReport = booking?.noShowReport;
  const wasReportedAsNoShow = Boolean(
    noShowReport && booking && noShowReport.reportedUserId === booking.clientId
  );
  const canContestNoShow =
    wasReportedAsNoShow &&
    noShowReport!.status === "PENDING" &&
    new Date(noShowReport!.contestDeadlineAt) > new Date();

  // ── Animação de validação do código (scale bounce + fade) ─────────────────
  const checkScale = useSharedValue(0);
  const checkOpacity = useSharedValue(0);
  const checkAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
    opacity: checkOpacity.value,
  }));
  useEffect(() => {
    if (!isValidated) return;
    checkScale.value = withSequence(
      withTiming(1.2, { duration: 200, easing: Easing.out(Easing.quad) }),
      withTiming(1.0, { duration: 150, easing: Easing.out(Easing.quad) })
    );
    checkOpacity.value = withTiming(1, { duration: 200 });
  }, [isValidated]);

  // ── Actions ────────────────────────────────────────────────────────────────
  function handleCancel() {
    if (!booking) return;
    const hoursUntilSession = (new Date(booking.scheduledAt).getTime() - Date.now()) / (60 * 60 * 1000);
    const willRefund = hoursUntilSession >= 2;
    const message = willRefund
      ? "Você será reembolsado integralmente. Deseja cancelar mesmo assim?"
      : "Faltam menos de 2h para o horário marcado — cancelar agora não gera reembolso, o profissional já reservou esse horário. Deseja cancelar mesmo assim?";
    Alert.alert(
      "Cancelar agendamento",
      message,
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Cancelar agendamento",
          style: "destructive",
          onPress: async () => {
            try {
              setCancelling(true);
              await runWithAuth((token) => bookingsApi.updateStatus(token, booking.id, "CANCELLED"));
              showToast("Agendamento cancelado.", "success");
              navigation.goBack();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Não foi possível cancelar.", navigation });
            } finally { setCancelling(false); }
          },
        },
      ]
    );
  }

  function handleReportNoShow() {
    if (!booking) return;
    Alert.alert(
      "Reportar falta",
      "O personal não compareceu no horário marcado? Isso encerra o agendamento agora. O profissional tem 48h para contestar; se não contestar, você é reembolsado automaticamente.",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Reportar falta",
          style: "destructive",
          onPress: async () => {
            try {
              setReportingNoShow(true);
              await runWithAuth((token) => bookingsApi.reportNoShow(token, booking.id));
              showToast("Agendamento encerrado.", "success");
              navigation.goBack();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Não foi possível reportar a falta.", navigation });
            } finally { setReportingNoShow(false); }
          },
        },
      ]
    );
  }

  function handleContestNoShow() {
    if (!booking) return;
    Alert.alert(
      "Contestar relato de falta",
      "Você está contestando o relato de que não compareceu. O caso vai para análise antes de qualquer cobrança ou estorno.",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Contestar",
          onPress: async () => {
            try {
              setContestingNoShow(true);
              await runWithAuth((token) => bookingsApi.contestNoShow(token, booking.id));
              showToast("Contestação registrada. O caso está em análise.", "success");
              void detailQuery.refetch();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Não foi possível contestar.", navigation });
            } finally { setContestingNoShow(false); }
          },
        },
      ]
    );
  }

  async function handleConfirmPost() {
    if (!completionProof) {
      showToast("Salve a selfie para confirmar a conclusão.", "error");
      return;
    }
    if (!booking) return;
    try {
      setSubmitting(true);
      // 1. Confirma conclusão com prova de presença
      await runWithAuth((token) =>
        bookingsApi.updateStatus(token, booking.id, "COMPLETED", completionProof)
      );
      // 2. Salva snapshot local
      await AsyncStorage.setItem(LAST_WORKOUT_KEY, JSON.stringify({
        bookingId: booking.id,
        mode: "PRESENCIAL",
        selfieDataUri: `data:${completionProof.mimeType};base64,${completionProof.imageBase64}`,
        scheduledAt: booking.scheduledAt,
        location: booking.notes ?? "Local definido no agendamento",
      }));
      // 3. Envia avaliação
      const tagText = selectedTags.join(", ");
      await runWithAuth((token) =>
        reviewsApi.create(token, {
          bookingId: booking.id,
          rating,
          comment: tagText || undefined,
        })
      );
      showToast("Avaliação enviada!", "success");
      navigation.replace("WorkoutCelebration", {
        bookingId: booking.id,
        professionalId: booking.provider?.id ?? booking.providerId ?? "unknown",
        skipReview: true,
      });
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível confirmar conclusão.", navigation });
    } finally { setSubmitting(false); }
  }

  // ── Loading / not found ────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border }} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ width: "45%", height: 14, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.08)" }} />
            <View style={{ width: "28%", height: 11, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.06)" }} />
          </View>
        </View>
        <SkeletonBookingDetail />
      </View>
    );
  }
  if (!booking) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.text2 }}>Agendamento não encontrado.</Text>
      </View>
    );
  }

  // ── Stage: started — full-screen timer ────────────────────────────────────
  if (stage === "started") {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        {/* Header */}
        <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <TouchableOpacity onPress={() => setStage("scheduled")} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={18} color={theme.text1} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Aula em andamento</Text>
            <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>seu treino foi iniciado</Text>
          </View>
        </View>

        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: S.px }}>
          {/* Timer circle */}
          <View style={{
            width: 160, height: 160, borderRadius: 80,
            backgroundColor: theme.primarySubtle, borderWidth: 2, borderColor: theme.primarySubtleBorder,
            alignItems: "center", justifyContent: "center",
            shadowColor: theme.primary, shadowOpacity: 0.4, shadowRadius: 30, elevation: 8,
          }}>
            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 36, color: theme.primary, letterSpacing: -0.02 * 36 }}>
              {fmtTimer(seconds)}
            </Text>
          </View>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 28, color: theme.text1, letterSpacing: -0.4, marginTop: 24, textAlign: "center" }}>
            Treino rolando!
          </Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginTop: 8, textAlign: "center" }}>
            Sua aula está em andamento com {booking.provider?.displayName ?? "o personal"}.
          </Text>
        </View>

        {/* Footer */}
        <View style={{ paddingHorizontal: S.px, paddingBottom: Math.max(24, insets.bottom + 12) }}>
          <TouchableOpacity
            onPress={() => { hapticCta(); setStage("post"); }}
            style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>Finalizar aula</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Stage: post — conclusão + avaliação ───────────────────────────────────
  if (stage === "post") {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <TouchableOpacity
            onPress={() => {
              if (completionProof) {
                Alert.alert(
                  "Voltar para o treino?",
                  "A selfie salva e a avaliação serão perdidas.",
                  [
                    { text: "Ficar aqui", style: "cancel" },
                    { text: "Voltar", style: "destructive", onPress: () => { setCompletionProof(null); setRating(5); setSelectedTags([]); setStage("started"); } },
                  ]
                );
              } else {
                setStage("started");
              }
            }}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="chevron-back" size={18} color={theme.text1} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Mandou bem!</Text>
            <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>registre e avalie</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 120, paddingTop: 16, gap: 14 }} showsVerticalScrollIndicator={false}>
          {/* Tempo + stats */}
          <View style={{ alignItems: "center", gap: 6 }}>
            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 30, color: theme.text1, letterSpacing: -0.02 * 30 }}>Missão cumprida.</Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>
              Tempo: {fmtTimer(seconds)} · Registre e avalie seu personal.
            </Text>
          </View>

          {/* Selfie — lógica da ClientConfirmCompletionScreen */}
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle, padding: 16, gap: 10 }}>
            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.05 * 20 }}>Pose para o pump!</Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>
              Faça uma selfie para validar o atendimento e liberar o pagamento.
            </Text>
            <SelfieProofCapture
              disabled={submitting}
              value={completionProof}
              onChange={setCompletionProof}
              showToast={showToast}
            />
          </View>

          {/* Avaliação — lógica da ReviewProfessionalScreen melhorada com chips V2 */}
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: C.amberBorder, backgroundColor: "rgba(245,166,35,0.08)", padding: 16, gap: 12 }}>
            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.05 * 20 }}>Avalie seu personal</Text>

            {/* Estrelas */}
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 8 }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setRating(star)} style={{ padding: 4, minWidth: S.touchMin, alignItems: "center" }}>
                  <Text style={{ fontSize: 28, color: star <= rating ? C.amber : theme.labelColor }}>★</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Chips de qualificação — novidade V2 */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {REVIEW_TAGS.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])}
                    style={{
                      height: 36, paddingHorizontal: 14, borderRadius: S.chipR,
                      backgroundColor: active ? C.amber : "rgba(255,255,255,0.06)",
                      borderWidth: 1, borderColor: active ? C.amberBorder : theme.border,
                    }}
                  >
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: active ? theme.textOnPrimary : theme.text2, lineHeight: 36 }}>{tag}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* Botão de confirmação com safe area */}
        <View style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          paddingHorizontal: S.px, paddingBottom: Math.max(12, insets.bottom + 12), paddingTop: 12,
          backgroundColor: `${theme.bg}f0`, borderTopWidth: 1, borderTopColor: theme.border,
        }}>
          <TouchableOpacity
            disabled={submitting || !completionProof}
            onPress={() => { hapticCta(); void handleConfirmPost(); }}
            style={{
              height: S.btnH, borderRadius: S.btnR,
              backgroundColor: (!completionProof) ? "rgba(36,230,109,0.4)" : theme.primary,
              alignItems: "center", justifyContent: "center",
              shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4,
              opacity: submitting ? 0.7 : 1,
            }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>
              {submitting ? "Confirmando..." : !completionProof ? "Selfie obrigatória" : "Confirmar avaliação e finalizar"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Stage: scheduled — tela principal do agendamento ──────────────────────
  const bs = bookingStatusStyle(booking.status, theme);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.booking-detail">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }} numberOfLines={1}>
            Detalhe do agendamento
          </Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>tudo pronto para sua aula</Text>
        </View>
      </View>

      <ScreenEntrance>
      <ScrollView contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 120, paddingTop: 16, gap: 14 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>

        {/* Hero card — profissional + status */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: "rgba(36,230,109,0.09)", padding: 16 }}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <MvAvatar
              initials={getInitials(booking.provider?.displayName)}
              photoUri={resolveMediaUrl(booking.provider?.photoUrl)}
              tone="green"
              size="lg"
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.05 * 20 }}>
                Tudo pronto para treinar
              </Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginTop: 4 }}>
                {booking.provider?.displayName ?? "Personal"} te espera em {formatBRDateTime(booking.scheduledAt)}.
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <View style={{ backgroundColor: bs.bg, borderWidth: 1, borderColor: bs.border, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: bs.color }}>{bs.label}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Guia de 4 passos */}
        {isActive && (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 14 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, marginBottom: 14 }}>
              4 passos para a aula fluir bem
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {["Chegue ao local", "Encontre o personal", "Mostre o código", "Comece a aula"].map((step, i) => (
                <View key={step} style={{ width: 130, borderRadius: 18, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, padding: 12 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.textOnPrimary }}>{i + 1}</Text>
                  </View>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1, marginTop: 10 }}>{step}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* QR Code + código de presença */}
        {isActive && (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 16, alignItems: "center", gap: 12 }}>
            {isValidated ? (
              // Código validado → mostra botão de iniciar
              <>
                <Animated.View style={[{ flexDirection: "row", alignItems: "center", gap: 8 }, checkAnimStyle]}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="checkmark" size={18} color={theme.textOnPrimary} />
                  </View>
                  <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.02 * 22 }}>Código validado!</Text>
                </Animated.View>
                <TouchableOpacity
                  onPress={() => {
                    hapticCodeValidated(); // Momento 3 — código validado
                    setStage("started");
                  }}
                  style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", width: "100%", shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>Iniciar aula</Text>
                </TouchableOpacity>
              </>
            ) : attendanceLoading ? (
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>Atualizando código/QR...</Text>
            ) : attendance?.available ? (
              <>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>Código da aula</Text>
                {/* Código alfanumérico em destaque */}
                <View style={{ width: "100%", paddingVertical: 14, backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 18, alignItems: "center" }}>
                  <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 30, color: theme.primary, letterSpacing: 0.18 * 30 }}>
                    {attendance.code ?? "------"}
                  </Text>
                </View>
                {/* QR Code */}
                {(attendance.qrDeepLink || attendance.qrToken) ? (
                  <View style={{ padding: 12, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, alignItems: "center" }}>
                    <QRCode
                      backgroundColor="transparent"
                      color={theme.text1}
                      size={160}
                      value={attendance.qrDeepLink ?? attendance.qrToken ?? "-"}
                    />
                  </View>
                ) : null}
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>
                  Expira em: {formatBRDateTime(attendance.expiresAt)}
                </Text>
                <TouchableOpacity
                  onPress={() => void loadAttendance(booking)}
                  style={{ height: 44, paddingHorizontal: 20, borderRadius: S.chipR, borderWidth: 1, borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.04)", alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: C.zinc300 }}>Atualizar código/QR</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Ionicons name="time-outline" size={32} color={theme.text3} />
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center" }}>
                  Código/QR liberados automaticamente 10 minutos antes da aula.
                </Text>
                <TouchableOpacity
                  onPress={() => void loadAttendance(booking)}
                  style={{ height: 44, paddingHorizontal: 20, borderRadius: S.chipR, borderWidth: 1, borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.04)", alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: C.zinc300 }}>Verificar agora</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Informações do agendamento */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 14, gap: 8 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, marginBottom: 4 }}>Detalhes do agendamento</Text>
          <InfoRow icon="calendar-outline" label="Data e hora" value={formatBRDateTime(booking.scheduledAt)} />
          {booking.notes && <InfoRow icon="location-outline" label="Local" value={booking.notes} />}
          <InfoRow icon="card-outline" label="Pagamento" value={paymentLabel(payment?.status)} />
          {payment?.amountCents ? (
            <InfoRow icon="cash-outline" label="Valor" value={formatCurrencyBRL(payment.amountCents / 100)} />
          ) : null}
          {payment?.status === "FAILED" && payment.failureReason ? (
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingTop: 4 }}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.danger} style={{ marginTop: 1 }} />
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.danger, flex: 1, lineHeight: 18 }}>
                {payment.failureReason}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Botões de ação */}
        {isActive && (
          <View style={{ gap: 10 }}>
            <TouchableOpacity
              onPress={() => navigation.navigate("ClientChatList")}
              style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
            >
              <Ionicons name="chatbubbles-outline" size={18} color={theme.text1} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>Chat com o personal</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={cancelling}
              onPress={handleCancel}
              style={{ height: 44, borderRadius: S.btnR, alignItems: "center", justifyContent: "center", opacity: cancelling ? 0.6 : 1 }}
            >
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.danger }}>
                {cancelling ? "Cancelando..." : "Cancelar agendamento"}
              </Text>
            </TouchableOpacity>
            {canReportNoShow ? (
              <TouchableOpacity
                disabled={reportingNoShow}
                onPress={handleReportNoShow}
                style={{ height: 44, borderRadius: S.btnR, alignItems: "center", justifyContent: "center", opacity: reportingNoShow ? 0.6 : 1 }}
              >
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.danger }}>
                  {reportingNoShow ? "Reportando..." : "O personal não compareceu"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {wasReportedAsNoShow && noShowReport ? (
          <View style={{ marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.danger, backgroundColor: "rgba(239,68,68,0.08)", padding: 14, gap: 8 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>
              Você foi reportado por falta neste agendamento
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
              {noShowReport.status === "PENDING"
                ? `Se não for contestado até ${formatBRDateTime(noShowReport.contestDeadlineAt)}, o valor da sessão fica com o profissional.`
                : noShowReport.status === "CONTESTED"
                ? "Sua contestação está em análise."
                : "Este relato já foi resolvido."}
            </Text>
            {canContestNoShow ? (
              <TouchableOpacity
                disabled={contestingNoShow}
                onPress={handleContestNoShow}
                style={{ height: 40, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.danger, alignItems: "center", justifyContent: "center", opacity: contestingNoShow ? 0.6 : 1 }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.danger }}>
                  {contestingNoShow ? "Enviando..." : "Contestar"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      </ScreenEntrance>
    </View>
  );
}

// Componente auxiliar para linha de informação
function InfoRow({ icon, label, value }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: string }) {
  const { theme } = useMvTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: S.touchMin }}>
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={14} color={theme.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>{label}</Text>
        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1, marginTop: 1 }}>{value}</Text>
      </View>
    </View>
  );
}
