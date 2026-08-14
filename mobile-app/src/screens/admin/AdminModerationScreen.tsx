import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
import { Alert, FlatList, RefreshControl, TouchableOpacity, View } from "react-native";
import { MvBadge, MvButton, MvCard, MvText } from "../../components/mv";
import { AdminReport, AdminReportType, adminApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { AdminScaffold } from "./AdminScaffold";
import { formatBRDateTime } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

type Props = {
  navigation: any;
};

// Épico de Frentes, Frente 10, Lote 1: as 3 filas de denúncia (post, chat de
// agendamento, chat de consultoria) nunca tiveram nenhuma tela admin -
// denunciar não fazia nada além de sumir o post pra quem denunciou, ou
// nada nenhum no caso de chat. Fila unificada com 2 ações: descartar (sem
// efeito no conteúdo) e ocultar (some pra todo mundo, reversível).

const TYPE_LABEL: Record<AdminReportType, string> = {
  "feed-post": "Post do feed",
  "booking-message": "Mensagem — chat de agendamento",
  "consultancy-message": "Mensagem — chat de consultoria"
};

type QueueStatus = "PENDING" | "ACTIONED";

export function AdminModerationScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [status, setStatus] = useState<QueueStatus>("PENDING");
  // Frente 7 (segunda camada), Lote 5: take:50 fixo sem skip nem uso do
  // `total` que o backend já devolve — denúncias mais antigas ficavam
  // permanentemente inacessíveis quando a fila passava de 50. Mesmo padrão
  // "Anterior/Próxima" já usado em AdminDebtsScreen/AdminDisputesScreen.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);

  const reportsQuery = useAuthQuery(
    queryKeys.admin.reports({ status, take: PAGE_SIZE, page }),
    (token) => adminApi.listReports(token, { status, take: PAGE_SIZE, skip: page * PAGE_SIZE })
  );

  function changeStatus(next: QueueStatus) {
    setStatus(next);
    setPage(0);
  }

  const loading = reportsQuery.isLoading;
  const reports = reportsQuery.data?.items ?? [];
  const total = reportsQuery.data?.total ?? 0;
  const hasMore = (page + 1) * PAGE_SIZE < total;

  useEffect(() => {
    if (reportsQuery.error) {
      handleScreenError({ error: reportsQuery.error, showToast, fallbackMessage: "Falha ao carregar denúncias.", navigation });
    }
  }, [reportsQuery.error, showToast, navigation]);

  useFocusEffectSkippingFirst(useCallback(() => {
    void reportsQuery.refetch();
  }, [reportsQuery.refetch]));

  async function dismiss(type: AdminReportType, reportId: string) {
    const key = `dismiss:${type}:${reportId}`;
    try {
      setProcessingKey(key);
      await runWithAuth((token) => adminApi.dismissReport(token, type, reportId));
      showToast("Denúncia descartada.", "success");
      await reportsQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao descartar denúncia.", navigation });
    } finally {
      setProcessingKey(null);
    }
  }

  function confirmHide(type: AdminReportType, reportId: string) {
    Alert.alert(
      "Ocultar conteúdo?",
      "O conteúdo denunciado vai sumir para todos os usuários. Dá pra reverter depois na aba \"Já tratadas\", se necessário.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Ocultar", style: "destructive", onPress: () => void hide(type, reportId) }
      ]
    );
  }

  async function hide(type: AdminReportType, reportId: string) {
    const key = `hide:${type}:${reportId}`;
    try {
      setProcessingKey(key);
      await runWithAuth((token) => adminApi.hideReportedContent(token, type, reportId));
      showToast("Conteúdo ocultado.", "success");
      await reportsQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao ocultar conteúdo.", navigation });
    } finally {
      setProcessingKey(null);
    }
  }

  // Frente 7 (segunda camada), Lote 10: "hide-content" agora tem reversão de
  // verdade — antes a única forma de ver "denúncias já tratadas" era esta
  // tela, que sempre filtrava só PENDING, então não havia nem como alcançar
  // um conteúdo já oculto pra desocultar.
  function confirmUnhide(type: AdminReportType, reportId: string) {
    Alert.alert(
      "Desocultar conteúdo?",
      "O conteúdo volta a ficar visível para todos os usuários, e o autor será avisado.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Desocultar", onPress: () => void unhide(type, reportId) }
      ]
    );
  }

  async function unhide(type: AdminReportType, reportId: string) {
    const key = `unhide:${type}:${reportId}`;
    try {
      setProcessingKey(key);
      await runWithAuth((token) => adminApi.unhideReportedContent(token, type, reportId));
      showToast("Conteúdo restaurado.", "success");
      await reportsQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao desocultar conteúdo.", navigation });
    } finally {
      setProcessingKey(null);
    }
  }

  function renderItem({ item: report }: { item: AdminReport }) {
    const dismissKey = `dismiss:${report.type}:${report.reportId}`;
    const hideKey = `hide:${report.type}:${report.reportId}`;
    const unhideKey = `unhide:${report.type}:${report.reportId}`;
    const isProcessing =
      processingKey === dismissKey || processingKey === hideKey || processingKey === unhideKey;
    return (
      <MvCard style={{ marginBottom: 10 }}>
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <MvBadge label={TYPE_LABEL[report.type]} variant="orange" />
            <MvText variant="caption" color="secondary">{formatBRDateTime(report.createdAt)}</MvText>
          </View>
          <MvText variant="body4" color="secondary">
            Denunciado por {report.reporter.name} ({report.reporter.email})
          </MvText>
          {report.reason ? (
            <MvText variant="body4" color="secondary">Motivo: {report.reason}</MvText>
          ) : null}
          <MvText variant="body3" numberOfLines={4} style={{ marginTop: 4 }}>
            {report.contentPreview || "[sem prévia disponível]"}
          </MvText>
          {report.contentAuthor ? (
            <>
              <MvText variant="caption" color="secondary">
                Autor: {report.contentAuthor.name} ({report.contentAuthor.email})
              </MvText>
              <TouchableOpacity
                onPress={() => navigation.navigate("AdminUserSearch", { initialQuery: report.contentAuthor!.email })}
              >
                <MvText variant="caption" color="green">Buscar este usuário para investigar →</MvText>
              </TouchableOpacity>
            </>
          ) : null}

          {status === "PENDING" ? (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
              <View style={{ flex: 1 }}>
                <MvButton
                  variant="outline"
                  label="Descartar"
                  loading={processingKey === dismissKey}
                  disabled={isProcessing}
                  onPress={() => void dismiss(report.type, report.reportId)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <MvButton
                  label="Ocultar conteúdo"
                  loading={processingKey === hideKey}
                  disabled={isProcessing}
                  onPress={() => confirmHide(report.type, report.reportId)}
                />
              </View>
            </View>
          ) : report.contentHidden ? (
            <View style={{ marginTop: 6 }}>
              <MvButton
                variant="outline"
                label="Desocultar conteúdo"
                loading={processingKey === unhideKey}
                disabled={isProcessing}
                onPress={() => confirmUnhide(report.type, report.reportId)}
              />
            </View>
          ) : (
            <MvText variant="caption" color="secondary">Descartada — conteúdo não foi ocultado.</MvText>
          )}
        </View>
      </MvCard>
    );
  }

  return (
    <AdminScaffold title="Moderação de denúncias" navigation={navigation} currentScreen="AdminModeration">
      <FlatList
        data={reports}
        keyExtractor={(report) => `${report.type}:${report.reportId}`}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={reportsQuery.isRefetching}
            onRefresh={() => void reportsQuery.refetch()}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        ListHeaderComponent={
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
            {(["PENDING", "ACTIONED"] as const).map((option) => (
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
                <MvText variant="caption">{option === "PENDING" ? "Pendentes" : "Já tratadas"}</MvText>
              </TouchableOpacity>
            ))}
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <MvCard>
              <MvText variant="body3">
                {status === "PENDING" ? "Nenhuma denúncia pendente." : "Nenhuma denúncia já tratada ainda."}
              </MvText>
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
