import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
import { Alert, FlatList, RefreshControl, TouchableOpacity, View } from "react-native";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { adminApi, AdminSupportTicket } from "../../services/api/client";
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

type SupportStatus = "OPEN" | "ANSWERED";

const PAGE_SIZE = 30;
// Épico de Frentes, Frente 10, Lote 4: mesmo threshold de 48h já usado no
// attentionNeeded (overdueSupportTicketsCount) - mesma promessa de "2 dias
// úteis" já feita na tela de Suporte do usuário.
const OVERDUE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

function isOverdue(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() > OVERDUE_THRESHOLD_MS;
}

export function AdminSupportScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const [status, setStatus] = useState<SupportStatus>("OPEN");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [responseMessage, setResponseMessage] = useState("");
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  // Épico de Frentes, Frente 10, Lote 4: take fixo (100) sem skip - tickets
  // mais antigos (justamente os que mais estouraram prazo) ficavam
  // permanentemente inalcançáveis. "Carregar mais" no mesmo padrão de
  // FriendsListScreen.
  const [tickets, setTickets] = useState<AdminSupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const ticketsQuery = useAuthQuery(
    queryKeys.admin.supportTickets({ status, q, take: PAGE_SIZE }),
    (token) => adminApi.listSupportTickets(token, { status, q: q || undefined, take: PAGE_SIZE })
  );

  const loading = ticketsQuery.isLoading;

  useEffect(() => {
    if (!ticketsQuery.data) return;
    setTickets(ticketsQuery.data.items);
    setTotal(ticketsQuery.data.total);
    setSkip(ticketsQuery.data.items.length);
  }, [ticketsQuery.data]);

  const hasMore = tickets.length < total;

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    try {
      setLoadingMore(true);
      const page = await runWithAuth((token) =>
        adminApi.listSupportTickets(token, { status, q: q || undefined, take: PAGE_SIZE, skip })
      );
      setTickets((prev) => [...prev, ...page.items]);
      setTotal(page.total);
      setSkip((prev) => prev + page.items.length);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar mais chamados." });
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (ticketsQuery.error) {
      handleScreenError({ error: ticketsQuery.error, showToast, fallbackMessage: "Falha ao carregar chamados de suporte.", navigation });
    }
  }, [ticketsQuery.error, showToast, navigation]);

  useFocusEffectSkippingFirst(useCallback(() => {
    setAnsweringId(null);
    setResponseMessage("");
    void ticketsQuery.refetch();
  }, [ticketsQuery.refetch]));

  function submitSearch() {
    setQ(searchInput.trim());
  }

  async function submitReply(ticketId: string) {
    const message = responseMessage.trim();
    if (!message) {
      showToast("Escreva a devolutiva para o usuário.", "error");
      return;
    }
    if (message.length > 300) {
      showToast("A devolutiva deve ter até 300 caracteres.", "error");
      return;
    }

    try {
      setSubmittingId(ticketId);
      await runWithAuth((token) => adminApi.replySupportTicket(token, ticketId, message));
      showToast("Resposta enviada para o usuário.", "success");
      setAnsweringId(null);
      setResponseMessage("");
      await ticketsQuery.refetch();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao enviar resposta de suporte.",
        navigation
      });
    } finally {
      setSubmittingId(null);
    }
  }

  function renderItem({ item: ticket }: { item: AdminSupportTicket }) {
    const isAnsweringThis = answeringId === ticket.id;
    const isSubmittingThis = submittingId === ticket.id;
    return (
      <MvCard style={{ marginBottom: 10 }}>
        <View style={{ gap: 8 }}>
          <MvText variant="semi2">{ticket.subject?.trim() || "Solicitação sem assunto"}</MvText>
          <MvText variant="body4" color="secondary">{ticket.user.name ?? "Usuário"} - {ticket.user.email ?? "—"}</MvText>
          {ticket.user.email ? (
            <TouchableOpacity
              onPress={() => navigation.navigate("AdminUserSearch", { initialQuery: ticket.user.email! })}
            >
              <MvText variant="caption" color="green">Ver cadastro deste usuário →</MvText>
            </TouchableOpacity>
          ) : null}
          {status === "OPEN" && isOverdue(ticket.createdAt) ? (
            <MvBadge label="Vencido (+48h sem resposta)" variant="red" />
          ) : null}
          {ticket.indicators?.isSuspended || ticket.indicators?.hasOpenDebt || ticket.indicators?.hasOpenDispute ? (
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {ticket.indicators.isSuspended ? (
                <MvBadge label="Suspenso" variant="red" />
              ) : null}
              {ticket.indicators.hasOpenDispute ? (
                <MvBadge label="Disputa em aberto" variant="orange" />
              ) : null}
              {ticket.indicators.hasOpenDebt ? (
                <MvBadge label="Dívida em aberto" variant="orange" />
              ) : null}
            </View>
          ) : null}
          <MvText variant="body3" numberOfLines={4}>{ticket.message ?? "Mensagem não disponível"}</MvText>
          <MvText variant="caption" color="secondary">
            Aberto em: {formatBRDateTime(ticket.createdAt)}
          </MvText>
          {ticket.adminResponse ? (
            <View style={{ marginTop: 4 }}>
              <MvText variant="caption" color="secondary">Resposta registrada</MvText>
              <MvText variant="body4">{ticket.adminResponse}</MvText>
            </View>
          ) : null}

          {status === "OPEN" ? (
            isAnsweringThis ? (
              <View style={{ gap: 8, marginTop: 4 }}>
                <MvInput
                  multiline
                  numberOfLines={4}
                  maxLength={2000}
                  value={responseMessage}
                  onChangeText={setResponseMessage}
                  placeholder="Digite a devolutiva para o usuário (máximo 2000 caracteres)"
                  editable={!isSubmittingThis}
                  style={{ textAlignVertical: "top", opacity: isSubmittingThis ? 0.6 : 1 } as any}
                />
                <MvText variant="caption" color="secondary">
                  {responseMessage.length}/2000
                </MvText>
                <MvButton
                  label="Enviar resposta"
                  loading={isSubmittingThis}
                  onPress={() => void submitReply(ticket.id)}
                />
                <MvButton
                  variant="ghost"
                  label="Cancelar"
                  onPress={() => {
                    setAnsweringId(null);
                    setResponseMessage("");
                  }}
                />
              </View>
            ) : (
              <MvButton
                variant="outline"
                label="Responder chamado"
                onPress={() => {
                  setAnsweringId(ticket.id);
                  setResponseMessage("");
                }}
              />
            )
          ) : null}
        </View>
      </MvCard>
    );
  }

  return (
    <AdminScaffold title="Suporte ao usuário" navigation={navigation} currentScreen="AdminSupport">
      <FlatList
        data={tickets}
        keyExtractor={(ticket) => ticket.id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={ticketsQuery.isRefetching}
            onRefresh={() => void ticketsQuery.refetch()}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 10 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <MvInput
                style={{ flex: 1 }}
                placeholder="Buscar por nome ou e-mail do usuário"
                value={searchInput}
                onChangeText={setSearchInput}
                autoCapitalize="none"
                onSubmitEditing={submitSearch}
              />
              <MvButton label="Buscar" onPress={submitSearch} />
            </View>

            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["OPEN", "ANSWERED"] as const).map((option) => (
                <TouchableOpacity
                  key={option}
                  onPress={() => {
                    if (responseMessage.trim()) {
                      Alert.alert(
                        "Descartar resposta?",
                        "Você tem uma resposta em andamento. Deseja descartá-la?",
                        [
                          { text: "Continuar editando", style: "cancel" },
                          { text: "Descartar", style: "destructive", onPress: () => { setStatus(option); setAnsweringId(null); setResponseMessage(""); } },
                        ]
                      );
                    } else {
                      setStatus(option);
                      setAnsweringId(null);
                      setResponseMessage("");
                    }
                  }}
                  style={{
                    borderWidth: 1,
                    borderColor: status === option ? theme.primary : "rgba(127,127,127,0.35)",
                    borderRadius: 20,
                    paddingHorizontal: 12,
                    paddingVertical: 8
                  }}
                >
                  <MvText variant="caption">{option === "OPEN" ? "Abertos" : "Respondidos"}</MvText>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          tickets.length === 0 ? (
            <MvCard>
              <MvText variant="body3">Nenhum chamado encontrado nessa fila.</MvText>
            </MvCard>
          ) : null
        }
        ListFooterComponent={
          hasMore ? (
            <MvButton
              variant="outline"
              label={loadingMore ? "Carregando..." : "Carregar mais"}
              loading={loadingMore}
              onPress={() => void loadMore()}
            />
          ) : null
        }
      />
    </AdminScaffold>
  );
}
