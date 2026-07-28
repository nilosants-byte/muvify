import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { RefreshControl, ScrollView, TouchableOpacity, View } from "react-native";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { MvButton, MvCard, MvText } from "../../components/mv";
import { adminApi, AdminDisputeCaseType } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { AdminScaffold } from "./AdminScaffold";
import { handleScreenError } from "../shared/api-helpers";

type Props = {
  navigation: any;
};

type QueueStatus = "OPEN" | "RESOLVED";

const TYPE_LABEL: Record<AdminDisputeCaseType, string> = {
  NO_SHOW_CONTESTED: "Falta contestada",
  CHARGEBACK: "Contestação bancária (chargeback)",
  REFUND_FAILED: "Falha no reembolso automático",
  DELIVERY_CONTESTED: "Entrega de ficha contestada",
  AUTO_CAPTURE_CONTESTED: "Contestação pós-cobrança automática",
  CAPTURE_FAILED: "Falha na cobrança de uma sessão concluída"
};

function formatCents(amountCents: number) {
  return (amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function AdminDisputesScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { showToast } = useAppState();
  const [status, setStatus] = useState<QueueStatus>("OPEN");

  const disputesQuery = useAuthQuery(
    queryKeys.admin.disputeCases({ status }),
    (token) => adminApi.listDisputeCases(token, { status })
  );

  const loading = disputesQuery.isLoading;
  const items = disputesQuery.data ?? [];

  useEffect(() => {
    if (disputesQuery.error) {
      handleScreenError({
        error: disputesQuery.error,
        showToast,
        fallbackMessage: "Falha ao carregar casos de disputa.",
        navigation
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputesQuery.error, navigation]);

  useFocusEffect(
    useCallback(() => {
      void disputesQuery.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [disputesQuery.refetch])
  );

  return (
    <AdminScaffold title="Casos de disputa" navigation={navigation} currentScreen="AdminDisputes">
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={disputesQuery.isRefetching}
            onRefresh={() => void disputesQuery.refetch()}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 10 }}
      >
        <MvText variant="body4" color="secondary">
          Casos que precisam de uma pessoa decidir: falta contestada, contestação de pagamento pelo banco ou
          reembolso automático que falhou.
        </MvText>

        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["OPEN", "RESOLVED"] as const).map((option) => (
            <TouchableOpacity
              key={option}
              onPress={() => setStatus(option)}
              style={{
                borderWidth: 1,
                borderColor: status === option ? theme.primary : "rgba(127,127,127,0.35)",
                borderRadius: 20,
                paddingHorizontal: 12,
                paddingVertical: 8
              }}
            >
              <MvText variant="caption">{option === "OPEN" ? "Em aberto" : "Resolvidos"}</MvText>
            </TouchableOpacity>
          ))}
        </View>

        {items.length === 0 && !loading ? (
          <MvCard>
            <MvText variant="body3">Nenhum caso {status === "OPEN" ? "em aberto" : "resolvido"} no momento.</MvText>
          </MvCard>
        ) : null}

        {items.map((item) => (
          <MvCard key={item.id}>
            <View style={{ gap: 6 }}>
              <MvText variant="semi2">{TYPE_LABEL[item.type]}</MvText>
              <MvText variant="body4" color="secondary">Aberto em {formatDate(item.createdAt)}</MvText>
              <MvText variant="body4">Cliente: {item.client.name}</MvText>
              <MvText variant="body4">Profissional: {item.provider.displayName}</MvText>
              <MvText variant="semi3">Valor em disputa: {formatCents(item.amountCents)}</MvText>
              {item.status === "RESOLVED" ? (
                <MvText variant="body4" color="secondary">
                  Decisão:{" "}
                  {item.resolution === "REFUNDED"
                    ? "Reembolsado"
                    : item.resolution === "CAPTURED"
                      ? "Cobrança capturada"
                      : "Reembolso negado"}
                  {item.resolvedAmountCents ? ` — ${formatCents(item.resolvedAmountCents)}` : ""}
                </MvText>
              ) : null}
              <MvButton
                variant="outline"
                label="Ver detalhes e decidir"
                onPress={() => navigation.navigate("AdminDisputeDetail", { caseId: item.id })}
              />
            </View>
          </MvCard>
        ))}
      </ScrollView>
    </AdminScaffold>
  );
}
