import React, { useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SelfieProofCapture } from "../../components/media/SelfieProofCapture";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { Booking, bookingsApi, CompletionProofInput } from "../../services/api/client";
import { SkeletonBookingCard } from "../../components/polish/SkeletonCard";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { formatBRDateTime } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { queryClient } from "../../lib/queryClient";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalConfirmCompletion">;

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

export function ProfessionalConfirmCompletionScreen({ navigation, route }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const bookingId = route.params.bookingId;

  const bookingQuery = useAuthQuery(
    queryKeys.bookings.detail(bookingId),
    async (token) => {
      const bookings = await bookingsApi.me(token);
      return (bookings.find((item) => item.id === bookingId) ?? null) as Booking | null;
    },
  );

  const booking = (bookingQuery.data ?? null) as Booking | null;
  const loading = bookingQuery.isLoading;

  const [submitting, setSubmitting] = useState(false);
  const [completionProof, setCompletionProof] = useState<CompletionProofInput | null>(null);
  const [attendanceCode, setAttendanceCode] = useState("");
  const [validatingAttendance, setValidatingAttendance] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showCodeFallback, setShowCodeFallback] = useState(false);
  const scanLockRef = useRef(false);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  useEffect(() => {
    if (bookingQuery.error) {
      handleScreenError({ error: bookingQuery.error, showToast, fallbackMessage: "Falha ao carregar confirmação de conclusão.", navigation });
    }
  }, [bookingQuery.error, showToast, navigation]);

  async function validateAttendanceCode() {
    const normalized = attendanceCode.replace(/\D/g, "");
    if (normalized.length !== 6) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast("Informe o código de 6 dígitos.", "error");
      return;
    }
    try {
      setValidatingAttendance(true);
      await runWithAuth((token) => bookingsApi.verifyAttendanceCode(token, bookingId, normalized));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast("Código presencial validado com sucesso.", "success");
      setAttendanceCode(normalized);
      void bookingQuery.refetch();
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao validar código presencial.", navigation });
    } finally {
      setValidatingAttendance(false);
    }
  }

  async function validateAttendanceQr(token: string) {
    try {
      setValidatingAttendance(true);
      await runWithAuth((t) => bookingsApi.verifyAttendanceQr(t, bookingId, token));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast("QR validado com sucesso.", "success");
      void bookingQuery.refetch();
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao validar QR do atendimento.", navigation });
      scanLockRef.current = false;
    } finally {
      setValidatingAttendance(false);
    }
  }

  async function openCamera() {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        // Frente 6 (segunda camada), Lote 11: mensagem mais seca que a
        // equivalente já usada em SelfieProofCapture — sem indicar como
        // liberar o acesso.
        showToast("Permissão de câmera negada. Vá em Configurações > Privacidade > Câmera para permitir o acesso.", "error");
        return;
      }
    }
    scanLockRef.current = false;
    setShowCamera(true);
  }

  function onQrScanned(rawData: string) {
    if (scanLockRef.current || validatingAttendance) return;
    const token = extractQrTokenFromPayload(rawData);
    if (!token) { showToast("QR inválido. Tente novamente.", "error"); return; }
    scanLockRef.current = true;
    showToast("QR lido. Validando...", "info");
    void validateAttendanceQr(token);
  }

  async function handleConfirm() {
    if (!attendanceValidated) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast("Valide a presença do aluno antes de confirmar.", "error");
      return;
    }
    if (!completionProof) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast("Salve a selfie para confirmar a conclusão.", "error");
      return;
    }
    try {
      setSubmitting(true);
      const updated = await runWithAuth((token) => bookingsApi.updateStatus(token, bookingId, "COMPLETED", completionProof));
      // Frente 6 (segunda camada), Lote 7: sem isso, voltar da tela de
      // status de pagamento caía de novo aqui (ou no detalhe do
      // agendamento) mostrando o booking ainda como "Confirmado", com o
      // botão de confirmar conclusão disponível de novo — risco de
      // reenviar a mesma ação numa tela desatualizada.
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
      if (updated.status === "COMPLETED") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast("Conclusão registrada com sucesso.", "success");
      } else {
        showToast("Sua confirmação foi registrada.", "info");
      }
      navigation.replace("BookingPaymentStatus", { bookingId });
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao confirmar conclusão.", navigation });
    } finally {
      setSubmitting(false);
    }
  }

  const attendanceValidated = Boolean(booking?.attendanceCodeValidatedAt);
  const isActive = booking?.status === "PENDING" || booking?.status === "CONFIRMED";

  // Frente 6 (segunda camada), Lote 11: sair desta tela não avisava que a
  // selfie já tirada e salva seria perdida — o fluxo equivalente do
  // cliente (ClientBookingDetailScreen, estágio "post") já avisa nessa
  // mesma situação.
  function handleBack() {
    if (completionProof) {
      Alert.alert(
        "Sair sem confirmar?",
        "A selfie já capturada será perdida.",
        [
          { text: "Continuar aqui", style: "cancel" },
          { text: "Sair", style: "destructive", onPress: () => navigation.goBack() },
        ]
      );
      return;
    }
    navigation.goBack();
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.confirm-completion">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader title="Conclusão do atendimento" onBack={handleBack} />

      <ScrollView
        automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Math.max(40, insets.bottom + 24), gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        <MvText variant="body4" color="secondary">
          Valide a presença do aluno e capture uma selfie para registrar o treino.
        </MvText>

        {/* Info do agendamento */}
        {loading ? (
          <SkeletonBookingCard />
        ) : (
          <MvCard>
            {booking ? (
              <View style={{ gap: 4 }}>
                <MvText variant="semi2">Cliente: {booking.client?.name ?? "Aluno"}</MvText>
                <MvText variant="body4" color="secondary">{booking.category?.name ?? "Treino presencial"}</MvText>
                <MvText variant="body4" color="secondary">
                  Data: {formatBRDateTime(booking.scheduledAt)}
                </MvText>
                {booking.notes ? <MvText variant="body4" color="secondary">Local: {booking.notes}</MvText> : null}
              </View>
            ) : (
              <MvText variant="body4" color="secondary">Agendamento não encontrado.</MvText>
            )}
          </MvCard>
        )}

        {/* Validação presencial */}
        {isActive ? (
          <MvCard>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <MvText variant="semi2">Validação presencial</MvText>
              <MvBadge
                label={attendanceValidated ? "Validado" : "Pendente"}
                variant={attendanceValidated ? "green" : "orange"}
              />
            </View>

            {attendanceValidated ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
                <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
                <MvText variant="semi3" style={{ color: theme.primary }}>Presença confirmada</MvText>
              </View>
            ) : (
              <>
                {/* ── Estado inicial: botão para abrir câmera ── */}
                {!showCamera && !showCodeFallback ? (
                  <View style={{ gap: 10 }}>
                    <MvText variant="body4" color="secondary">
                      Escaneie o QR exibido no celular do aluno para validar a presença.
                    </MvText>
                    <MvButton
                      label="Escanear QR do aluno"
                      onPress={() => void openCamera()}
                    />
                  </View>
                ) : null}

                {/* ── Câmera inline (on-demand) ── */}
                {showCamera && !showCodeFallback ? (
                  <View style={{ gap: 8 }}>
                    <View style={{ borderRadius: 12, overflow: "hidden", height: 280, borderWidth: 1, borderColor: theme.border }}>
                      <CameraView
                        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                        onBarcodeScanned={validatingAttendance ? undefined : ({ data }) => onQrScanned(data)}
                        style={{ width: "100%", height: "100%" }}
                      />
                      {validatingAttendance ? (
                        <View
                          style={{
                            position: "absolute",
                            top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: "rgba(0,0,0,0.50)",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 10,
                          }}
                        >
                          <ActivityIndicator color={theme.primary} size="large" />
                          <MvText variant="semi3" style={{ color: "#fff" }}>Validando...</MvText>
                        </View>
                      ) : null}
                    </View>
                    <TouchableOpacity onPress={() => setShowCamera(false)} style={{ alignItems: "center", paddingVertical: 4 }}>
                      <MvText variant="body4" style={{ color: theme.textGreen }}>Fechar câmera</MvText>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* ── Fallback: código manual ── */}
                {showCodeFallback ? (
                  <View style={{ gap: 8 }}>
                    <MvInput
                      keyboardType="number-pad"
                      placeholder="Código de 6 dígitos"
                      maxLength={6}
                      value={attendanceCode}
                      onChangeText={(value) => setAttendanceCode(value.replace(/\D/g, "").slice(0, 6))}
                      testID="input.completion.attendance-code"
                    />
                    <MvButton
                      variant="outline"
                      label="Validar código"
                      loading={validatingAttendance}
                      onPress={() => void validateAttendanceCode()}
                      testID="button.completion.validate-code"
                    />
                  </View>
                ) : null}

                {/* Toggle câmera / código */}
                <TouchableOpacity
                  testID="button.completion.toggle-code-fallback"
                  onPress={() => {
                    if (showCodeFallback) {
                      setShowCodeFallback(false);
                      setShowCamera(false);
                    } else {
                      setShowCamera(false);
                      setShowCodeFallback(true);
                    }
                  }}
                  style={{ alignItems: "center", paddingVertical: 10 }}
                >
                  <MvText variant="body4" style={{ color: theme.textGreen }}>
                    {showCodeFallback ? "Usar câmera" : "Prefiro informar o código manualmente"}
                  </MvText>
                </TouchableOpacity>
              </>
            )}
          </MvCard>
        ) : null}

        <SelfieProofCapture
          disabled={submitting}
          value={completionProof}
          onChange={setCompletionProof}
          showToast={showToast}
        />

        <MvText variant="caption" color="secondary">
          Se o aluno ainda não confirmou, a cobrança acontece automaticamente em até 24h — e ele ainda terá uma janela para contestar antes de ficar definitiva.
        </MvText>

        <View style={{ gap: 10 }}>
          <MvButton
            label="Confirmar conclusão"
            loading={submitting}
            disabled={!completionProof || !attendanceValidated || !booking || booking.status === "CANCELLED" || booking.status === "COMPLETED"}
            onPress={() => void handleConfirm()}
            testID="button.completion.confirm"
          />
          <MvButton variant="outline" label="Voltar" onPress={handleBack} />
        </View>
      </ScrollView>
    </View>
  );
}
