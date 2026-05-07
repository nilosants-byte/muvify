import React, { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { Booking, bookingsApi, paymentsApi, PaymentStatusResponse } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { formatBRDateTime } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "BookingDetailProfessional">;

function bookingBadge(status: Booking["status"]): { label: string; variant: "green" | "orange" | "red" | "gray" } {
  if (status === "COMPLETED") return { label: "Concluído", variant: "green" };
  if (status === "CANCELLED") return { label: "Cancelado", variant: "red" };
  if (status === "CONFIRMED") return { label: "Confirmado", variant: "green" };
  return { label: "Pendente", variant: "orange" };
}

function paymentBadge(status: PaymentStatusResponse["status"]): { label: string; variant: "green" | "orange" | "red" | "blue" | "gray" } {
  if (status === "CAPTURED") return { label: "Capturado", variant: "green" };
  if (status === "CANCELED" || status === "FAILED") return { label: "Falhou/Cancelado", variant: "red" };
  if (status === "REFUNDED") return { label: "Estornado", variant: "orange" };
  if (status === "AUTHORIZED") return { label: "Pré-autorizado", variant: "blue" };
  if (status === "AUTHORIZING") return { label: "Autorizando", variant: "blue" };
  return { label: "Pré-autorização pendente", variant: "orange" };
}

function extractQrTokenFromPayload(payload: string) {
  const raw = payload.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const tokenFromQuery = parsed.searchParams.get("token");
    if (tokenFromQuery) return decodeURIComponent(tokenFromQuery);
  } catch { /* raw can be plain token */ }
  const tokenMatch = raw.match(/[?&]token=([^&]+)/i);
  if (tokenMatch?.[1]) return decodeURIComponent(tokenMatch[1]);
  return raw;
}

export function BookingDetailProfessionalScreen({ route, navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const bookingId = route.params.bookingId;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [payment, setPayment] = useState<PaymentStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [attendanceCode, setAttendanceCode] = useState("");
  const [attendanceQrToken, setAttendanceQrToken] = useState("");
  const [validatingAttendance, setValidatingAttendance] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerReadLock, setScannerReadLock] = useState(false);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [bookings, paymentInfo] = await Promise.all([
        runWithAuth((token) => bookingsApi.me(token)),
        runWithAuth((token) => paymentsApi.bookingPayment(token, bookingId)),
      ]);
      setBooking(bookings.find((item) => item.id === bookingId) ?? null);
      setPayment(paymentInfo);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar agendamento.", navigation });
    } finally {
      setLoading(false);
    }
  }, [bookingId, navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

  async function updateStatus(status: "CONFIRMED" | "CANCELLED" | "COMPLETED") {
    try {
      setUpdating(true);
      await runWithAuth((token) => bookingsApi.updateStatus(token, bookingId, status));
      showToast("Status atualizado.", "success");
      setCancelModalVisible(false);
      await load();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao atualizar status.", navigation });
    } finally {
      setUpdating(false);
    }
  }

  async function validateAttendanceCode() {
    const normalized = attendanceCode.replace(/\D/g, "");
    if (normalized.length !== 6) { showToast("Informe o código de 6 dígitos.", "error"); return; }
    try {
      setValidatingAttendance(true);
      await runWithAuth((token) => bookingsApi.verifyAttendanceCode(token, bookingId, normalized));
      showToast("Código presencial validado com sucesso.", "success");
      setAttendanceCode(normalized);
      await load();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao validar código presencial.", navigation });
    } finally {
      setValidatingAttendance(false);
    }
  }

  async function validateAttendanceQr(tokenOverride?: string) {
    const qrToken = (tokenOverride ?? attendanceQrToken).trim();
    if (!qrToken) { showToast("Informe o token do QR para validar.", "error"); return; }
    try {
      setValidatingAttendance(true);
      await runWithAuth((token) => bookingsApi.verifyAttendanceQr(token, bookingId, qrToken));
      showToast("QR validado com sucesso.", "success");
      setAttendanceQrToken(qrToken);
      await load();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao validar QR do atendimento.", navigation });
    } finally {
      setValidatingAttendance(false);
    }
  }

  async function openQrScanner() {
    if (!cameraPermission?.granted) {
      const requested = await requestCameraPermission();
      if (!requested.granted) { showToast("Permissão de câmera necessária para ler QR Code.", "error"); return; }
    }
    setScannerReadLock(false);
    setScannerVisible(true);
  }

  function onQrScanned(rawData: string) {
    if (scannerReadLock) return;
    const token = extractQrTokenFromPayload(rawData);
    if (!token) { showToast("QR inválido. Tente novamente.", "error"); return; }
    setScannerReadLock(true);
    setScannerVisible(false);
    setAttendanceQrToken(token);
    showToast("QR lido. Validando...", "info");
    void validateAttendanceQr(token);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <MvText variant="body3" color="secondary">Carregando agendamento...</MvText>
      </View>
    );
  }

  if (!booking) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <MvText variant="body3" color="secondary">Agendamento não encontrado.</MvText>
        <MvButton variant="outline" label="Voltar" style={{ marginTop: 16 }} onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const bkBadge = bookingBadge(booking.status);
  const pmBadge = payment ? paymentBadge(payment.status) : null;
  const isActive = booking.status === "PENDING" || booking.status === "CONFIRMED";

  return (
    <>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="chevron-back" size={20} color={theme.text2} />
          </TouchableOpacity>
          <MvText variant="semi1">Detalhe do atendimento</MvText>
        </View>

        <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
          <MvText variant="body4" color="secondary">Agendamento {booking.id.slice(0, 8)}</MvText>

          {/* Info do cliente */}
          <MvCard>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <MvText variant="semi2">Cliente</MvText>
              <MvBadge label={bkBadge.label} variant={bkBadge.variant} />
            </View>
            <MvText variant="body4" color="secondary">{booking.client?.name ?? "Cliente"}</MvText>
            <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
              {formatBRDateTime(booking.scheduledAt)}
            </MvText>
            <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
              Categoria: {booking.category?.name ?? "-"}
            </MvText>
            <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
              Observações: {booking.notes ?? "Sem observações"}
            </MvText>
          </MvCard>

          {/* Pagamento */}
          {pmBadge ? (
            <MvCard>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <MvText variant="semi2">Pagamento</MvText>
                <MvBadge label={pmBadge.label} variant={pmBadge.variant} />
              </View>
              <MvButton
                variant="outline"
                label="Abrir status completo"
                onPress={() => navigation.navigate("BookingPaymentStatus", { bookingId })}
              />
            </MvCard>
          ) : null}

          {/* Validação presencial */}
          {isActive ? (
            <MvCard>
              <MvText variant="semi2" style={{ marginBottom: 6 }}>Validação presencial</MvText>
              <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
                Valide por código de 6 dígitos informado pelo aluno ou via QR Code da aula.
              </MvText>

              <MvInput
                keyboardType="number-pad"
                placeholder="Código de 6 dígitos"
                maxLength={6}
                value={attendanceCode}
                onChangeText={(value) => setAttendanceCode(value.replace(/\D/g, "").slice(0, 6))}
              />
              <MvButton
                variant="outline"
                label="Validar código"
                loading={validatingAttendance}
                style={{ marginTop: 8 }}
                onPress={() => void validateAttendanceCode()}
              />

              <MvInput
                autoCapitalize="none"
                placeholder="Token QR (cole ou escaneie)"
                value={attendanceQrToken}
                onChangeText={setAttendanceQrToken}
                style={{ marginTop: 12 }}
              />
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <MvButton
                  variant="outline"
                  label="Ler QR pela câmera"
                  loading={validatingAttendance}
                  onPress={() => void openQrScanner()}
                />
                <MvButton
                  variant="outline"
                  label="Validar QR"
                  loading={validatingAttendance}
                  onPress={() => void validateAttendanceQr()}
                />
              </View>
            </MvCard>
          ) : null}

          {/* Acesso rápido ao aluno */}
          {isActive ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <MvButton
                style={{ flex: 1 }}
                label="💬  Chat"
                onPress={() => navigation.navigate("ProfessionalChatList")}
              />
              {booking.client?.id ? (
                <MvButton
                  style={{ flex: 1 }}
                  variant="outline"
                  label="📋  Anamnese"
                  onPress={() =>
                    navigation.navigate("ProfessionalStudentAnamnesis", {
                      clientId: booking.client!.id,
                      clientName: booking.client?.name ?? "Aluno",
                    })
                  }
                />
              ) : null}
            </View>
          ) : null}

          {/* Ações */}
          <View style={{ gap: 10 }}>
            {booking.status === "PENDING" ? (
              <MvButton label="Confirmar agendamento" loading={updating} onPress={() => void updateStatus("CONFIRMED")} />
            ) : null}

            {booking.status === "CONFIRMED" ? (
              <MvButton
                label="Confirmar conclusão"
                variant="outline"
                onPress={() => navigation.navigate("ProfessionalConfirmCompletion", { bookingId })}
              />
            ) : null}

            {isActive ? (
              <MvButton
                variant="danger"
                label="Cancelar agendamento"
                loading={updating}
                onPress={() => setCancelModalVisible(true)}
              />
            ) : null}

            <MvButton variant="outline" label="Atualizar" onPress={() => void load()} />
          </View>
        </ScrollView>
      </View>

      {/* Cancel confirmation modal */}
      <Modal animationType="fade" transparent visible={cancelModalVisible} onRequestClose={() => setCancelModalVisible(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 }}
          onPress={() => setCancelModalVisible(false)}
        >
          <Pressable
            style={{ width: "90%", maxWidth: 340, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 24, gap: 12 }}
            onPress={(e) => e.stopPropagation()}
          >
            <MvText variant="semi1">Cancelar agendamento</MvText>
            <MvText variant="body4" color="secondary">Deseja cancelar este agendamento? Esta ação não pode ser desfeita.</MvText>
            <View style={{ gap: 8, marginTop: 4 }}>
              <MvButton variant="danger" label="Sim, cancelar" loading={updating} onPress={() => void updateStatus("CANCELLED")} />
              <MvButton variant="outline" label="Não, manter" onPress={() => setCancelModalVisible(false)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* QR Scanner modal */}
      <Modal animationType="slide" transparent visible={scannerVisible} onRequestClose={() => setScannerVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 }}>
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 16, gap: 12 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <MvText variant="semi2">Escanear QR da aula</MvText>
              <TouchableOpacity onPress={() => setScannerVisible(false)}>
                <MvText variant="semi3" style={{ color: theme.textGreen }}>Fechar</MvText>
              </TouchableOpacity>
            </View>
            <View style={{ borderRadius: 12, overflow: "hidden", height: 320, borderWidth: 1, borderColor: theme.border }}>
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={scannerReadLock ? undefined : ({ data }) => onQrScanned(data)}
                style={{ width: "100%", height: "100%" }}
              />
            </View>
            <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
              Aponte para o QR exibido no celular do aluno.
            </MvText>
          </View>
        </View>
      </Modal>
    </>
  );
}
