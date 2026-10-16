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
  ActivityIndicator,
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
import { useIsFocused } from "@react-navigation/native";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import QRCode from "react-native-qrcode-svg";
import { ClientStackParamList } from "../../navigation/route-types";
import {
  ApiError,
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
import { MvAvatar, MvInput } from "../../components/mv";
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
    PARTIALLY_REFUNDED: "Estornado parcialmente",
    FAILED: "Falha",
  };
  return m[status];
}

function bookingStatusStyle(status: Booking["status"], theme: MvTheme) {
  const isDark = theme.mode === "dark";
  if (status === "CONFIRMED") return { label: "Confirmado", color: theme.primary, bg: theme.primarySubtle, border: theme.primarySubtleBorder };
  if (status === "PENDING") return { label: "Pendente", color: C.amber, bg: C.amberDim, border: C.amberBorder };
  if (status === "COMPLETED") return { label: "Concluído", color: theme.text2, bg: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border: theme.border };
  return { label: "Cancelado", color: theme.danger, bg: isDark ? theme.dangerSubtle : "rgba(220,38,38,0.09)", border: isDark ? theme.dangerSubtleBorder : "rgba(220,38,38,0.15)" };
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

  // Frente 5 (Descoberta, agendamento e agenda), Lote 9: única tela de
  // agendamento do cliente sem refetch ao voltar pro foco — se o
  // profissional cancelasse enquanto o cliente estava com a tela de
  // detalhe aberta (ou voltando de uma notificação push), os dados
  // ficavam desatualizados até sair e voltar manualmente.
  useFocusEffectSkippingFirst(useCallback(() => { void detailQuery.refetch(); }, [detailQuery.refetch]));

  // ── Local attendance state (also refreshable on-demand via button) ─────────
  const [attendance, setAttendance] = useState<AttendanceCodeResponse | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  // Frente 6 (segunda camada), Lote 13: falha de rede era tratada igual a
  // "código ainda não liberado" — o cliente não tinha como distinguir "só
  // não chegou a hora" de "deu erro, tenta de novo".
  const [attendanceError, setAttendanceError] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reportingNoShow, setReportingNoShow] = useState(false);
  const [contestingNoShow, setContestingNoShow] = useState(false);
  const [contestingAutoCapture, setContestingAutoCapture] = useState(false);
  const [withdrawingNoShow, setWithdrawingNoShow] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [contestReason, setContestReason] = useState("");
  // Frente 6 (segunda camada), Lote 12: navigation.goBack() logo depois de
  // reportar falta com sucesso não deve acionar o aviso de "sair sem
  // enviar" — setReportReason("") acima é assíncrono, então sem este ref
  // o listener ainda registrado com o texto antigo bloquearia o próprio
  // fluxo de sucesso que essa correção introduz.
  const justSubmittedReasonRef = useRef(false);

  // Frente 6 (segunda camada), Lote 12: motivo de falta/contestação
  // digitado era perdido ao sair da tela sem nenhuma confirmação — mesmo
  // padrão de aviso já usado em outras telas do app.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (justSubmittedReasonRef.current || (!reportReason.trim() && !contestReason.trim())) return;
      e.preventDefault();
      Alert.alert(
        "Sair sem enviar?",
        "O texto digitado será perdido.",
        [
          { text: "Continuar aqui", style: "cancel" },
          { text: "Sair", style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, reportReason, contestReason]);

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

  // Confirma e descarta o treino em andamento, voltando ao estado agendado —
  // usado tanto pelo botão de voltar customizado do header quanto pelo
  // beforeRemove (botão físico/gesto do sistema), que precisam se comportar
  // igual. setSeconds(0) é necessário aqui: sem isso, o cronômetro ficava
  // "pausado" em vez de reiniciar ao tocar em "Iniciar aula" de novo.
  function confirmExitStartedStage() {
    Alert.alert(
      "Sair do treino em andamento?",
      "O cronômetro será perdido e o treino voltará ao estado agendado.",
      [
        { text: "Ficar aqui", style: "cancel" },
        {
          text: "Sair",
          style: "destructive",
          onPress: () => {
            setStage("scheduled");
            setSeconds(0);
            setCompletionProof(null);
          },
        },
      ]
    );
  }

  // Frente 6 (segunda camada), Lote 12: os estágios "started" (timer em
  // tela cheia) e "post" (selfie + avaliação) só protegiam contra perda de
  // dados através do botão de voltar customizado do próprio header — o
  // botão físico/gesto de voltar do sistema (Android/iOS) ignorava
  // completamente essa proteção. beforeRemove intercepta qualquer forma de
  // sair da tela, não só o toque no ícone.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      const hasStartedWork = stage === "started" || (stage === "post" && Boolean(completionProof));
      if (!hasStartedWork) return;
      e.preventDefault();
      if (stage === "started") {
        confirmExitStartedStage();
        return;
      }
      Alert.alert(
        "Voltar para o treino?",
        "A selfie salva e a avaliação serão perdidas.",
        [
          { text: "Ficar aqui", style: "cancel" },
          {
            text: "Sair",
            style: "destructive",
            onPress: () => {
              setStage("scheduled");
              setSeconds(0);
              setCompletionProof(null);
            },
          },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, stage, completionProof]);

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
    if (!b || (b.status !== "PENDING" && b.status !== "CONFIRMED")) { setAttendance(null); setAttendanceError(false); return; }
    try {
      setAttendanceLoading(true);
      const payload = await runWithAuth((token) => bookingsApi.attendanceCode(token, b.id));
      setAttendance(payload);
      setAttendanceError(false);
    } catch {
      // Mantém o último código já carregado na tela (uma falha pontual de
      // polling não deveria fazer o QR/código sumir) — só marca o erro pra
      // exibir quando ainda não havia nada carregado.
      setAttendanceError(true);
    }
    finally { setAttendanceLoading(false); }
  }, [runWithAuth]);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (!detailQuery.data) return;
    if (detailQuery.data.attendance) {
      setAttendance(detailQuery.data.attendance);
      setAttendanceError(false);
      return;
    }
    // Frente 6 (segunda camada), Lote 13: a busca embutida em detailQuery
    // engole qualquer erro (`.catch(() => null)`) pra não derrubar a tela
    // inteira por causa só do código de presença — mas isso também escondia
    // "deu erro de rede" atrás de "ainda não liberado". Se veio nulo e o
    // agendamento está ativo, refaz a busca isolada via loadAttendance, que
    // já distingue os dois casos.
    const b = detailQuery.data.booking;
    if (b && (b.status === "PENDING" || b.status === "CONFIRMED")) {
      void loadAttendance(b);
    } else {
      setAttendance(null);
      setAttendanceError(false);
    }
  }, [detailQuery.data, loadAttendance]);

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

  // Raio-X do fluxo de conclusão presencial (2026-10-16): a tela não tinha
  // nenhuma noção de "eu já confirmei minha parte" vinda do servidor — o
  // estado local (`stage`) sempre começa em "scheduled", então sair e
  // voltar pro mesmo agendamento depois de confirmar (aguardando o
  // profissional) mostrava de novo "Iniciar aula" e o guia de passos, como
  // se nada tivesse acontecido.
  const awaitingProviderConfirmation = Boolean(
    booking && booking.status === "CONFIRMED" && booking.clientConfirmedAt
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

  // Achado em teste manual (2026-10-16): o caso espelhado (EU reportei a
  // falta do profissional) não tinha nenhum card — o cliente que reporta
  // reabria a tela e só via "Cancelado" genérico, sem confirmação de que
  // o report foi registrado nem prazo de quando o outro lado pode responder.
  const reportedByMe = Boolean(
    noShowReport && booking && noShowReport.reportedByUserId === booking.clientId
  );

  // Se só o profissional confirmou a conclusão (o cliente nunca confirmou), a
  // cobrança foi forçada por confirmação única — o cliente tem 24h após a
  // conclusão pra contestar essa cobrança específica.
  const autoCaptureContest = booking?.disputeCases?.[0] ?? null;
  const canContestAutoCapture = Boolean(
    booking &&
    booking.status === "COMPLETED" &&
    booking.completedAt &&
    !booking.clientConfirmedAt &&
    booking.providerConfirmedAt &&
    !autoCaptureContest &&
    Date.now() - new Date(booking.completedAt).getTime() <= 24 * 60 * 60 * 1000
  );
  // Achado em teste manual (2026-10-16): depois de contestar, o botão
  // "Contestar cobrança" continuava aparecendo — o servidor já bloqueia
  // uma segunda tentativa, mas a tela nunca sabia que a primeira já tinha
  // acontecido (disputeCases não vinha junto com o agendamento).
  const showAutoCaptureInfo = Boolean(
    booking && booking.status === "COMPLETED" && !booking.clientConfirmedAt && booking.providerConfirmedAt
  );

  // Frente 6 (segunda camada), Lote 13: o código/QR só atualizava com o
  // cliente tocando manualmente em "Atualizar" ou reabrindo a tela — sem
  // feedback automático no momento exato em que o profissional escaneia.
  // Mesmo padrão de polling já usado em BookingConfirmationScreen pro
  // status do Pix.
  useEffect(() => {
    if (!isFocused || !isActive || isValidated) return;
    const interval = setInterval(() => { void loadAttendance(booking); }, 7000);
    return () => clearInterval(interval);
  }, [isFocused, isActive, isValidated, booking, loadAttendance]);

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
    // Frente 5 (Descoberta, agendamento e agenda), Lote 8: "não gera
    // reembolso" só faz sentido se o Pix já tiver sido de fato pago — se
    // o cliente nunca gerou/pagou a cobrança, não há nada retido.
    const isPixUnpaid = payment?.method === "PIX" && payment.status !== "CAPTURED";
    const message = willRefund
      ? "Você será reembolsado integralmente. Deseja cancelar mesmo assim?"
      : isPixUnpaid
        ? "Faltam menos de 2h para o horário marcado. Como o Pix ainda não foi pago, cancelar agora só cancela a cobrança pendente — nada será cobrado. Deseja cancelar mesmo assim?"
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
              // Frente 5 (Descoberta, agendamento e agenda), Lote 9: sem
              // refetch aqui, o botão de cancelar continuava visível e
              // clicável mesmo depois do booking já ter mudado de estado
              // em outro lugar (ex: profissional cancelou primeiro) — a
              // tela nunca refletia o estado real até sair e voltar.
              void detailQuery.refetch();
              if (error instanceof ApiError && /transição de status inválida/i.test(error.message)) {
                showToast("Este agendamento já não está mais nesse estado. Atualizamos os dados da tela.", "error");
              } else {
                handleScreenError({ error, showToast, fallbackMessage: "Não foi possível cancelar.", navigation });
              }
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
              await runWithAuth((token) => bookingsApi.reportNoShow(token, booking.id, reportReason.trim() || undefined));
              showToast("Agendamento encerrado.", "success");
              setReportReason("");
              justSubmittedReasonRef.current = true;
              navigation.goBack();
            } catch (error) {
              void detailQuery.refetch();
              if (
                error instanceof ApiError &&
                /transição de status inválida|apenas agendamentos confirmados podem ser reportados|já foi reportado/i.test(error.message)
              ) {
                showToast("Este agendamento já não está mais nesse estado. Atualizamos os dados da tela.", "error");
              } else {
                handleScreenError({ error, showToast, fallbackMessage: "Não foi possível reportar a falta.", navigation });
              }
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
      "Você está contestando o relato de que não compareceu. Um administrador vai analisar o caso antes de qualquer cobrança ou estorno.",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Contestar",
          onPress: async () => {
            try {
              setContestingNoShow(true);
              await runWithAuth((token) => bookingsApi.contestNoShow(token, booking.id, contestReason.trim() || undefined));
              showToast("Contestação registrada. Um administrador vai analisar.", "success");
              setContestReason("");
              void detailQuery.refetch();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Não foi possível contestar.", navigation });
            } finally { setContestingNoShow(false); }
          },
        },
      ]
    );
  }

  function handleWithdrawNoShow() {
    if (!booking) return;
    Alert.alert(
      "Retirar relato de falta",
      "Isso cancela o seu relato e volta o agendamento ao estado confirmado, como se nada tivesse acontecido. Use só se você reportou por engano.",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Retirar relato",
          style: "destructive",
          onPress: async () => {
            try {
              setWithdrawingNoShow(true);
              await runWithAuth((token) => bookingsApi.withdrawNoShow(token, booking.id));
              showToast("Relato retirado. O agendamento voltou ao normal.", "success");
              void detailQuery.refetch();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Não foi possível retirar o relato.", navigation });
            } finally { setWithdrawingNoShow(false); }
          },
        },
      ]
    );
  }

  function handleContestAutoCapture() {
    if (!booking) return;
    Alert.alert(
      "Contestar cobrança",
      "Essa sessão foi cobrada porque só o profissional confirmou a conclusão dentro do prazo. Se você discorda, contestar abre um caso pra um administrador analisar antes da cobrança ficar definitiva.",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Contestar",
          onPress: async () => {
            try {
              setContestingAutoCapture(true);
              await runWithAuth((token) => bookingsApi.contestAutoCapture(token, booking.id));
              showToast("Contestação registrada. O caso está em análise.", "success");
              void detailQuery.refetch();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Não foi possível contestar.", navigation });
            } finally { setContestingAutoCapture(false); }
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
      // 1. Confirma conclusão com prova de presença — a conclusão só vira
      // COMPLETED de verdade (status do booking) depois que os dois lados
      // confirmarem, mas isso é sobre quando capturar o pagamento, não
      // sobre se o cliente já pode avaliar: clientConfirmedAt (gravado
      // aqui) já é suficiente pro servidor aceitar a avaliação.
      const updatedBooking = await runWithAuth((token) =>
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
      // 3. Envia avaliação — um 409 "já foi avaliado" aqui pode acontecer
      // de forma legítima (ex: a primeira tentativa teve sucesso no
      // servidor mas a resposta se perdeu por uma queda de rede, e o
      // cliente tentou de novo) — nesse caso não é erro de verdade, é só a
      // confirmação de que já está tudo salvo.
      const tagText = selectedTags.join(", ");
      try {
        await runWithAuth((token) =>
          reviewsApi.create(token, {
            bookingId: booking.id,
            rating,
            comment: tagText || undefined,
          })
        );
      } catch (reviewError) {
        const alreadyReviewed = reviewError instanceof ApiError && reviewError.status === 409;
        if (!alreadyReviewed) throw reviewError;
      }
      showToast("Avaliação enviada!", "success");
      // navigation.replace() abaixo também dispara o listener "beforeRemove"
      // (linha ~197) — ele existe pra avisar quando o usuário tenta SAIR
      // com algo não salvo, mas não distingue isso de uma navegação
      // disparada pelo próprio app após o sucesso. Como completionProof
      // continuava setado, o listener interceptava essa troca de tela e
      // mostrava "Voltar para o treino? A selfie e a avaliação serão
      // perdidas." logo depois de tudo já ter sido salvo com sucesso —
      // limpar aqui faz o listener deixar a troca de tela seguir em frente.
      setCompletionProof(null);
      navigation.replace("WorkoutCelebration", {
        bookingId: booking.id,
        professionalId: booking.provider?.id ?? booking.providerId ?? "unknown",
        skipReview: true,
        // A conclusão só é definitiva (pagamento capturado, XP concedido)
        // quando os dois lados confirmam — se o profissional ainda não
        // confirmou a dele, a tela de celebração não deveria prometer
        // pontos que ainda não existem de verdade.
        pendingOtherSide: updatedBooking.status !== "COMPLETED",
      });
    } catch (error) {
      // Pix pendente bloqueia a conclusão (regra do servidor) — sem isso, o
      // cliente só via o toast de erro e tinha que descobrir sozinho que
      // precisava ir pagar o Pix antes de poder tentar de novo.
      if (error instanceof ApiError && /pix.*ainda não foi conclu[ií]do/i.test(error.message)) {
        Alert.alert(
          "Pagamento Pix pendente",
          "Finalize o pagamento via Pix para poder concluir este agendamento.",
          [
            { text: "Agora não", style: "cancel" },
            { text: "Ver pagamento", onPress: () => navigation.navigate("BookingPaymentStatus", { bookingId: booking.id }) },
          ]
        );
        setSubmitting(false);
        return;
      }
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível confirmar conclusão.", navigation });
      setSubmitting(false);
    }
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
          <TouchableOpacity onPress={confirmExitStartedStage} accessibilityRole="button" accessibilityLabel="Voltar" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
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
            disabled={submitting}
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
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", opacity: submitting ? 0.5 : 1 }}
          >
            <Ionicons name="chevron-back" size={18} color={theme.text1} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Mandou bem!</Text>
            <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>registre e avalie</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 210, paddingTop: 16, gap: 14 }} showsVerticalScrollIndicator={false}>
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
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, textAlign: "center", marginBottom: 8 }}>
            Se o profissional ainda não confirmou, a cobrança acontece automaticamente em até 24h — você ainda terá uma janela para contestar antes de ficar definitiva.
          </Text>
          <TouchableOpacity
            disabled={submitting || !completionProof}
            onPress={() => { hapticCta(); void handleConfirmPost(); }}
            style={{
              height: S.btnH, borderRadius: S.btnR,
              backgroundColor: (!completionProof) ? theme.primaryDisabled : theme.primary,
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

        <Modal visible={submitting} transparent animationType="fade">
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 32 }}>
            <View style={{ backgroundColor: theme.cardBg, borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, padding: 24, alignItems: "center", gap: 14, width: "100%", maxWidth: 320 }}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, textAlign: "center" }}>
                Confirmando conclusão...
              </Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center" }}>
                Salvando sua selfie e avaliação. Aguarde um instante.
              </Text>
            </View>
          </View>
        </Modal>
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
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Voltar" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
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
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primaryHighlight, padding: 16 }}>
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
              {booking.status === "PENDING" && booking.confirmationDeadlineAt ? (
                <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 6 }}>
                  Se o profissional não confirmar até {formatBRDateTime(booking.confirmationDeadlineAt)}, o agendamento é cancelado e o valor estornado automaticamente.
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* Cliente já confirmou a própria conclusão, falta só o profissional */}
        {awaitingProviderConfirmation && (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle, padding: 16, gap: 8, alignItems: "center" }}>
            <Ionicons name="checkmark-circle" size={28} color={theme.primary} />
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, textAlign: "center" }}>
              Você já confirmou sua parte!
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center" }}>
              Assim que o profissional também confirmar a conclusão, o pagamento é processado e você ganha seus pontos. Nada mais a fazer por aqui.
            </Text>
          </View>
        )}

        {/* Guia de 4 passos */}
        {isActive && !awaitingProviderConfirmation && (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 14 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, marginBottom: 14 }}>
              4 passos para a aula fluir bem
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {["Chegue ao local", "Encontre o personal", "Mostre o código", "Comece a aula"].map((step, i) => (
                <View key={step} style={{ flex: 1, minWidth: 0, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, padding: 8 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.textOnPrimary }}>{i + 1}</Text>
                  </View>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10.5, lineHeight: 13, color: theme.text1, marginTop: 7 }}>{step}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* QR Code + código de presença */}
        {isActive && !awaitingProviderConfirmation && (
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
            ) : attendance?.available ? (
              <>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>Código da aula</Text>
                {/* Código alfanumérico em destaque */}
                <View testID="text.booking-detail.attendance-code" style={{ width: "100%", paddingVertical: 14, backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 18, alignItems: "center" }}>
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
            ) : attendanceLoading ? (
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>Atualizando código/QR...</Text>
            ) : attendanceError ? (
              // Frente 6 (segunda camada), Lote 13: antes, qualquer falha de
              // rede caía nesse mesmo estado de "ainda não liberado" — sem
              // diferenciar espera normal de erro de verdade.
              <>
                <Ionicons name="alert-circle-outline" size={32} color={theme.text3} />
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center" }}>
                  Não foi possível carregar o código/QR agora. Verifique sua conexão e tente de novo.
                </Text>
                <TouchableOpacity
                  onPress={() => void loadAttendance(booking)}
                  style={{ height: 44, paddingHorizontal: 20, borderRadius: S.chipR, borderWidth: 1, borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.04)", alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: C.zinc300 }}>Tentar novamente</Text>
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
          {booking.sessionLocation && <InfoRow icon="location-outline" label="Local" value={booking.sessionLocation} />}
          {booking.notes && <InfoRow icon="chatbox-ellipses-outline" label="Observações" value={booking.notes} />}
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
              testID="button.booking-detail.open-chat"
              onPress={() => navigation.navigate("ClientChatList")}
              style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
            >
              <Ionicons name="chatbubbles-outline" size={18} color={theme.text1} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>Chat com o personal</Text>
            </TouchableOpacity>
            {/* Raio-X do fluxo de conclusão presencial (2026-10-16): uma vez
                que a presença foi validada, a sessão é tratada como tendo
                acontecido — o servidor agora recusa esse cancelamento
                (mesma regra do lado profissional), então nem mostra mais o
                botão aqui pra evitar o cliente tocar e levar um erro. */}
            {!isValidated && (
              <TouchableOpacity
                disabled={cancelling}
                onPress={handleCancel}
                style={{ height: 44, borderRadius: S.btnR, alignItems: "center", justifyContent: "center", opacity: cancelling ? 0.6 : 1 }}
              >
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.danger }}>
                  {cancelling ? "Cancelando..." : "Cancelar agendamento"}
                </Text>
              </TouchableOpacity>
            )}
            {canReportNoShow ? (
              <View style={{ gap: 6 }}>
                <MvInput
                  multiline
                  numberOfLines={2}
                  maxLength={500}
                  placeholder="Conte o que aconteceu (opcional)"
                  value={reportReason}
                  onChangeText={setReportReason}
                  style={{ textAlignVertical: "top" } as any}
                />
                <TouchableOpacity
                  disabled={reportingNoShow}
                  onPress={handleReportNoShow}
                  style={{ height: 44, borderRadius: S.btnR, alignItems: "center", justifyContent: "center", opacity: reportingNoShow ? 0.6 : 1 }}
                >
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.danger }}>
                    {reportingNoShow ? "Reportando..." : "O personal não compareceu"}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        )}

        {wasReportedAsNoShow && noShowReport ? (
          <View style={{
            marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 14, gap: 8,
            borderColor: noShowReport.status === "WITHDRAWN" ? theme.border : theme.danger,
            backgroundColor: noShowReport.status === "WITHDRAWN" ? theme.cardBg : theme.dangerSubtle,
          }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>
              {noShowReport.status === "WITHDRAWN" ? "Relato de falta retirado" : "Você foi reportado por falta neste agendamento"}
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
              {noShowReport.status === "PENDING"
                ? `Se não for contestado até ${formatBRDateTime(noShowReport.contestDeadlineAt)}, o valor da sessão fica com o profissional.`
                : noShowReport.status === "CONTESTED"
                ? "Sua contestação está em análise."
                : noShowReport.status === "WITHDRAWN"
                ? "Quem reportou retirou o relato — o agendamento voltou ao normal, nada a fazer aqui."
                : "Este relato já foi resolvido."}
            </Text>
            {canContestNoShow ? (
              <View style={{ gap: 6 }}>
                <MvInput
                  multiline
                  numberOfLines={2}
                  maxLength={500}
                  placeholder="Conte sua versão do que aconteceu (opcional)"
                  value={contestReason}
                  onChangeText={setContestReason}
                  style={{ textAlignVertical: "top" } as any}
                />
                <TouchableOpacity
                  disabled={contestingNoShow}
                  onPress={handleContestNoShow}
                  style={{ height: 40, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.danger, alignItems: "center", justifyContent: "center", opacity: contestingNoShow ? 0.6 : 1 }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.danger }}>
                    {contestingNoShow ? "Enviando..." : "Contestar"}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}

        {reportedByMe && noShowReport ? (
          <View style={{ marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 14, gap: 8 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>
              {noShowReport.status === "WITHDRAWN" ? "Você retirou o relato de falta" : "Você reportou falta neste agendamento"}
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
              {noShowReport.status === "PENDING"
                ? `O profissional tem até ${formatBRDateTime(noShowReport.contestDeadlineAt)} para contestar. Se não contestar, você é reembolsado automaticamente.`
                : noShowReport.status === "CONTESTED"
                ? "O profissional contestou o seu relato — um administrador vai analisar e decidir."
                : noShowReport.status === "WITHDRAWN"
                ? "O agendamento voltou ao estado confirmado, como se nada tivesse acontecido."
                : "Este relato já foi resolvido."}
            </Text>
            {noShowReport.status === "PENDING" ? (
              <TouchableOpacity
                disabled={withdrawingNoShow}
                onPress={handleWithdrawNoShow}
                style={{ height: 40, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", opacity: withdrawingNoShow ? 0.6 : 1 }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text2 }}>
                  {withdrawingNoShow ? "Retirando..." : "Retirar relato (reportei por engano)"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {canContestAutoCapture ? (
          <View style={{ marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.danger, backgroundColor: theme.dangerSubtle, padding: 14, gap: 8 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>
              Esta sessão foi cobrada por confirmação única
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
              Só o profissional confirmou a conclusão — você não confirmou. Você tem 24h após a conclusão pra contestar essa cobrança, se discordar de que a sessão aconteceu como descrito.
            </Text>
            <TouchableOpacity
              disabled={contestingAutoCapture}
              onPress={handleContestAutoCapture}
              style={{ height: 40, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.danger, alignItems: "center", justifyContent: "center", opacity: contestingAutoCapture ? 0.6 : 1 }}
            >
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.danger }}>
                {contestingAutoCapture ? "Enviando..." : "Contestar cobrança"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : showAutoCaptureInfo && autoCaptureContest ? (
          <View style={{ marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 14, gap: 8 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>
              Você já contestou esta cobrança
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
              {autoCaptureContest.status === "RESOLVED"
                ? "Um administrador já analisou e resolveu o caso."
                : "Um administrador vai analisar antes da cobrança ficar definitiva — nada mais a fazer por aqui."}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      </ScreenEntrance>

      {/* Cobre a tela durante o cancelamento — a chamada pode levar alguns
          segundos (depende do processamento do pagamento por baixo dos
          panos) e sem isso o card de código/QR continuava fazendo polling
          em paralelo, piscando entre estados enquanto o cancelamento rolava. */}
      {/* Achado em teste manual (2026-10-16): só "Cancelar" tinha esse popup
          bloqueante — "Reportar falta"/contestações mostravam só um texto
          tímido no próprio botão ("Reportando...", opacidade reduzida),
          fácil de não perceber que algo está acontecendo de verdade. */}
      <Modal
        visible={cancelling || reportingNoShow || contestingNoShow || contestingAutoCapture || withdrawingNoShow}
        transparent
        animationType="fade"
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 32 }}>
          <View style={{ backgroundColor: theme.cardBg, borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, padding: 24, alignItems: "center", gap: 14, width: "100%", maxWidth: 320 }}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, textAlign: "center" }}>
              {cancelling
                ? "Cancelando agendamento..."
                : reportingNoShow
                  ? "Registrando o relato de falta..."
                  : withdrawingNoShow
                    ? "Retirando o relato..."
                    : "Enviando sua contestação..."}
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center" }}>
              {cancelling
                ? "Aguarde um instante enquanto processamos o cancelamento e o reembolso, se houver."
                : "Aguarde um instante, isso não demora."}
            </Text>
          </View>
        </View>
      </Modal>
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
