import React, { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { paymentsApi, PaymentStatusResponse } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvText } from "../../components/mv";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "BookingPaymentStatus">;

function paymentBadge(status: PaymentStatusResponse["status"]): { label: string; variant: "green" | "orange" | "red" | "blue" | "gray" } {
  if (status === "CAPTURED") return { label: "Capturado", variant: "green" };
  if (status === "REFUNDED") return { label: "Estornado", variant: "orange" };
  if (status === "CANCELED" || status === "FAILED") return { label: "Cancelado/Falhou", variant: "red" };
  if (status === "AUTHORIZED") return { label: "Autorizado", variant: "blue" };
  if (status === "AUTHORIZING") return { label: "Autorizando", variant: "blue" };
  return { label: "Pré-autorização pendente", variant: "orange" };
}

export function BookingPaymentStatusScreen({ route, navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const bookingId = route.params.bookingId;
  const [payment, setPayment] = useState<PaymentStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await runWithAuth((token) => paymentsApi.bookingPayment(token, bookingId));
      setPayment(response);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao consultar pagamento do agendamento.", navigation });
    } finally {
      setLoading(false);
    }
  }, [bookingId, navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

  const badge = payment ? paymentBadge(payment.status) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader title="Status do pagamento" onBack={() => navigation.goBack()} />

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>
        <MvText variant="body4" color="secondary">Agendamento: {bookingId.slice(0, 8)}...</MvText>

        <MvCard>
          {loading ? (
            <MvText variant="body4" color="secondary">Consultando pagamento...</MvText>
          ) : payment ? (
            <View style={{ gap: 8 }}>
              {badge ? <MvBadge label={badge.label} variant={badge.variant} /> : null}
              <MvText variant="h3" style={{ color: theme.textGreen }}>
                {formatCurrencyBRL((payment.amountCents ?? 0) / 100)}
              </MvText>
              <MvText variant="body4" color="secondary">ID pagamento: {payment.id}</MvText>
              <MvText variant="body4" color="secondary">Moeda: {payment.currency}</MvText>
              <MvText variant="body4" color="secondary">Método: {payment.method ?? "-"}</MvText>
              {payment.status === "FAILED" && payment.failureReason ? (
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, paddingTop: 4 }}>
                  <Ionicons name="alert-circle-outline" size={14} color={theme.danger} style={{ marginTop: 1 }} />
                  <MvText variant="body4" style={{ color: theme.danger, flex: 1 }}>{payment.failureReason}</MvText>
                </View>
              ) : null}
            </View>
          ) : (
            <MvText variant="body4" color="secondary">Pagamento não encontrado para este agendamento.</MvText>
          )}
        </MvCard>

        <View style={{ gap: 10 }}>
          <MvButton variant="outline" label="Atualizar" onPress={() => void load()} />
          <MvButton variant="ghost" label="Voltar" onPress={() => navigation.goBack()} />
        </View>
      </ScrollView>
    </View>
  );
}
