import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";
import { ClientStackParamList } from "../../navigation/route-types";
import {
  AttendanceCodeResponse,
  bookingsApi,
  Booking,
  paymentsApi,
  PaymentStatusResponse,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvText } from "../../components/mv";
import { formatBRDate, formatBRDateTime, formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ClientStackParamList, "ClientBookingDetail">;

function bookingBadge(status: Booking["status"]): { label: string; variant: "green" | "orange" | "red" | "gray" } {
  if (status === "COMPLETED") return { label: "Concluído", variant: "green" };
  if (status === "CANCELLED") return { label: "Cancelado", variant: "red" };
  if (status === "CONFIRMED") return { label: "Confirmado", variant: "green" };
  return { label: "Pendente", variant: "orange" };
}

function paymentBadge(status?: PaymentStatusResponse["status"]): { label: string; variant: "green" | "orange" | "red" | "gray" | "blue" } {
  if (!status) return { label: "Sem status", variant: "gray" };
  if (status === "CAPTURED") return { label: "Capturado", variant: "green" };
  if (status === "FAILED" || status === "CANCELED") return { label: "Falhou/Cancelado", variant: "red" };
  if (status === "REFUNDED") return { label: "Estornado", variant: "orange" };
  return { label: "Pré-autorizado", variant: "blue" };
}

export function ClientBookingDetailScreen({ route, navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const bookingId = route.params.bookingId;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [payment, setPayment] = useState<PaymentStatusResponse | null>(null);
  const [attendance, setAttendance] = useState<AttendanceCodeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [attendanceLoading, setAttendanceLoading] = useState(false);

  const loadAttendance = useCallback(async (targetBooking: Booking | null) => {
    if (!targetBooking || (targetBooking.status !== "PENDING" && targetBooking.status !== "CONFIRMED")) {
      setAttendance(null);
      return;
    }
    try {
      setAttendanceLoading(true);
      const payload = await runWithAuth((token) => bookingsApi.attendanceCode(token, targetBooking.id));
      setAttendance(payload);
    } catch {
      setAttendance(null);
    } finally {
      setAttendanceLoading(false);
    }
  }, [runWithAuth]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [bookings, paymentStatus] = await Promise.all([
        runWithAuth((token) => bookingsApi.me(token)),
        runWithAuth((token) => paymentsApi.bookingPayment(token, bookingId)),
      ]);
      const foundBooking = bookings.find((item) => item.id === bookingId) ?? null;
      setBooking(foundBooking);
      setPayment(paymentStatus);
      await loadAttendance(foundBooking);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar detalhes do agendamento.", navigation });
    } finally {
      setLoading(false);
    }
  }, [bookingId, loadAttendance, navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

  const bookingStatus = useMemo(() => (booking ? bookingBadge(booking.status) : null), [booking]);
  const paymentStatus = useMemo(() => paymentBadge(payment?.status), [payment?.status]);

  async function updateStatus(next: "CANCELLED" | "COMPLETED") {
    if (!booking) return;
    try {
      setUpdating(true);
      const updated = await runWithAuth((token) => bookingsApi.updateStatus(token, booking.id, next));
      setBooking(updated);
      showToast("Status atualizado com sucesso.", "success");
      if (next === "COMPLETED") {
        navigation.navigate("ClientConfirmCompletion", { bookingId: booking.id });
        return;
      }
      await load();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível atualizar status do agendamento.", navigation });
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <MvText variant="body3" color="secondary">Carregando detalhes...</MvText>
      </View>
    );
  }

  if (!booking) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <MvText variant="body3" color="secondary">Agendamento não encontrado.</MvText>
      </View>
    );
  }

  const isActive = booking.status === "PENDING" || booking.status === "CONFIRMED";

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.booking-detail">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="h4" numberOfLines={1} style={{ flex: 1 }}>
          {booking.provider?.displayName ?? "Agendamento"} · {formatBRDate(booking.scheduledAt)}
        </MvText>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        {/* Status do atendimento */}
        <MvCard>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <MvText variant="semi2">Status do atendimento</MvText>
            {bookingStatus ? <MvBadge label={bookingStatus.label} variant={bookingStatus.variant} /> : null}
          </View>
          <MvText variant="body4" color="secondary">Data: {formatBRDateTime(booking.scheduledAt)}</MvText>
          <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
            Observações: {booking.notes ?? "Sem observações"}
          </MvText>
        </MvCard>

        {/* Pagamento */}
        <MvCard>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <MvText variant="semi2">Pagamento</MvText>
            <MvBadge label={paymentStatus.label} variant={paymentStatus.variant} />
          </View>
          <MvText variant="body4" color="secondary">
            Valor: {formatCurrencyBRL((payment?.amountCents ?? 0) / 100)}
          </MvText>
        </MvCard>

        {/* Validação presencial */}
        {isActive ? (
          <MvCard>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <MvText variant="semi2">Validação presencial</MvText>
              <MvBadge
                label={attendance?.validated ? "Validado" : "Pendente"}
                variant={attendance?.validated ? "green" : "orange"}
              />
            </View>

            {attendanceLoading ? (
              <MvText variant="body4" color="secondary">Atualizando código/QR...</MvText>
            ) : attendance?.available ? (
              <View style={{ gap: 6 }}>
                <MvText variant="body4" color="secondary">Código: {attendance.code ?? "------"}</MvText>
                <MvText variant="body4" color="secondary">
                  Opção 2: mostre o QR no app para leitura rápida do profissional.
                </MvText>
                {attendance.qrDeepLink || attendance.qrToken ? (
                  <View style={{ marginVertical: 8, padding: 12, borderRadius: 11, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, alignItems: "center" }}>
                    <QRCode
                      backgroundColor="transparent"
                      color={theme.text1}
                      size={160}
                      value={attendance.qrDeepLink ?? attendance.qrToken ?? "-"}
                    />
                  </View>
                ) : null}
                <MvText variant="body4" color="secondary">
                  Expira em: {formatBRDateTime(attendance.expiresAt)}
                </MvText>
              </View>
            ) : (
              <MvText variant="body4" color="secondary">
                Código/QR liberados automaticamente 10 minutos antes da aula.
              </MvText>
            )}

            <MvButton
              variant="outline"
              label="Atualizar código/QR"
              style={{ marginTop: 10, alignSelf: "flex-start" }}
              onPress={() => void loadAttendance(booking)}
            />
          </MvCard>
        ) : null}

        {/* Chat */}
        {isActive ? (
          <MvButton
            variant="outline"
            label="💬  Chat com o personal"
            onPress={() => navigation.navigate("ClientChatList")}
          />
        ) : null}

        {/* Ações */}
        {isActive ? (
          <View style={{ gap: 10 }}>
            <MvButton
              label="Confirmar conclusão"
              loading={updating}
              onPress={() => void updateStatus("COMPLETED")}
            />
            <MvButton
              variant="outline"
              label="Cancelar agendamento"
              loading={updating}
              onPress={() => void updateStatus("CANCELLED")}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
