import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
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
  CAPTURE_FAILED: "Falha na cobrança de uma sessão concluída",
  CONFIRMATION_DEADLOCK: "Sessão travada por corrida de dupla-confirmação"
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
  // Frente 7 (segunda camada), Lote 4: take:200 fixo sem paginação — casos
  // OPEN mais recentes podiam ficar inalcançáveis quando o total passava
  // disso. Mesmo padrão "Anterior/Próxima" já usado em AdminDebtsScreen.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);

  const disputesQuery = useAuthQuery(
    queryKeys.admin.disputeCases({ status, page }),
    (token) => adminApi.listDisputeCases(token, { status, skip: page * PAGE_SIZE, take: PAGE_SIZE })
  );

  const loading = disputesQuery.isLoading;
  const items = disputesQuery.data?.items ?? [];
  const hasMore = disputesQuery.data?.hasMore ?? false;

  function changeStatus(next: QueueStatus) {
    setStatus(next);
    setPage(0);
  }

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

  useFocusEffectSkippingFirst(
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
              onPress={() => changeStatus(option)}
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
              <View style={{ flexDirection: "row", gap: 16 }}>
                <TouchableOpacity
                  onPress={() => navigation.navigate("AdminUserSearch", { initialQuery: item.client.email })}
                >
                  <MvText variant="caption" color="green">Ver cadastro do cliente →</MvText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => navigation.navigate("AdminUserSearch", { initialQuery: item.provider.user.email })}
                >
                  <MvText variant="caption" color="green">Ver cadastro do profissional →</MvText>
                </TouchableOpacity>
              </View>
              {item.status === "RESOLVED" ? (
                <MvText variant="body4" color="secondary">
                  Decisão:{" "}
                  {item.resolution === "REFUNDED"
                    ? "Reembolsado"
                    : item.resolution === "CAPTURED"
                      ? "Cobrança capturada"
                      : item.type === "CAPTURE_FAILED"
                        ? "Mantido sem cobrar"
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

        {page > 0 || hasMore ? (
          <View style={{ flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 4 }}>
            <MvButton
              variant="outline"
              label="Anterior"
              disabled={page === 0}
              onPress={() => setPage((p) => Math.max(0, p - 1))}
            />
            <MvButton
              variant="outline"
              label="Próxima"
              disabled={!hasMore}
              onPress={() => setPage((p) => p + 1)}
            />
          </View>
        ) : null}
      </ScrollView>
    </AdminScaffold>
  );
}
