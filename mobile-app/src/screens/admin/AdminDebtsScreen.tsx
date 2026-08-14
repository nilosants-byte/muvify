import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
import { FlatList, RefreshControl, TouchableOpacity, View } from "react-native";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { adminApi, AdminDebtRecord, DebtRecordStatus } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { AdminScaffold } from "./AdminScaffold";
import { handleScreenError } from "../shared/api-helpers";

type Props = {
  navigation: any;
};

const STATUS_LABEL: Record<DebtRecordStatus, string> = {
  PENDING: "Pendente",
  NOTIFIED: "Notificado",
  PAID: "Pago",
  WRITTEN_OFF: "Baixado (incobrável)"
};

function formatCents(amountCents: number) {
  return (amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function AdminDebtsScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { runWithAuth, showToast } = useAppState();
  const [status, setStatus] = useState<DebtRecordStatus | undefined>(undefined);
  const [writingOffId, setWritingOffId] = useState<string | null>(null);
  const [writeOffReason, setWriteOffReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Raio-X de pagamentos, Rodada 4, Lote 13: listAllDebts era take:200 fixo,
  // sem indicador de "há mais" — acima disso, dívidas mais antigas
  // simplesmente somiam da lista sem ninguém perceber.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);

  const debtsQuery = useAuthQuery(
    queryKeys.admin.debts({ status, page }),
    (token) => adminApi.listDebts(token, { status, skip: page * PAGE_SIZE, take: PAGE_SIZE })
  );

  const loading = debtsQuery.isLoading;
  const items = debtsQuery.data?.items ?? [];
  const hasMore = debtsQuery.data?.hasMore ?? false;

  function changeStatus(next: DebtRecordStatus | undefined) {
    setStatus(next);
    setPage(0);
  }

  useEffect(() => {
    if (debtsQuery.error) {
      handleScreenError({
        error: debtsQuery.error,
        showToast,
        fallbackMessage: "Falha ao carregar pendências financeiras.",
        navigation
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debtsQuery.error, navigation]);

  useFocusEffectSkippingFirst(
    useCallback(() => {
      void debtsQuery.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debtsQuery.refetch])
  );

  async function submitWriteOff(debtId: string) {
    const trimmedReason = writeOffReason.trim();
    if (trimmedReason.length < 5) {
      showToast("Explique o motivo da baixa (mínimo 5 caracteres).", "error");
      return;
    }
    try {
      setSubmitting(true);
      await runWithAuth((token) => adminApi.writeOffDebt(token, debtId, trimmedReason));
      showToast("Pendência baixada como incobrável.", "success");
      setWritingOffId(null);
      setWriteOffReason("");
      await debtsQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao dar baixa na pendência.", navigation });
    } finally {
      setSubmitting(false);
    }
  }

  function renderItem({ item }: { item: AdminDebtRecord }) {
    const isOutstanding = item.status === "PENDING" || item.status === "NOTIFIED";
    const debtorLabel = item.debtorType === "CLIENT" ? item.client?.name : item.provider?.displayName;
    const debtorEmail = item.debtorType === "CLIENT" ? item.client?.email : item.provider?.user.email;
    return (
      <MvCard style={{ marginBottom: 10 }}>
        <View style={{ gap: 6 }}>
          <MvText variant="semi2">
            {item.debtorType === "CLIENT" ? "Dívida do aluno" : "Dívida do profissional"}
          </MvText>
          <MvText variant="body4" color="secondary">Registrada em {formatDate(item.createdAt)}</MvText>
          <MvText variant="body4">Devedor: {debtorLabel ?? "—"}</MvText>
          {debtorEmail ? (
            <TouchableOpacity
              onPress={() => navigation.navigate("AdminUserSearch", { initialQuery: debtorEmail })}
            >
              <MvText variant="caption" color="green">Buscar este usuário →</MvText>
            </TouchableOpacity>
          ) : null}
          <MvText variant="semi3">Valor: {formatCents(item.amountCents)}</MvText>
          <MvText variant="body4" color="secondary">Motivo: {item.reason}</MvText>
          <MvText variant="body4">Status: {STATUS_LABEL[item.status]}</MvText>

          {isOutstanding && writingOffId !== item.id ? (
            <MvButton
              variant="outline"
              label="Dar baixa (incobrável)"
              onPress={() => setWritingOffId(item.id)}
            />
          ) : null}

          {writingOffId === item.id ? (
            <View style={{ gap: 4 }}>
              <MvText variant="caption" color="secondary">Motivo da baixa</MvText>
              <MvInput
                multiline
                numberOfLines={3}
                maxLength={500}
                placeholder="Ex: valor irrisório, devedor sumiu, custo de cobrança maior que o valor"
                value={writeOffReason}
                onChangeText={setWriteOffReason}
                style={{ textAlignVertical: "top" } as any}
              />
              <MvButton
                variant="danger"
                label="Confirmar baixa"
                loading={submitting}
                onPress={() => void submitWriteOff(item.id)}
              />
              <MvButton
                variant="ghost"
                label="Cancelar"
                onPress={() => {
                  setWritingOffId(null);
                  setWriteOffReason("");
                }}
              />
            </View>
          ) : null}
        </View>
      </MvCard>
    );
  }

  return (
    <AdminScaffold title="Pendências financeiras" navigation={navigation} currentScreen="AdminDebts">
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={debtsQuery.isRefetching}
            onRefresh={() => void debtsQuery.refetch()}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 10 }}>
            <MvText variant="body4" color="secondary">
              Dívidas registradas automaticamente quando uma disputa é resolvida (reembolso vira dívida do
              profissional) ou quando o admin identifica que o aluno recebeu algo indevidamente.
            </MvText>

            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {([undefined, "PENDING", "NOTIFIED", "PAID", "WRITTEN_OFF"] as const).map((option) => (
                <TouchableOpacity
                  key={option ?? "ALL"}
                  onPress={() => changeStatus(option)}
                  style={{
                    borderWidth: 1,
                    borderColor: status === option ? theme.primary : "rgba(127,127,127,0.35)",
                    borderRadius: 20,
                    paddingHorizontal: 12,
                    paddingVertical: 8
                  }}
                >
                  <MvText variant="caption">{option ? STATUS_LABEL[option] : "Todas"}</MvText>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <MvCard>
              <MvText variant="body3">Nenhuma pendência encontrada para este filtro.</MvText>
            </MvCard>
          ) : null
        }
        ListFooterComponent={
          page > 0 || hasMore ? (
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
          ) : null
        }
      />
    </AdminScaffold>
  );
}
