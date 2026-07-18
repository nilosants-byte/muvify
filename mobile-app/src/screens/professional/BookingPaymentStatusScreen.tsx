import React, { useEffect } from "react";
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
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

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
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const bookingId = route.params.bookingId;

  const paymentQuery = useAuthQuery(
    queryKeys.payments.bookingPayment(bookingId),
    (t) => paymentsApi.bookingPayment(t, bookingId),
  );
  const payment = paymentQuery.data ?? null;
  const loading = paymentQuery.isLoading;

  useEffect(() => {
    if (paymentQuery.error) {
      handleScreenError({ error: paymentQuery.error, showToast, fallbackMessage: "Falha ao consultar pagamento do agendamento.", navigation });
    }
  }, [paymentQuery.error, showToast, navigation]);

  const badge = payment ? paymentBadge(payment.status) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader title="Status do pagamento" onBack={() => navigation.goBack()} />

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>
        <MvCard>
          {loading ? (
            <MvText variant="body4" color="secondary">Consultando pagamento...</MvText>
          ) : payment ? (
            <View style={{ gap: 8 }}>
              {badge ? <MvBadge label={badge.label} variant={badge.variant} /> : null}
              <MvText variant="h3" style={{ color: theme.textGreen }}>
                {formatCurrencyBRL((payment.amountCents ?? 0) / 100)}
              </MvText>
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
          <MvButton variant="outline" label="Atualizar" onPress={() => void paymentQuery.refetch()} />
          <MvButton variant="ghost" label="Voltar" onPress={() => navigation.goBack()} />
        </View>
      </ScrollView>
    </View>
  );
}
