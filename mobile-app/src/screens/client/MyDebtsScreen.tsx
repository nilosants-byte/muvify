import React, { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { debtsApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton } from "../../components/mv";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { handleScreenError } from "../shared/api-helpers";
import { formatCurrencyBRL, formatBRDate } from "../../utils/formatters";
import { S, DISPLAY, C } from "../../theme/v2tokens";

type Props = NativeStackScreenProps<ClientStackParamList, "MyDebts">;

export function MyDebtsScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [payingId, setPayingId] = useState<string | null>(null);

  const debtsQuery = useAuthQuery(queryKeys.debts.my(), (token) => debtsApi.myDebts(token));
  const debts = (debtsQuery.data ?? []).filter((debt) => debt.status !== "PAID" && debt.status !== "WRITTEN_OFF");

  useFocusEffectSkippingFirst(useCallback(() => { void debtsQuery.refetch(); return undefined; }, [debtsQuery.refetch]));

  useEffect(() => {
    if (debtsQuery.error) {
      handleScreenError({ error: debtsQuery.error, showToast, fallbackMessage: "Falha ao carregar suas pendências." });
    }
  }, [debtsQuery.error, showToast]);

  function confirmPay(debtId: string, amountCents: number) {
    Alert.alert(
      "Pagar pendência",
      `Confirma o pagamento de ${formatCurrencyBRL(amountCents / 100)} no seu cartão salvo?`,
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Pagar",
          onPress: async () => {
            try {
              setPayingId(debtId);
              await runWithAuth((token) => debtsApi.payDebt(token, debtId));
              showToast("Pendência paga com sucesso.", "success");
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
          Minhas pendências
        </Text>
      </View>

      <ScreenEntrance>
        <ScrollView contentContainerStyle={{ padding: S.px, gap: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {debts.length === 0 && !debtsQuery.isLoading ? (
            <View style={{ alignItems: "center", padding: 24, gap: 10 }}>
              <Ionicons name="checkmark-circle-outline" size={36} color={theme.text3} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Nenhuma pendência</Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center" }}>
                Você não tem nenhuma pendência financeira em aberto.
              </Text>
            </View>
          ) : null}

          {debts.length > 0 ? (
            <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: C.amberBorder, backgroundColor: C.amberDim, padding: S.cardPad, gap: 6 }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: C.amber }}>
                Enquanto houver pendência em aberto, novas compras ficam bloqueadas
              </Text>
            </View>
          ) : null}

          {debts.map((debt) => (
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
              <MvButton
                label="Pagar agora"
                loading={payingId === debt.id}
                onPress={() => confirmPay(debt.id, debt.amountCents)}
              />
            </View>
          ))}
        </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
