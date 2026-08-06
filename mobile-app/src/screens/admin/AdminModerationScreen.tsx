import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Alert, RefreshControl, ScrollView, TouchableOpacity, View } from "react-native";
import { MvBadge, MvButton, MvCard, MvText } from "../../components/mv";
import { AdminReportType, adminApi } from "../../services/api/client";
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

export function AdminModerationScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const [processingKey, setProcessingKey] = useState<string | null>(null);

  const reportsQuery = useAuthQuery(
    queryKeys.admin.reports({ status: "PENDING", take: 50 }),
    (token) => adminApi.listReports(token, { status: "PENDING", take: 50 })
  );

  const loading = reportsQuery.isLoading;
  const reports = reportsQuery.data?.items ?? [];

  useEffect(() => {
    if (reportsQuery.error) {
      handleScreenError({ error: reportsQuery.error, showToast, fallbackMessage: "Falha ao carregar denúncias.", navigation });
    }
  }, [reportsQuery.error, showToast, navigation]);

  useFocusEffect(useCallback(() => {
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
      "O conteúdo denunciado vai sumir para todos os usuários. A ação pode ser revertida diretamente no banco por outro admin, se necessário, mas não existe botão de reverter nesta tela ainda.",
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

  return (
    <AdminScaffold title="Moderação de denúncias" navigation={navigation} currentScreen="AdminModeration">
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={reportsQuery.isRefetching}
            onRefresh={() => void reportsQuery.refetch()}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 10 }}
      >
        {!loading && reports.length === 0 ? (
          <MvCard>
            <MvText variant="body3">Nenhuma denúncia pendente.</MvText>
          </MvCard>
        ) : null}

        {reports.map((report) => {
          const dismissKey = `dismiss:${report.type}:${report.reportId}`;
          const hideKey = `hide:${report.type}:${report.reportId}`;
          const isProcessing = processingKey === dismissKey || processingKey === hideKey;
          return (
            <MvCard key={`${report.type}:${report.reportId}`}>
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
              </View>
            </MvCard>
          );
        })}
      </ScrollView>
    </AdminScaffold>
  );
}
