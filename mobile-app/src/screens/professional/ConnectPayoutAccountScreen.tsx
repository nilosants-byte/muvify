import React, { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, StatusBar, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { ProviderAccountStatus, paymentsApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvText } from "../../components/mv";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ConnectPayoutAccount">;

export function ConnectPayoutAccountScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const mpStatusQuery = useAuthQuery(
    queryKeys.payments.providerStatus(),
    (token) => paymentsApi.providerStatus(token).catch(() => null),
  );

  const mpStatus = (mpStatusQuery.data ?? null) as ProviderAccountStatus | null;
  const loading = mpStatusQuery.isLoading;
  const [connectingMp, setConnectingMp] = useState(false);

  useFocusEffect(useCallback(() => { void mpStatusQuery.refetch(); }, [mpStatusQuery.refetch]));

  useEffect(() => {
    if (mpStatusQuery.error) {
      handleScreenError({ error: mpStatusQuery.error, showToast, fallbackMessage: "Falha ao carregar status do Mercado Pago.", navigation });
    }
  }, [mpStatusQuery.error, showToast, navigation]);

  async function connectMpAccount() {
    try {
      setConnectingMp(true);
      const { onboardingUrl } = await runWithAuth((token) => paymentsApi.createOnboardingLink(token));
      await Linking.openURL(onboardingUrl);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao iniciar conexão com Mercado Pago." });
    } finally {
      setConnectingMp(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <ProfessionalScreenHeader title="Pagamentos" onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 12 }}>
          {[80, 52, 52, 44].map((h, i) => (
            <View key={i} style={{ height: h, borderRadius: 12, backgroundColor: theme.chipBg }} />
          ))}
        </View>
      ) : null}

      <ScreenEntrance key={loading ? "loading" : "ready"}>
        <ScrollView
          style={{ display: loading ? "none" : "flex" }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: Math.max(40, insets.bottom + 24), gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {mpStatus?.hasAccount ? (
            <MvCard>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="shield-checkmark" size={20} color={theme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <MvText variant="semi2">Conta Mercado Pago vinculada</MvText>
                  <MvText variant="body4" color="secondary">ID: {mpStatus.accountId}</MvText>
                </View>
                <MvBadge label="Ativo" variant="green" />
              </View>
              <MvText variant="body4" color="secondary">
                O split automático está configurado. Quando um aluno pagar, 90% do valor será transferido diretamente para sua conta Mercado Pago pelo próprio MP.
              </MvText>
            </MvCard>
          ) : (
            <MvCard>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(245,158,11,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="alert-circle-outline" size={20} color="#F59E0B" />
                </View>
                <View style={{ flex: 1 }}>
                  <MvText variant="semi2">Conta não vinculada</MvText>
                  <MvBadge label="Pendente" variant="orange" />
                </View>
              </View>
              <MvText variant="body4" color="secondary">
                Conecte sua conta Mercado Pago para ativar o repasse automático. Quando um aluno pagar, o Mercado Pago divide automaticamente: 90% vai direto para você, 10% fica com a plataforma. Nenhuma ação manual necessária.
              </MvText>
            </MvCard>
          )}

          <MvCard>
            <MvText variant="semi3" style={{ marginBottom: 8 }}>Como funciona o repasse</MvText>
            {[
              { icon: "flash-outline" as const,            label: "PIX",       desc: "Disponível no mesmo dia (D+0)" },
              { icon: "card-outline" as const,             label: "Cartão",    desc: "Disponível em até 14 dias (D+14)" },
              { icon: "shield-checkmark-outline" as const, label: "Segurança", desc: "100% processado pelo Mercado Pago" },
              { icon: "pie-chart-outline" as const,        label: "Divisão",   desc: "90% para você · 10% para a Muvify" },
            ].map((item) => (
              <View key={item.label} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: theme.borderSub }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(34,197,94,0.10)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={item.icon} size={14} color={theme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <MvText variant="semi3" style={{ fontSize: 12 }}>{item.label}</MvText>
                  <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>{item.desc}</MvText>
                </View>
              </View>
            ))}
          </MvCard>

          <MvButton
            label={mpStatus?.hasAccount ? "Reconectar conta Mercado Pago" : "Conectar conta Mercado Pago"}
            loading={connectingMp}
            onPress={() => void connectMpAccount()}
          />
          {mpStatus?.hasAccount ? (
            <MvButton
              variant="ghost"
              label="Atualizar status"
              onPress={() => void mpStatusQuery.refetch()}
            />
          ) : null}

          <MvButton variant="ghost" label="Voltar ao financeiro" onPress={() => navigation.replace("PayoutStatus")} />
        </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
