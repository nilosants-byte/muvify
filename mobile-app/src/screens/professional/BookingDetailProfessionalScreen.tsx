import React, { useCallback, useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue, useAnimatedStyle,
  withTiming, withSequence, Easing,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { Booking, bookingsApi, paymentsApi, PaymentStatusResponse } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { SkeletonBookingDetail } from "../../components/polish/SkeletonCard";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { formatBRDateTime } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "BookingDetailProfessional">;

// Cache de módulo: persiste entre navegações (unmount/remount), limpa ao reiniciar o app
const _validatedCache = new Map<string, boolean>();

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

  const bookingDetailQuery = useAuthQuery(
    queryKeys.bookings.providerDetail(bookingId),
    async (token) => {
      const [bookings, paymentInfo] = await Promise.all([
        bookingsApi.me(token),
        paymentsApi.bookingPayment(token, bookingId),
      ]);
      const found = bookings.find((item) => item.id === bookingId) ?? null;
      return { booking: found as Booking | null, payment: paymentInfo as PaymentStatusResponse };
    },
  );

  const booking = bookingDetailQuery.data?.booking ?? null;
  const payment = bookingDetailQuery.data?.payment ?? null;
  const loading = bookingDetailQuery.isLoading;

  const [updating, setUpdating] = useState(false);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [attendanceCode, setAttendanceCode] = useState("");
  const [validatingAttendance, setValidatingAttendance] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const scannerReadLockRef = useRef(false);
  const [validated, setValidated] = useState(() => _validatedCache.get(bookingId) ?? false);
  const [reportingNoShow, setReportingNoShow] = useState(false);

  const checkScale = useSharedValue(0);
  const checkOpacity = useSharedValue(0);

  // Restaura estado visual se já validado em visita anterior
  useEffect(() => {
    if (_validatedCache.get(bookingId)) {
      checkOpacity.value = 1;
      checkScale.value = 1;
    }
  }, []);

  // Remove cache de validação se booking foi cancelado
  useEffect(() => {
    if (bookingDetailQuery.data?.booking?.status === "CANCELLED") {
      _validatedCache.delete(bookingId);
    }
  }, [bookingDetailQuery.data?.booking?.status, bookingId]);

  useEffect(() => {
    if (bookingDetailQuery.error) {
      handleScreenError({ error: bookingDetailQuery.error, showToast, fallbackMessage: "Falha ao carregar agendamento.", navigation });
    }
  }, [bookingDetailQuery.error, showToast, navigation]);

  const runValidationSuccess = useCallback(() => {
    _validatedCache.set(bookingId, true);
    setValidated(true);
    checkOpacity.value = withTiming(1, { duration: 180 });
    checkScale.value = withSequence(
      withTiming(1.3, { duration: 200, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) }),
    );
  }, [bookingId, checkOpacity, checkScale]);

  const checkStyle = useAnimatedStyle(() => ({
    opacity: checkOpacity.value,
    transform: [{ scale: checkScale.value }],
  }));

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();


  async function updateStatus(status: "CONFIRMED" | "CANCELLED" | "COMPLETED") {
    try {
      setUpdating(true);
      await runWithAuth((token) => bookingsApi.updateStatus(token, bookingId, status));
      showToast("Status atualizado.", "success");
      setCancelModalVisible(false);
      void bookingDetailQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao atualizar status.", navigation });
    } finally {
      setUpdating(false);
    }
  }

  function reportNoShow() {
    Alert.alert(
      "Reportar falta",
      "O aluno não compareceu no horário marcado? Isso encerra o agendamento agora e o valor é estornado.",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Reportar falta",
          style: "destructive",
          onPress: async () => {
            try {
              setReportingNoShow(true);
              await runWithAuth((token) => bookingsApi.reportNoShow(token, bookingId));
              showToast("Agendamento encerrado.", "success");
              void bookingDetailQuery.refetch();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Não foi possível reportar a falta.", navigation });
            } finally {
              setReportingNoShow(false);
            }
          },
        },
      ]
    );
  }

  async function validateAttendanceCode() {
    const normalized = attendanceCode.replace(/\D/g, "");
    if (normalized.length !== 6) { showToast("Informe o código de 6 dígitos.", "error"); return; }
    try {
      setValidatingAttendance(true);
      await runWithAuth((token) => bookingsApi.verifyAttendanceCode(token, bookingId, normalized));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      runValidationSuccess();
      showToast("Código presencial validado com sucesso.", "success");
      setAttendanceCode(normalized);
      void bookingDetailQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao validar código presencial.", navigation });
    } finally {
      setValidatingAttendance(false);
    }
  }

  async function validateAttendanceQr(qrToken: string) {
    try {
      setValidatingAttendance(true);
      await runWithAuth((token) => bookingsApi.verifyAttendanceQr(token, bookingId, qrToken));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      runValidationSuccess();
      showToast("QR validado com sucesso.", "success");
      setScannerVisible(false);
      void bookingDetailQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao validar QR do atendimento.", navigation });
      scannerReadLockRef.current = false;
    } finally {
      setValidatingAttendance(false);
    }
  }

  async function openQrScanner() {
    if (!cameraPermission?.granted) {
      const requested = await requestCameraPermission();
      if (!requested.granted) { showToast("Permissão de câmera necessária para ler QR Code.", "error"); return; }
    }
    scannerReadLockRef.current = false;
    setScannerVisible(true);
  }

  function onQrScanned(rawData: string) {
    if (scannerReadLockRef.current || validatingAttendance) return;
    const token = extractQrTokenFromPayload(rawData);
    if (!token || token.length < 4) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast("QR inválido. Tente novamente ou use o código de 6 dígitos.", "error");
      return;
    }
    scannerReadLockRef.current = true;
    showToast("QR lido. Validando...", "info");
    void validateAttendanceQr(token);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <ProfessionalScreenHeader title="Detalhe do atendimento" onBack={() => navigation.goBack()} />
        <SkeletonBookingDetail />
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
        <ProfessionalScreenHeader title="Detalhe do atendimento" onBack={() => navigation.goBack()} />

        <ScreenEntrance>
        <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Math.max(40, insets.bottom + 24), gap: 12 }} showsVerticalScrollIndicator={false}>
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

          {/* Validação presencial — protagonista quando ativo */}
          {isActive ? (
            <View style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "rgba(36,230,109,0.25)",
              backgroundColor: theme.mode === "dark" ? "rgba(36,230,109,0.06)" : "rgba(36,230,109,0.04)",
              padding: 16,
              gap: 10,
            }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <MvText variant="caption" style={{ color: theme.primary }}>VALIDAÇÃO DE PRESENÇA</MvText>
                  <MvText variant="h3">Confirmar presença do aluno</MvText>
                </View>
                <View style={{
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: "rgba(36,230,109,0.12)",
                  borderWidth: 1, borderColor: "rgba(36,230,109,0.22)",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name="qr-code-outline" size={22} color={theme.primary} />
                </View>
              </View>

              {validated ? (
                <Animated.View style={[checkStyle, { alignItems: "center", paddingVertical: 12, gap: 8 }]}>
                  <Ionicons name="checkmark-circle" size={52} color={theme.primary} />
                  <MvText variant="h3" style={{ color: theme.primary }}>Presença confirmada!</MvText>
                  <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
                    {booking?.client?.name
                      ? `Sessão de ${booking.client.name.split(" ")[0]} registrada. Agora confirme a conclusão.`
                      : "Sessão registrada. Agora confirme a conclusão da aula."}
                  </MvText>
                </Animated.View>
              ) : (
                <>
                  <MvText variant="body4" color="secondary">
                    Insira o código de 6 dígitos do aluno ou escaneie o QR Code.
                  </MvText>

                  {/* ── Câmera inline (on-demand) ── */}
                  {scannerVisible ? (
                    <View style={{ gap: 8 }}>
                      <View style={{ borderRadius: 12, overflow: "hidden", height: 280, borderWidth: 1, borderColor: theme.border }}>
                        <CameraView
                          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                          onBarcodeScanned={validatingAttendance ? undefined : ({ data }) => onQrScanned(data)}
                          style={{ width: "100%", height: "100%" }}
                        />
                        {validatingAttendance ? (
                          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.50)", alignItems: "center", justifyContent: "center", gap: 10 }}>
                            <ActivityIndicator color={theme.primary} size="large" />
                            <MvText variant="semi3" style={{ color: "#fff" }}>Validando...</MvText>
                          </View>
                        ) : null}
                      </View>
                      <PressableScale scale={0.96} onPress={() => setScannerVisible(false)} style={{ alignItems: "center", paddingVertical: 4 }}>
                        <MvText variant="body4" style={{ color: theme.textGreen }}>Fechar câmera</MvText>
                      </PressableScale>
                    </View>
                  ) : (
                    <MvButton
                      variant="outline"
                      label="Escanear QR pela câmera"
                      onPress={() => void openQrScanner()}
                    />
                  )}

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
                    disabled={attendanceCode.replace(/\D/g, "").length < 6}
                    onPress={() => void validateAttendanceCode()}
                  />
                </>
              )}
            </View>
          ) : null}

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
                onPress={() => {
                  navigation.navigate("ProfessionalConfirmCompletion", { bookingId });
                }}
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

            {booking.status === "CONFIRMED" && !validated && new Date(booking.scheduledAt) < new Date() ? (
              <MvButton
                variant="danger"
                label="O aluno não compareceu"
                loading={reportingNoShow}
                onPress={reportNoShow}
              />
            ) : null}

            <MvButton variant="outline" label="Atualizar" onPress={() => void bookingDetailQuery.refetch()} />
          </View>
        </ScrollView>
        </ScreenEntrance>
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
            <MvText variant="body4" color="secondary">Deseja cancelar este agendamento? Esta ação não pode ser desfeita. Cancelamentos com menos de 24h de antecedência podem não gerar reembolso integral ao aluno.</MvText>
            <View style={{ gap: 8, marginTop: 4 }}>
              <MvButton variant="danger" label="Sim, cancelar" loading={updating} onPress={() => void updateStatus("CANCELLED")} />
              <MvButton variant="outline" label="Não, manter" onPress={() => setCancelModalVisible(false)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

    </>
  );
}
