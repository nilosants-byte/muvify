import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";
import { SelfieProofCapture } from "../../components/media/SelfieProofCapture";
import { ClientStackParamList } from "../../navigation/route-types";
import {
  AttendanceCodeResponse,
  Booking,
  bookingsApi,
  CompletionProofInput,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvText } from "../../components/mv";
import { formatBRDateTime } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ClientStackParamList, "ClientConfirmCompletion">;

const LAST_WORKOUT_STORAGE_KEY = "@personalapp/lastWorkout";

export function ClientConfirmCompletionScreen({ route, navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const bookingId = route.params.bookingId;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [professionalId, setProfessionalId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [completionProof, setCompletionProof] = useState<CompletionProofInput | null>(null);
  const [attendance, setAttendance] = useState<AttendanceCodeResponse | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function loadBooking() {
      try {
        const bookings = await runWithAuth((token) => bookingsApi.me(token));
        const currentBooking = bookings.find((item) => item.id === bookingId) ?? null;
        if (!mounted) return;
        setBooking(currentBooking);
        setProfessionalId(currentBooking?.providerId ?? "");

        if (currentBooking && (currentBooking.status === "PENDING" || currentBooking.status === "CONFIRMED")) {
          try {
            setAttendanceLoading(true);
            const payload = await runWithAuth((token) => bookingsApi.attendanceCode(token, currentBooking.id));
            if (!mounted) return;
            setAttendance(payload);
          } catch {
            if (!mounted) return;
            setAttendance(null);
          } finally {
            if (mounted) setAttendanceLoading(false);
          }
        } else {
          setAttendance(null);
        }
      } catch (error) {
        if (!mounted) return;
        handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar dados da conclusão.", navigation });
      }
    }
    void loadBooking();
    return () => { mounted = false; };
  }, [bookingId, navigation, runWithAuth, showToast]);

  async function handleConfirm() {
    if (!completionProof) {
      showToast("Salve a selfie para confirmar a conclusão.", "error");
      return;
    }
    try {
      setLoading(true);
      await runWithAuth((token) => bookingsApi.updateStatus(token, bookingId, "COMPLETED", completionProof));
      const workoutSnapshot = {
        bookingId,
        mode: "PRESENCIAL",
        selfieDataUri: `data:${completionProof.mimeType};base64,${completionProof.imageBase64}`,
        scheduledAt: booking?.completedAt ?? booking?.scheduledAt ?? new Date().toISOString(),
        location: booking?.notes ?? "Local definido no agendamento",
      };
      await AsyncStorage.setItem(LAST_WORKOUT_STORAGE_KEY, JSON.stringify(workoutSnapshot));
      showToast("Conclusão confirmada.", "success");
      navigation.replace("ReviewProfessional", {
        bookingId,
        professionalId: professionalId || "unknown",
      });
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível confirmar conclusão.", navigation });
    } finally {
      setLoading(false);
    }
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
        <MvText variant="h4">Conclusão do treino</MvText>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        <MvText variant="body4" color="secondary">
          Faça uma selfie para validar o atendimento e liberar o pagamento.
        </MvText>

        {/* Info do agendamento */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 6 }}>
            {booking?.provider?.displayName ?? "Profissional"}
          </MvText>
          <MvText variant="body4" color="secondary">{booking?.category?.name ?? "Treino presencial"}</MvText>
          <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
            Horário: {formatBRDateTime(booking?.scheduledAt)}
          </MvText>
          {booking?.notes ? (
            <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>Local: {booking.notes}</MvText>
          ) : null}
        </MvCard>

        {/* Validação presencial */}
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
              <MvText variant="body4" color="secondary">
                Mostre este QR para o profissional validar na hora.
              </MvText>
              <View style={{ marginVertical: 8, padding: 12, borderRadius: 11, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, alignItems: "center" }}>
                <QRCode
                  backgroundColor="transparent"
                  color={theme.text1}
                  size={160}
                  value={attendance.qrDeepLink ?? attendance.qrToken ?? "-"}
                />
              </View>
              <MvText variant="body4" color="secondary">
                Código alternativo: {attendance.code ?? "------"}
              </MvText>
              <MvText variant="body4" color="secondary">
                Expira em: {formatBRDateTime(attendance.expiresAt)}
              </MvText>
            </View>
          ) : (
            <MvText variant="body4" color="secondary">
              Código/QR liberados automaticamente 10 minutos antes da aula.
            </MvText>
          )}
        </MvCard>

        <SelfieProofCapture
          disabled={loading}
          value={completionProof}
          onChange={setCompletionProof}
          showToast={showToast}
        />

        <View style={{ gap: 10 }}>
          <MvButton
            label="Finalizar atendimento"
            disabled={!completionProof}
            loading={loading}
            onPress={() => void handleConfirm()}
          />
          <MvButton variant="outline" label="Voltar" onPress={() => navigation.goBack()} />
        </View>
      </ScrollView>
    </View>
  );
}
