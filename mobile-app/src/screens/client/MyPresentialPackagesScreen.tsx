import React, { useCallback, useEffect } from "react";
import { ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { PresentialPackage, presentialPackagesApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import type { MvTheme } from "../../theme/MvColors";
import { MvAvatar } from "../../components/mv";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { PressableScale } from "../../components/polish/PressableScale";
import { handleScreenError } from "../shared/api-helpers";
import { formatCurrencyBRL, formatBRDate, getInitials } from "../../utils/formatters";
import { C, S, DISPLAY } from "../../theme/v2tokens";

type Props = NativeStackScreenProps<ClientStackParamList, "MyPresentialPackages">;

function packageStatusBadge(status: PresentialPackage["status"], theme: MvTheme) {
  const isDark = theme.mode === "dark";
  if (status === "ACTIVE") return { label: "Ativo", color: theme.primary, bg: theme.primarySubtle, border: theme.primarySubtleBorder };
  if (status === "PENDING_PAYMENT") return { label: "Aguardando pagamento", color: C.amber, bg: C.amberDim, border: C.amberBorder };
  if (status === "PAST_DUE") return { label: "Pagamento pendente", color: C.amber, bg: C.amberDim, border: C.amberBorder };
  if (status === "CANCELLED") return { label: "Cancelado", color: theme.text2, bg: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border: theme.border };
  return { label: "Expirado", color: theme.text2, bg: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border: theme.border };
}

function billingCycleLabel(cycle: PresentialPackage["billingCycle"]) {
  if (cycle === "DAILY") return "diário";
  if (cycle === "WEEKLY") return "semanal";
  if (cycle === "MONTHLY") return "mensal";
  if (cycle === "QUARTERLY") return "trimestral";
  if (cycle === "SEMIANNUAL") return "semestral";
  return "anual";
}

export function MyPresentialPackagesScreen({ navigation }: Props) {
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const packagesQuery = useAuthQuery(queryKeys.presentialPackages.myList(), (token) => presentialPackagesApi.my(token));
  const packages = packagesQuery.data ?? [];

  useFocusEffect(useCallback(() => { void packagesQuery.refetch(); return undefined; }, [packagesQuery.refetch]));

  useEffect(() => {
    if (packagesQuery.error) {
      handleScreenError({ error: packagesQuery.error, showToast, fallbackMessage: "Falha ao carregar seus pacotes." });
    }
  }, [packagesQuery.error, showToast]);

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
          Meus pacotes presenciais
        </Text>
      </View>

      <ScreenEntrance>
        <ScrollView contentContainerStyle={{ padding: S.px, gap: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {packages.length === 0 && !packagesQuery.isLoading ? (
            <View style={{ alignItems: "center", padding: 24, gap: 10 }}>
              <Ionicons name="repeat-outline" size={36} color={theme.text3} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Nenhum pacote ainda</Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center" }}>
                Pacotes presenciais aparecem aqui assim que você contratar um com algum profissional.
              </Text>
            </View>
          ) : null}

          {packages.map((pkg) => {
            const badge = packageStatusBadge(pkg.status, theme);
            const unitLabel = pkg.mode === "FLEXIBLE_CREDITS" ? "créditos" : "sessões";
            return (
              <PressableScale
                key={pkg.id}
                scale={0.98}
                onPress={() => navigation.navigate("PresentialPackageDetail", { packageId: pkg.id })}
                style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 8 }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <MvAvatar initials={getInitials(pkg.provider?.displayName ?? "Personal")} tone="green" size="sm" photoUri={pkg.provider?.photoUrl ?? null} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>{pkg.provider?.displayName ?? "Profissional"}</Text>
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>{pkg.offer?.title ?? "Pacote presencial"}</Text>
                  </View>
                  <View style={{ backgroundColor: badge.bg, borderWidth: 1, borderColor: badge.border, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: badge.color }}>{badge.label}</Text>
                  </View>
                </View>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>
                  {pkg.sessionsPerCycle} {unitLabel} · {formatCurrencyBRL(pkg.cycleAmountCents / 100)} / {billingCycleLabel(pkg.billingCycle)}
                </Text>
                {pkg.mode === "FLEXIBLE_CREDITS" && pkg.status === "ACTIVE" ? (
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.primary }}>
                    {pkg.creditsRemainingThisCycle} crédito{pkg.creditsRemainingThisCycle === 1 ? "" : "s"} disponíve{pkg.creditsRemainingThisCycle === 1 ? "l" : "is"} neste ciclo
                  </Text>
                ) : null}
                {pkg.status === "ACTIVE" && pkg.nextBillingAt ? (
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>
                    Próxima cobrança: {formatBRDate(pkg.nextBillingAt)}
                  </Text>
                ) : null}
              </PressableScale>
            );
          })}
        </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
