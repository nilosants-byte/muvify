import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { MvButton, MvCard, MvText } from "../../components/mv";
import { adminApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { AdminScaffold } from "./AdminScaffold";
import { handleScreenError } from "../shared/api-helpers";

// Raio-X de pagamentos, Rodada 4, Lote 9: as rotas /admin/data-retention/*
// já existiam (histórico de execuções + disparo manual), mas nenhuma tela
// consumia — a única forma de rodar a retenção fora do job automático era
// via chamada direta à API.

type Props = {
  navigation: any;
};

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AdminDataRetentionScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { runWithAuth, showToast } = useAppState();
  const [running, setRunning] = useState(false);

  const runsQuery = useAuthQuery(
    queryKeys.admin.dataRetentionRuns(),
    (token) => adminApi.listDataRetentionRuns(token, 30)
  );

  const loading = runsQuery.isLoading;
  const runs = runsQuery.data ?? [];

  useEffect(() => {
    if (runsQuery.error) {
      handleScreenError({
        error: runsQuery.error,
        showToast,
        fallbackMessage: "Falha ao carregar histórico de retenção.",
        navigation
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runsQuery.error, navigation]);

  useFocusEffectSkippingFirst(
    useCallback(() => {
      void runsQuery.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runsQuery.refetch])
  );

  async function triggerRun(dryRun: boolean) {
    try {
      setRunning(true);
      await runWithAuth((token) => adminApi.runDataRetention(token, { dryRun }));
      showToast(dryRun ? "Simulação concluída." : "Retenção executada.", "success");
      await runsQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao rodar a retenção.", navigation });
    } finally {
      setRunning(false);
    }
  }

  function confirmRealRun() {
    Alert.alert(
      "Rodar retenção de verdade",
      "Isso vai apagar/anonimizar dados conforme as regras de retenção configuradas, fora de qualquer legal hold ativo. Quer continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Rodar", style: "destructive", onPress: () => void triggerRun(false) }
      ]
    );
  }

  return (
    <AdminScaffold title="Retenção de dados" navigation={navigation} currentScreen="AdminDataRetention">
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={runsQuery.isRefetching}
            onRefresh={() => void runsQuery.refetch()}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 10 }}
      >
        <MvText variant="body4" color="secondary">
          O job automático roda periodicamente aplicando as janelas de retenção do LGPD (apaga ou anonimiza dados
          antigos). Usuários com legal hold ativo (buscar usuário → legal hold) ficam de fora de qualquer execução.
        </MvText>

        <MvCard>
          <View style={{ gap: 8 }}>
            <MvText variant="semi2">Rodar manualmente</MvText>
            <MvButton
              variant="outline"
              label="Simular (dry run — não apaga nada)"
              loading={running}
              onPress={() => void triggerRun(true)}
            />
            <MvButton
              variant="danger"
              label="Rodar de verdade"
              loading={running}
              onPress={confirmRealRun}
            />
          </View>
        </MvCard>

        <MvText variant="semi2">Histórico de execuções</MvText>

        {runs.length === 0 && !loading ? (
          <MvCard>
            <MvText variant="body3">Nenhuma execução registrada ainda.</MvText>
          </MvCard>
        ) : null}

        {runs.map((run) => {
          // Frente 13 (segunda camada), Lote 5: status ganhou um terceiro
          // valor ("PARTIAL_FAILURE" — uma ou mais regras individuais
          // falharam, mas a execução como um todo não travou) além de
          // "SUCCESS"/"FAILED" — sem isso, uma regra falhando ficava
          // mascarada como sucesso completo aqui.
          const summary = run.summary as {
            totals?: { matchedCount?: number; affectedCount?: number; rules?: number; failedRules?: number };
            failedRuleIds?: string[];
          } | null;
          const statusLabel =
            run.status === "SUCCESS" ? "Sucesso" : run.status === "PARTIAL_FAILURE" ? "Parcial" : "Falhou";
          return (
            <MvCard key={run.id}>
              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <MvText variant="semi3">{run.dryRun ? "Simulação (dry run)" : "Execução real"}</MvText>
                  <MvText variant="caption" color={run.status === "SUCCESS" ? "secondary" : "danger"}>
                    {statusLabel}
                  </MvText>
                </View>
                <MvText variant="body4" color="secondary">Disparado por: {run.triggeredBy}</MvText>
                <MvText variant="body4" color="secondary">Início: {formatDateTime(run.startedAt)}</MvText>
                <MvText variant="body4" color="secondary">Fim: {formatDateTime(run.finishedAt)}</MvText>
                {summary?.totals ? (
                  <MvText variant="body4">
                    {summary.totals.matchedCount ?? 0} encontrados · {summary.totals.affectedCount ?? 0} afetados · {summary.totals.rules ?? 0} regras
                  </MvText>
                ) : null}
                {summary?.failedRuleIds && summary.failedRuleIds.length > 0 ? (
                  <MvText variant="body4" style={{ color: theme.danger }}>
                    Regras que falharam: {summary.failedRuleIds.join(", ")}
                  </MvText>
                ) : null}
                {run.errorMessage ? (
                  <MvText variant="body4" style={{ color: theme.danger }}>{run.errorMessage}</MvText>
                ) : null}
              </View>
            </MvCard>
          );
        })}
      </ScrollView>
    </AdminScaffold>
  );
}
