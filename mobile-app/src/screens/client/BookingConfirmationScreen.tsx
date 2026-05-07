import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
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
import { MvBadge, MvButton, MvCard, MvText } from "../../components/mv";
import { formatBRDateTime, formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

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

  const [booking, setBooking] = useState<Booking | null>(null);
  const [payment, setPayment] = useState<PaymentStatusResponse | null>(null);
  const [pixCharge, setPixCharge] = useState<PixChargeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [pixCharging, setPixCharging] = useState(false);
  const [checkingPix, setCheckingPix] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const hasShownChatModalRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [bookings, paymentStatus] = await Promise.all([
        runWithAuth((token) => bookingsApi.me(token)),
        runWithAuth((token) => paymentsApi.bookingPayment(token, bookingId)),
      ]);
      setBooking(bookings.find((item) => item.id === bookingId) ?? null);
      setPayment(paymentStatus);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar confirmação do serviço.", navigation });
    } finally {
      setLoading(false);
    }
  }, [bookingId, navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (booking && !hasShownChatModalRef.current) {
      hasShownChatModalRef.current = true;
      setShowChatModal(true);
    }
  }, [booking]);

  // Auto-poll PIX payment status every 5 seconds until confirmed
  useEffect(() => {
    if (payment?.method !== "PIX" || payment?.status === "CAPTURED") return;
    const interval = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(interval);
  }, [payment?.method, payment?.status, load]);

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
      await load();
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
      await load();
      if (payment?.status === "CAPTURED") {
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
        <MvText variant="body3" color="secondary">Carregando resumo...</MvText>
      </View>
    );
  }

  if (!booking) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <MvText variant="body3" color="secondary">Serviço não encontrado.</MvText>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="h4">Confirmação</MvText>
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
          <View style={{ backgroundColor: theme.cardBg, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 22, width: "100%", maxWidth: 400, gap: 16 }}>
            <View style={{ alignItems: "center", gap: 10 }}>
              <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: theme.chipBg, borderWidth: 1, borderColor: "rgba(34,197,94,0.25)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="checkmark" size={28} color={theme.textGreen} />
              </View>
              <MvText variant="h4" style={{ textAlign: "center" }}>{chatModalTitle}</MvText>
              <MvText variant="body3" color="secondary" style={{ textAlign: "center" }}>
                {chatModalMessage}
              </MvText>
            </View>
            <MvButton
              label="Ir para o chat"
              onPress={() => {
                setShowChatModal(false);
                navigation.navigate("ClientChatList");
              }}
            />
            <MvButton
              variant="outline"
              label="Agora não"
              onPress={() => setShowChatModal(false)}
            />
          </View>
        </View>
      </Modal>

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        {/* Cabeçalho de sucesso */}
        <View style={{ alignItems: "center", paddingVertical: 16, gap: 8 }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: theme.chipBg, borderWidth: 1, borderColor: "rgba(34,197,94,0.25)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="checkmark" size={28} color={theme.textGreen} />
          </View>
          <MvText variant="h4">Confirmação concluída</MvText>
          <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
            {hasMultipleBookings
              ? `Mostrando um dos ${bookingCount} agendamentos criados. Abra Meus agendamentos para ver a lista completa.`
              : "Revise os dados do serviço e siga para os próximos passos."}
          </MvText>
        </View>

        {hasPartialAvailability ? (
          <MvCard>
            <MvText variant="semi3" style={{ marginBottom: 6 }}>
              Algumas datas ficaram indisponíveis
            </MvText>
            <MvText variant="body4" color="secondary">
              Foram criados {bookingCount} agendamentos com sucesso. Use o chat para alinhar novas datas para os horários que não foram reservados.
            </MvText>
          </MvCard>
        ) : null}

        {/* Resumo */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 8 }}>
            {hasMultipleBookings ? "Resumo de um agendamento" : "Resumo da contratação"}
          </MvText>
          <MvText variant="body4" color="secondary">Profissional: {booking.provider?.displayName ?? "Profissional"}</MvText>
          <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>Data e hora: {formatBRDateTime(booking.scheduledAt)}</MvText>
          {booking.notes ? (
            <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>Observações: {booking.notes}</MvText>
          ) : null}
        </MvCard>

        {/* Pagamento */}
        <MvCard>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <MvText variant="semi2">Status de pagamento</MvText>
            <MvBadge label={paymentLabel(payment?.status)} variant={paymentVariant(payment?.status)} />
          </View>
          <MvText variant="body4" color="secondary">
            Valor: {formatCurrencyBRL((payment?.amountCents ?? 0) / 100)}
          </MvText>
          <MvText variant="body4" color="secondary" style={{ marginTop: 6 }}>
            {payment?.method === "PIX"
              ? "No PIX, a cobrança acontece por QR Code/cópia e cola. Em cancelamento, o valor é estornado."
              : "No cartão, a cobrança fica pré-autorizada e é capturada após a conclusão do atendimento."}
          </MvText>

          {payment?.method === "PIX" ? (
            <View style={{ marginTop: 12, gap: 8 }}>
              <MvButton
                label={payment.status === "CAPTURED" ? "PIX já confirmado" : "Gerar cobrança PIX"}
                disabled={payment.status === "CAPTURED"}
                loading={pixCharging}
                onPress={() => void startPixCharge()}
              />
              {pixCharge?.pix?.copyAndPasteCode ? (
                <MvCard>
                  <MvText variant="semi3" style={{ marginBottom: 4 }}>Código PIX (cópia e cola)</MvText>
                  <MvText variant="body4" color="secondary" selectable>{pixCharge.pix.copyAndPasteCode}</MvText>
                </MvCard>
              ) : null}
              {pixCharge?.pix?.hostedInstructionsUrl ? (
                <MvButton
                  variant="outline"
                  label="Abrir instruções PIX"
                  onPress={() => void Linking.openURL(pixCharge.pix!.hostedInstructionsUrl!)}
                />
              ) : null}
              {payment.status !== "CAPTURED" ? (
                <MvButton
                  variant="outline"
                  label="Verificar se PIX foi pago"
                  loading={checkingPix}
                  onPress={() => void checkPixStatus()}
                />
              ) : null}
            </View>
          ) : null}
        </MvCard>

        {/* Ações */}
        <View style={{ gap: 10 }}>
          <MvButton
            label="Ver meus agendamentos"
            loading={confirming}
            disabled={!canConfirm || confirming}
            onPress={() => void confirmBooking()}
          />
          <MvButton variant="outline" label="Voltar" onPress={() => navigation.goBack()} />
        </View>
      </ScrollView>
    </View>
  );
}

