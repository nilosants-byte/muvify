import React, { useCallback, useEffect } from "react";
import { ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
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
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { handleScreenError } from "../shared/api-helpers";
import { formatCurrencyBRL, formatBRDate } from "../../utils/formatters";
import { S, DISPLAY, C } from "../../theme/v2tokens";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProviderDebts">;

function statusLabel(status: DebtRecordStatus) {
  if (status === "PAID") return { label: "Já recuperado", color: undefined };
  return { label: "Será descontado do seu próximo repasse", color: C.amber };
}

export function ProviderDebtsScreen({ navigation }: Props) {
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const debtsQuery = useAuthQuery(queryKeys.debts.providerList(), (token) => debtsApi.providerDebts(token));
  const debts = debtsQuery.data ?? [];

  useFocusEffect(useCallback(() => { void debtsQuery.refetch(); return undefined; }, [debtsQuery.refetch]));

  useEffect(() => {
    if (debtsQuery.error) {
      handleScreenError({ error: debtsQuery.error, showToast, fallbackMessage: "Falha ao carregar suas pendências." });
    }
  }, [debtsQuery.error, showToast]);

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
            Quando um caso de disputa é resolvido a favor de um aluno, o valor é descontado automaticamente do seu
            próximo repasse pelo Mercado Pago. Aqui você acompanha o motivo e o valor de cada pendência.
          </Text>

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
              </View>
            );
          })}
        </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
