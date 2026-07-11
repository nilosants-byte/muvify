import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { Linking, Modal, Pressable, ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import {
  bookingsApi,
  Booking,
  paymentsApi,
  PaymentStatusResponse,
  PixChargeResponse,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { formatBRDateTime, formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { PressableScale } from "../../components/polish/PressableScale";
import { hapticPaymentSuccess, hapticCta } from "../../utils/haptics";

type Props = NativeStackScreenProps<ClientStackParamList, "BookingConfirmation">;


function paymentLabel(status?: PaymentStatusResponse["status"]) {
  if (!status) return "Sem status";
  const map: Record<PaymentStatusResponse["status"], string> = {
    PENDING_AUTH: "Aguardando pré-autorização",
    AUTHORIZING: "Autorizando",
    AUTHORIZED: "Pré-autorizado",
    CAPTURED: "Capturado",
    CANCELED: "Cancelado",
    REFUNDED: "Estornado",
    FAILED: "Falha",
  };
  return map[status];
}

function paymentVariant(status?: PaymentStatusResponse["status"]): "green" | "orange" | "red" | "blue" | "gray" {
  if (!status) return "gray";
  if (status === "CAPTURED") return "green";
  if (status === "FAILED" || status === "CANCELED" || status === "REFUNDED") return "red";
  return "orange";
}

export function BookingConfirmationScreen({ navigation, route }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const bookingId = route.params.bookingId;
  const bookingCount = route.params.bookingCount ?? 1;
  const failedCount = route.params.failedCount ?? 0;
  const hasMultipleBookings = bookingCount > 1;
  const hasPartialAvailability = failedCount > 0;

  const [payment, setPayment] = useState<PaymentStatusResponse | null>(null);
  const [pixCharge, setPixCharge] = useState<PixChargeResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pixCharging, setPixCharging] = useState(false);
  const [checkingPix, setCheckingPix] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [pixPollError, setPixPollError] = useState(false);
  const hasShownChatModalRef = useRef(false);
  const pixFailCountRef = useRef(0);

  const confirmationQuery = useAuthQuery(
    queryKeys.bookings.detail(bookingId),
    async (token) => {
      const [bookings, paymentStatus] = await Promise.all([
        bookingsApi.me(token),
        paymentsApi.bookingPayment(token, bookingId),
      ]);
      return { booking: bookings.find((item) => item.id === bookingId) ?? null, payment: paymentStatus };
    }
  );

  const loading = confirmationQuery.isLoading;
  const booking = confirmationQuery.data?.booking ?? null;

  useEffect(() => {
    if (confirmationQuery.data?.payment) setPayment(confirmationQuery.data.payment);
  }, [confirmationQuery.data]);

  useEffect(() => {
    if (confirmationQuery.error) {
      handleScreenError({ error: confirmationQuery.error, showToast, fallbackMessage: "Falha ao carregar confirmação do serviço.", navigation });
    }
  }, [confirmationQuery.error, showToast, navigation]);

  const checkPaymentOnly = useCallback(async () => {
    try {
      const paymentStatus = await runWithAuth((token) => paymentsApi.bookingPayment(token, bookingId));
      pixFailCountRef.current = 0;
      setPixPollError(false);
      setPayment(paymentStatus);
      if (paymentStatus.status === "CAPTURED") hapticPaymentSuccess();
    } catch {
      pixFailCountRef.current += 1;
      if (pixFailCountRef.current >= 3) setPixPollError(true);
    }
  }, [bookingId, runWithAuth]);

  useEffect(() => {
    if (booking?.status === "CONFIRMED" && !hasShownChatModalRef.current) {
      hasShownChatModalRef.current = true;
      setShowChatModal(true);
    }
  }, [booking?.status]);

  // Auto-poll PIX payment status every 5 seconds until confirmed or 3 consecutive failures
  useEffect(() => {
    if (payment?.method !== "PIX" || payment?.status === "CAPTURED" || pixPollError) return;
    const interval = setInterval(() => { void checkPaymentOnly(); }, 5000);
    return () => clearInterval(interval);
  }, [payment?.method, payment?.status, checkPaymentOnly, pixPollError]);

  const providerDisplayName = booking?.provider?.displayName ?? "o profissional";
  const chatModalTitle = hasMultipleBookings
    ? `${bookingCount} agendamentos realizados!`
    : "Agendamento realizado!";
  const chatModalMessage = useMemo(() => {
    if (hasMultipleBookings && hasPartialAvailability) {
      return `Boa! Você criou ${bookingCount} agendamentos com ${providerDisplayName}. Algumas datas ficaram indisponíveis, e o chat é o melhor caminho para combinar os próximos horários.`;
    }
    if (hasMultipleBookings) {
      return `Boa! Você criou ${bookingCount} agendamentos com ${providerDisplayName}. Abra o chat para alinhar detalhes do atendimento, objetivos e próximos passos.`;
    }
    return `Que ótimo! Aproveite para falar com ${providerDisplayName} no chat e alinhar os detalhes do atendimento antes da sessão.`;
  }, [bookingCount, hasMultipleBookings, hasPartialAvailability, providerDisplayName]);

  const canConfirm = useMemo(
    () =>
      hasMultipleBookings ||
      Boolean(booking && (booking.status === "PENDING" || booking.status === "CONFIRMED")),
    [booking, hasMultipleBookings]
  );

  async function confirmBooking() {
    hapticPaymentSuccess(); // Momento 2 — pagamento confirmado
    if (hasMultipleBookings) {
      const parent = navigation.getParent();
      if (parent) {
        parent.navigate("ClientBookings" as never);
      } else {
        navigation.navigate("ClientBookings");
      }
      return;
    }

    if (!booking) return;
    try {
      setConfirming(true);
      await runWithAuth((token) => bookingsApi.updateStatus(token, booking.id, "CONFIRMED"));
      showToast("Serviço confirmado com sucesso.", "success");
      const parent = navigation.getParent();
      if (parent) { parent.navigate("ClientBookings" as never); } else { navigation.goBack(); }
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível confirmar o serviço.", navigation });
    } finally {
      setConfirming(false);
    }
  }

  async function startPixCharge() {
    try {
      setPixCharging(true);
      const result = await runWithAuth((token) => paymentsApi.createPixCharge(token, bookingId));
      setPixCharge(result);
      void confirmationQuery.refetch();
      showToast("Cobrança PIX criada. Finalize para liberar a conclusão.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível iniciar cobrança PIX.", navigation });
    } finally {
      setPixCharging(false);
    }
  }

  async function checkPixStatus() {
    try {
      setCheckingPix(true);
      const result = await confirmationQuery.refetch();
      if (result.data?.payment?.status === "CAPTURED") {
        showToast("Pagamento PIX confirmado!", "success");
      } else {
        showToast("Pagamento ainda não confirmado. Tente novamente em instantes.", "info");
      }
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível verificar o pagamento.", navigation });
    } finally {
      setCheckingPix(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.text2 }}>Carregando resumo...</Text>
      </View>
    );
  }

  if (!booking) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.text2 }}>Serviço não encontrado.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Confirmação</Text>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={showChatModal}
        onRequestClose={() => setShowChatModal(false)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
          <Pressable
            style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
            onPress={() => setShowChatModal(false)}
          />
          <View style={{ backgroundColor: theme.inputBg, borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, padding: 22, width: "100%", maxWidth: 400, gap: 14 }}>
            <View style={{ alignItems: "center", gap: 10 }}>
              <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="checkmark" size={28} color={theme.primary} />
              </View>
              <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.02 * 20, textAlign: "center" }}>{chatModalTitle}</Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center", lineHeight: 20 }}>{chatModalMessage}</Text>
            </View>
            <TouchableOpacity
              onPress={() => { setShowChatModal(false); navigation.navigate("ClientChatList"); }}
              style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
            >
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>Ir para o chat</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowChatModal(false)}
              style={{ height: S.touchMin, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>Agora não</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 40, gap: 14, paddingTop: 16 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        {/* Cabeçalho de sucesso V2 */}
        <View style={{ alignItems: "center", paddingVertical: 16, gap: 10 }}>
          <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: 0.3, shadowRadius: 16, elevation: 6 }}>
            <Ionicons name="checkmark" size={36} color={theme.primary} />
          </View>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 26, color: theme.text1, letterSpacing: -0.02 * 26, textAlign: "center" }}>
            {hasMultipleBookings ? `${bookingCount} agendamentos criados!` : "Agendamento confirmado!"}
          </Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center", lineHeight: 20 }}>
            {hasMultipleBookings
              ? `Mostrando um dos ${bookingCount} agendamentos. Abra Minha agenda para ver a lista completa.`
              : "Revise os dados e siga para os próximos passos."}
          </Text>
        </View>

        {/* Aviso de disponibilidade parcial */}
        {hasPartialAvailability ? (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: C.amberBorder, backgroundColor: C.amberDim, padding: 14, gap: 6 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>Algumas datas ficaram indisponíveis</Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, lineHeight: 20 }}>
              Foram criados {bookingCount} agendamentos com sucesso. Use o chat para alinhar novas datas.
            </Text>
          </View>
        ) : null}

        {/* Resumo */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 6 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, marginBottom: 4 }}>
            {hasMultipleBookings ? "Resumo de um agendamento" : "Resumo da contratação"}
          </Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>Profissional: {booking.provider?.displayName ?? "Profissional"}</Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>Data e hora: {formatBRDateTime(booking.scheduledAt)}</Text>
          {booking.notes ? (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>Observações: {booking.notes}</Text>
          ) : null}
        </View>

        {/* Pagamento */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Status de pagamento</Text>
            {(() => {
              const v = paymentVariant(payment?.status);
              const col = v === "green" ? theme.primary : v === "red" ? theme.danger : C.amber;
              const bg = v === "green" ? theme.primarySubtle : v === "red" ? "rgba(239,68,68,0.12)" : C.amberDim;
              const border = v === "green" ? theme.primarySubtleBorder : v === "red" ? "rgba(239,68,68,0.20)" : C.amberBorder;
              return (
                <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: col }}>{paymentLabel(payment?.status)}</Text>
                </View>
              );
            })()}
          </View>
          {payment?.amountCents != null ? (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>
              Valor: {formatCurrencyBRL(payment.amountCents / 100)}
            </Text>
          ) : (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>
              Aguardando processamento do pagamento...
            </Text>
          )}
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, lineHeight: 18 }}>
            {payment?.method === "PIX"
              ? "No PIX, a cobrança acontece por QR Code/cópia e cola. Em cancelamento, o valor é estornado."
              : "No cartão, a cobrança fica pré-autorizada e é capturada após a conclusão do atendimento."}
          </Text>

          {payment?.method === "PIX" ? (() => {
            const pixPaid = payment.status === "CAPTURED";
            const pixExpiresMs = pixCharge?.pix?.expiresAt ? new Date(pixCharge.pix.expiresAt).getTime() : NaN;
            const pixExpired = Number.isFinite(pixExpiresMs) && pixExpiresMs < Date.now();
            return (
              <View style={{ marginTop: 4, gap: 8 }}>
                {pixPollError && !pixPaid ? (
                  <TouchableOpacity
                    onPress={() => { pixFailCountRef.current = 0; setPixPollError(false); void checkPaymentOnly(); }}
                    style={{ borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}
                  >
                    <Ionicons name="wifi-outline" size={18} color={theme.text3} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>Falha ao verificar pagamento</Text>
                      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>Toque para tentar novamente.</Text>
                    </View>
                  </TouchableOpacity>
                ) : null}
                {pixExpired && !pixPaid ? (
                  <View style={{ borderRadius: 12, borderWidth: 1, borderColor: C.amberBorder, backgroundColor: C.amberDim, padding: 12, gap: 4 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>PIX expirado</Text>
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
                      {Number.isFinite(pixExpiresMs)
                        ? `Expirou em ${new Date(pixExpiresMs).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })} de ${new Date(pixExpiresMs).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })}. `
                        : ""}
                      Gere um novo código para continuar.
                    </Text>
                  </View>
                ) : null}
                <TouchableOpacity
                  disabled={pixPaid || pixCharging}
                  onPress={() => void startPixCharge()}
                  style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: pixPaid ? "rgba(255,255,255,0.06)" : theme.primary, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: pixPaid ? theme.text3 : theme.textOnPrimary }}>
                    {pixCharging ? "Gerando..." : pixPaid ? "PIX já confirmado" : pixExpired ? "Gerar novo PIX" : "Gerar cobrança PIX"}
                  </Text>
                </TouchableOpacity>
                {pixCharge?.pix?.copyAndPasteCode && !pixExpired ? (
                  <View style={{ borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, padding: 12, gap: 6 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>Código PIX (cópia e cola)</Text>
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: C.zinc300 }} selectable>{pixCharge.pix.copyAndPasteCode}</Text>
                  </View>
                ) : null}
                {pixCharge?.pix?.hostedInstructionsUrl && !pixExpired ? (
                  <TouchableOpacity onPress={() => void Linking.openURL(pixCharge.pix!.hostedInstructionsUrl!)} style={{ height: S.touchMin, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.04)", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>Abrir instruções PIX</Text>
                  </TouchableOpacity>
                ) : null}
                {!pixPaid && !pixExpired ? (
                  <TouchableOpacity disabled={checkingPix} onPress={() => void checkPixStatus()} style={{ height: S.touchMin, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.04)", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>{checkingPix ? "Verificando..." : "Verificar se PIX foi pago"}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })() : null}
        </View>

        {/* Chat com o personal — sempre visível, não depende do modal */}
        <PressableScale
          onPress={() => navigation.navigate("ClientChatList")}
          style={{
            borderRadius: S.cardR, borderWidth: 1, borderColor: theme.primarySubtleBorder,
            backgroundColor: "rgba(36,230,109,0.09)", padding: 14,
            flexDirection: "row", alignItems: "center", gap: 12,
          }}
        >
          <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Ionicons name="chatbubbles-outline" size={20} color={theme.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>
              Falar com {providerDisplayName}
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 2 }}>
              Alinhe horário, local e objetivos antes da sessão
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.primary} />
        </PressableScale>

        {/* Ações */}
        <View style={{ gap: 10 }}>
          {payment?.status === "FAILED" ? (
            <>
              <TouchableOpacity
                onPress={() => navigation.navigate("ClientPaymentMethod")}
                style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>Verificar método de pagamento</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.goBack()} style={{ height: S.touchMin, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>Voltar ao agendamento</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                disabled={!canConfirm || confirming}
                onPress={() => void confirmBooking()}
                accessibilityRole="button"
                style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: (!canConfirm || confirming) ? "rgba(36,230,109,0.4)" : theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: (!canConfirm || confirming) ? 0 : 0.28, shadowRadius: 10, elevation: (!canConfirm || confirming) ? 0 : 4 }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>
                  {confirming ? "Abrindo agenda..." : "Ver meus agendamentos"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.goBack()} style={{ height: S.touchMin, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>Voltar</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

