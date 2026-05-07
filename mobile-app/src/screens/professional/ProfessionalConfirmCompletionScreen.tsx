import React, { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Modal, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SelfieProofCapture } from "../../components/media/SelfieProofCapture";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { Booking, bookingsApi, CompletionProofInput } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { formatBRDateTime } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

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

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completionProof, setCompletionProof] = useState<CompletionProofInput | null>(null);
  const [attendanceCode, setAttendanceCode] = useState("");
  const [attendanceQrToken, setAttendanceQrToken] = useState("");
  const [validatingAttendance, setValidatingAttendance] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerReadLock, setScannerReadLock] = useState(false);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const bookings = await runWithAuth((token) => bookingsApi.me(token));
      setBooking(bookings.find((item) => item.id === bookingId) ?? null);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar confirmação de conclusão.", navigation });
    } finally {
      setLoading(false);
    }
  }, [bookingId, navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

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

  async function handleConfirm() {
    if (!completionProof) { showToast("Salve a selfie para confirmar a conclusão.", "error"); return; }
    try {
      setSubmitting(true);
      const updated = await runWithAuth((token) => bookingsApi.updateStatus(token, bookingId, "COMPLETED", completionProof));
      if (updated.status === "COMPLETED") {
        showToast("Conclusão registrada com sucesso.", "success");
      } else {
        showToast("Sua confirmação foi registrada.", "info");
      }
      navigation.navigate("BookingPaymentStatus", { bookingId });
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao confirmar conclusão.", navigation });
    } finally {
      setSubmitting(false);
    }
  }

  const attendanceValidated = Boolean(booking?.attendanceCodeValidatedAt);
  const isActive = booking?.status === "PENDING" || booking?.status === "CONFIRMED";

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
          <MvText variant="semi1">Conclusão do atendimento</MvText>
        </View>

        <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
          <MvText variant="body4" color="secondary">
            Capture uma selfie para confirmar que o treino foi realizado.
          </MvText>

          {/* Info do agendamento */}
          <MvCard>
            {loading ? (
              <MvText variant="body4" color="secondary">Carregando dados do agendamento...</MvText>
            ) : booking ? (
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
              <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
                Valide agora por código de 6 dígitos ou QR, sem precisar voltar.
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
                <MvButton variant="outline" label="Ler QR pela câmera" loading={validatingAttendance} onPress={() => void openQrScanner()} />
                <MvButton variant="outline" label="Validar QR" loading={validatingAttendance} onPress={() => void validateAttendanceQr()} />
              </View>
            </MvCard>
          ) : null}

          <SelfieProofCapture
            disabled={submitting}
            value={completionProof}
            onChange={setCompletionProof}
            showToast={showToast}
          />

          <View style={{ gap: 10 }}>
            <MvButton
              label="Confirmar conclusão"
              loading={submitting}
              disabled={!completionProof || !booking || booking.status === "CANCELLED" || booking.status === "COMPLETED"}
              onPress={() => void handleConfirm()}
            />
            <MvButton variant="outline" label="Voltar" onPress={() => navigation.goBack()} />
          </View>
        </ScrollView>
      </View>

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
