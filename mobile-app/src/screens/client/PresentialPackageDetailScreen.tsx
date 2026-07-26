import React, { useEffect, useState } from "react";
import { Alert, ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";
import { ClientStackParamList } from "../../navigation/route-types";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { presentialPackagesApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { handleScreenError } from "../shared/api-helpers";
import { formatCurrencyBRL, formatBRDate } from "../../utils/formatters";
import { C, S, DISPLAY } from "../../theme/v2tokens";

type Props = NativeStackScreenProps<ClientStackParamList, "PresentialPackageDetail">;

function billingCycleLabel(cycle: string) {
  if (cycle === "DAILY") return "diário";
  if (cycle === "WEEKLY") return "semanal";
  if (cycle === "MONTHLY") return "mensal";
  if (cycle === "QUARTERLY") return "trimestral";
  if (cycle === "SEMIANNUAL") return "semestral";
  return "anual";
}

export function PresentialPackageDetailScreen({ navigation, route }: Props) {
  const { packageId } = route.params;
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [cancelling, setCancelling] = useState(false);

  const detailQuery = useAuthQuery(queryKeys.presentialPackages.detail(packageId), (token) =>
    presentialPackagesApi.detail(token, packageId)
  );
  const pkg = detailQuery.data;

  useEffect(() => {
    if (detailQuery.error) {
      handleScreenError({ error: detailQuery.error, showToast, fallbackMessage: "Falha ao carregar o pacote.", navigation });
    }
  }, [detailQuery.error, showToast, navigation]);

  function handleCancel() {
    if (!pkg) return;
    Alert.alert(
      "Cancelar pacote",
      "Isso para as próximas cobranças - o ciclo já pago continua valendo até o fim. Deseja cancelar?",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Cancelar pacote",
          style: "destructive",
          onPress: async () => {
            try {
              setCancelling(true);
              await runWithAuth((token) => presentialPackagesApi.cancel(token, pkg.id));
              showToast("Pacote cancelado.", "success");
              void detailQuery.refetch();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Não foi possível cancelar.", navigation });
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  }

  if (detailQuery.isLoading || !pkg) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.text2 }}>Carregando pacote...</Text>
      </View>
    );
  }

  const unitLabel = pkg.mode === "FLEXIBLE_CREDITS" ? "créditos" : "sessões";
  const canCancel = pkg.status === "ACTIVE" || pkg.status === "PAST_DUE";
  const cycles = pkg.cycles ?? [];
  const isCardFixedRecurring = pkg.mode === "FIXED_RECURRING" && pkg.paymentMethod === "CREDIT_CARD";
  const billedCycles = cycles.filter((cycle) => cycle.amountCents !== null);

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
        <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.3 }}>
          {pkg.offer?.title ?? "Pacote presencial"}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: S.px, gap: 14, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {pkg.status === "PAST_DUE" ? (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: C.amberBorder, backgroundColor: C.amberDim, padding: S.cardPad, gap: 8 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: C.amber }}>
              {pkg.pendingChargePixCopyPasteCode ? "Pague o Pix para renovar" : "Não conseguimos cobrar seu cartão"}
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
              {pkg.pendingChargePixCopyPasteCode
                ? "Escaneie o QR code ou copie o código abaixo para manter seus agendamentos ativos."
                : pkg.lastBillingFailureReason ?? "Atualize seu método de pagamento para manter seus agendamentos ativos."}
            </Text>
            {pkg.pendingChargePixCopyPasteCode ? (
              <View style={{ alignItems: "center", gap: 8 }}>
                <QRCode value={pkg.pendingChargePixCopyPasteCode} size={180} backgroundColor="transparent" color={theme.text1} />
                <Text selectable style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, textAlign: "center" }}>
                  {pkg.pendingChargePixCopyPasteCode}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 6 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Detalhes do pacote</Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>
            {pkg.mode === "FIXED_RECURRING" ? "Horário fixo semanal" : "Créditos flexíveis"} · {pkg.sessionsPerCycle} {unitLabel} por ciclo
          </Text>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 18, color: theme.primary }}>
            {formatCurrencyBRL(pkg.cycleAmountCents / 100)} / {billingCycleLabel(pkg.billingCycle)}
          </Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>
            {pkg.hasFixedTerm && pkg.totalCycles ? `Vigência: ${pkg.totalCycles} ciclos` : "Vigência: sem prazo determinado"}
          </Text>
          {pkg.status === "ACTIVE" && pkg.nextBillingAt ? (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>
              Próxima cobrança: {formatBRDate(pkg.nextBillingAt)}
            </Text>
          ) : null}
          {pkg.mode === "FLEXIBLE_CREDITS" && pkg.status === "ACTIVE" ? (
            <>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>
                {pkg.creditsRemainingThisCycle} sessão{pkg.creditsRemainingThisCycle === 1 ? "" : "ões"} restante{pkg.creditsRemainingThisCycle === 1 ? "" : "s"}
                {pkg.validUntil ? ` · válido até ${formatBRDate(pkg.validUntil)}` : ""}
              </Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>
                Cada sessão é cobrada individualmente quando você agenda — nada foi cobrado adiantado.
              </Text>
            </>
          ) : null}
        </View>

        {pkg.mode === "FLEXIBLE_CREDITS" && pkg.status === "ACTIVE" && pkg.creditsRemainingThisCycle > 0 ? (
          <TouchableOpacity
            onPress={() =>
              navigation.navigate("CreateBooking", {
                professionalId: pkg.providerId,
                packageId: pkg.id,
                packageCategoryId: pkg.categoryId,
                packageSessionPriceCents: pkg.cycleAmountCents,
                packageSessionsRemaining: pkg.creditsRemainingThisCycle,
              })
            }
            style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>
              Agendar sessão
            </Text>
          </TouchableOpacity>
        ) : null}

        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 8 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Cobranças já realizadas</Text>
          {isCardFixedRecurring ? (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>
              Este pacote cobra cada sessão individualmente, perto da data — confira o valor e o status de cada uma em "Meus agendamentos".
            </Text>
          ) : billedCycles.length === 0 ? (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>Nenhum ciclo cobrado ainda.</Text>
          ) : (
            billedCycles.map((cycle) => (
              <View key={cycle.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>
                  Ciclo {cycle.cycleIndex} · {formatBRDate(cycle.capturedAt!)}
                </Text>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>
                  {formatCurrencyBRL((cycle.amountCents ?? 0) / 100)}
                </Text>
              </View>
            ))
          )}
        </View>

        {canCancel ? (
          <TouchableOpacity
            disabled={cancelling}
            onPress={handleCancel}
            style={{ height: S.btnH, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.danger, alignItems: "center", justifyContent: "center", opacity: cancelling ? 0.6 : 1 }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.danger }}>
              {cancelling ? "Cancelando..." : "Cancelar pacote"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}
