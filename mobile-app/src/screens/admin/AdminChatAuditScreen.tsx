import React, { useCallback, useState } from "react";
import { FlatList, RefreshControl, TouchableOpacity, View } from "react-native";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import {
  adminApi,
  AdminChatAuditSessionSummary
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { formatBRDateTime, formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { AdminScaffold } from "./AdminScaffold";

const PAGE_SIZE = 20;

type Props = {
  navigation: any;
};

function sanitizeDateInput(value: string) {
  return value.trim();
}

function isValidDateInput(value: string) {
  if (!value.trim()) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function AdminChatAuditScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const [clientEmail, setClientEmail] = useState("");
  const [providerEmail, setProviderEmail] = useState("");
  const [startedFrom, setStartedFrom] = useState("");
  const [startedTo, setStartedTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [items, setItems] = useState<AdminChatAuditSessionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const hasAnyFilter =
    Boolean(clientEmail.trim()) ||
    Boolean(providerEmail.trim()) ||
    Boolean(startedFrom.trim()) ||
    Boolean(startedTo.trim());

  const load = useCallback(
    async (append: boolean) => {
      if (!hasAnyFilter) {
        showToast("Informe ao menos um filtro para buscar conversas.", "error");
        return;
      }
      if (!isValidDateInput(startedFrom) || !isValidDateInput(startedTo)) {
        showToast("Use o formato AAAA-MM-DD para as datas.", "error");
        return;
      }

      try {
        if (append) setLoadingMore(true);
        else setLoading(true);

        const payload = await runWithAuth((token) =>
          adminApi.listChatAuditSessions(token, {
            clientEmail: clientEmail.trim() || undefined,
            providerEmail: providerEmail.trim() || undefined,
            startedFrom: sanitizeDateInput(startedFrom) || undefined,
            startedTo: sanitizeDateInput(startedTo) || undefined,
            take: PAGE_SIZE,
            cursor: append ? nextCursor ?? undefined : undefined
          })
        );

        setItems((current) => {
          const base = append ? [...current, ...payload.items] : payload.items;
          const unique = new Map<string, AdminChatAuditSessionSummary>();
          for (const item of base) {
            if (!unique.has(item.bookingId)) {
              unique.set(item.bookingId, item);
            }
          }
          return [...unique.values()];
        });
        setNextCursor(payload.nextCursor);
      } catch (error) {
        handleScreenError({
          error,
          showToast,
          fallbackMessage: "Falha ao buscar conversas para auditoria.",
          navigation
        });
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [
      clientEmail,
      hasAnyFilter,
      navigation,
      nextCursor,
      providerEmail,
      runWithAuth,
      showToast,
      startedFrom,
      startedTo
    ]
  );

  return (
    <AdminScaffold title="Auditoria de chats" navigation={navigation} currentScreen="AdminChatAudit">
      <FlatList
        data={items}
        keyExtractor={(item) => item.bookingId}
        contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load(false)}
            tintColor="#4CAF50"
            colors={["#4CAF50"]}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 10 }}>
            <MvCard>
              <View style={{ gap: 8 }}>
                <MvText variant="semi2">Filtros</MvText>
                <MvInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="E-mail do cliente"
                  value={clientEmail}
                  onChangeText={setClientEmail}
                />
                <MvInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="E-mail do prestador"
                  value={providerEmail}
                  onChangeText={setProviderEmail}
                />
                <MvInput
                  placeholder="Data de inicio da conversa (AAAA-MM-DD)"
                  value={startedFrom}
                  onChangeText={setStartedFrom}
                />
                <MvInput
                  placeholder="Data final da conversa (AAAA-MM-DD, opcional)"
                  value={startedTo}
                  onChangeText={setStartedTo}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <MvButton
                      label="Buscar"
                      loading={loading}
                      onPress={() => void load(false)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvButton
                      variant="outline"
                      label="Limpar"
                      onPress={() => {
                        setClientEmail("");
                        setProviderEmail("");
                        setStartedFrom("");
                        setStartedTo("");
                        setItems([]);
                        setNextCursor(null);
                      }}
                    />
                  </View>
                </View>
                <MvText variant="caption" color="secondary">
                  As mensagens são carregadas somente quando você abre um item.
                </MvText>
              </View>
            </MvCard>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.86}
            onPress={() => navigation.navigate("AdminChatAuditDetail", { bookingId: item.bookingId })}
          >
            <MvCard>
              <View style={{ gap: 5 }}>
                <MvText variant="semi2">
                  {item.client.name} x {item.provider.name}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Cliente: {item.client.email}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Prestador: {item.provider.email}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Início da conversa: {formatBRDateTime(item.chatStartedAt)}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Agendamento: {formatBRDateTime(item.bookingScheduledAt)}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Local: {item.sessionLocation?.trim() || "Nao informado"}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Valor: {formatCurrencyBRL(item.priceCents / 100)} {item.currency}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Servico: {item.serviceType}
                </MvText>
                <MvText variant="caption" color="secondary">
                  Mensagens: {item.messageCount}
                </MvText>
              </View>
            </MvCard>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading ? (
            <MvCard>
              <MvText variant="body3" color="secondary">
                Nenhum chat encontrado para os filtros informados.
              </MvText>
            </MvCard>
          ) : null
        }
        ListFooterComponent={
          nextCursor ? (
            <View style={{ marginTop: 8 }}>
              <MvButton
                variant="outline"
                label={loadingMore ? "Carregando..." : "Carregar mais"}
                loading={loadingMore}
                onPress={() => void load(true)}
              />
            </View>
          ) : null
        }
      />
    </AdminScaffold>
  );
}
