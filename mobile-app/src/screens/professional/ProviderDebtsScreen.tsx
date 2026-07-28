import React, { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { debtsApi, DebtRecordStatus } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton } from "../../components/mv";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { handleScreenError } from "../shared/api-helpers";
import { formatCurrencyBRL, formatBRDate } from "../../utils/formatters";
import { S, DISPLAY, C } from "../../theme/v2tokens";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProviderDebts">;

function statusLabel(status: DebtRecordStatus) {
  if (status === "PAID") return { label: "Já regularizado", color: undefined };
  return { label: "Será descontado do seu próximo repasse (ou pague agora)", color: C.amber };
}

export function ProviderDebtsScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [payingId, setPayingId] = useState<string | null>(null);

  const debtsQuery = useAuthQuery(queryKeys.debts.providerList(), (token) => debtsApi.providerDebts(token));
  const debts = debtsQuery.data ?? [];

  useFocusEffect(useCallback(() => { void debtsQuery.refetch(); return undefined; }, [debtsQuery.refetch]));

  useEffect(() => {
    if (debtsQuery.error) {
      handleScreenError({ error: debtsQuery.error, showToast, fallbackMessage: "Falha ao carregar suas pendências." });
    }
  }, [debtsQuery.error, showToast]);

  // Raio-X de pagamentos, Rodada 4, Lote 6: antes só existia o desconto
  // passivo no próximo repasse, sem confirmação nenhuma de que de fato
  // aconteceu — o profissional pode agora regularizar ativamente, pagando
  // com o cartão salvo na própria conta.
  function confirmPay(debtId: string, amountCents: number) {
    Alert.alert(
      "Regularizar pendência",
      `Confirma o pagamento de ${formatCurrencyBRL(amountCents / 100)} no seu cartão salvo?`,
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Pagar",
          onPress: async () => {
            try {
              setPayingId(debtId);
              await runWithAuth((token) => debtsApi.payDebt(token, debtId));
              showToast("Pendência regularizada com sucesso.", "success");
              void debtsQuery.refetch();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Não foi possível processar o pagamento." });
            } finally {
              setPayingId(null);
            }
          }
        }
      ]
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.3 }}>
          Pendências
        </Text>
      </View>

      <ScreenEntrance>
        <ScrollView contentContainerStyle={{ padding: S.px, gap: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, lineHeight: 18 }}>
            Quando um caso de disputa é resolvido a favor de um aluno, o valor tende a ser descontado do seu próximo
            repasse pelo Mercado Pago — mas você também pode regularizar agora mesmo com seu cartão salvo, sem
            esperar.
          </Text>

          {debts.some((d) => d.status !== "PAID" && d.status !== "WRITTEN_OFF") ? (
            <TouchableOpacity
              onPress={() => navigation.navigate("ProviderPaymentMethod")}
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Ionicons name="card-outline" size={14} color={theme.primary} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.primary }}>
                Cadastrar ou atualizar cartão
              </Text>
            </TouchableOpacity>
          ) : null}

          {debts.length === 0 && !debtsQuery.isLoading ? (
            <View style={{ alignItems: "center", padding: 24, gap: 10 }}>
              <Ionicons name="checkmark-circle-outline" size={36} color={theme.text3} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Nenhuma pendência</Text>
            </View>
          ) : null}

          {debts.map((debt) => {
            const status = statusLabel(debt.status);
            return (
              <View
                key={debt.id}
                style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 8 }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1 }}>
                  {formatCurrencyBRL(debt.amountCents / 100)}
                </Text>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>{debt.reason}</Text>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>
                  Registrada em {formatBRDate(debt.createdAt)}
                </Text>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: status.color ?? theme.text2 }}>
                  {status.label}
                </Text>
                {debt.status !== "PAID" && debt.status !== "WRITTEN_OFF" ? (
                  <MvButton
                    label="Pagar agora"
                    loading={payingId === debt.id}
                    onPress={() => confirmPay(debt.id, debt.amountCents)}
                  />
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
