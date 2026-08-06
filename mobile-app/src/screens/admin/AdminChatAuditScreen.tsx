import React, { useCallback, useState } from "react";
import { FlatList, RefreshControl, TouchableOpacity, View } from "react-native";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import {
  adminApi,
  AdminChatAuditSessionSummary
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { formatBRDateTime, formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { AdminScaffold } from "./AdminScaffold";

const PAGE_SIZE = 50;

type Props = {
  navigation: any;
};

function sanitizeDateInput(value: string) {
  return value.trim();
}

function isValidDateInput(value: string) {
  if (!value.trim()) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false;
  const d = new Date(value.trim());
  if (isNaN(d.getTime())) return false;
  return d <= new Date();
}

export function AdminChatAuditScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
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
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (clientEmail.trim() && !emailRegex.test(clientEmail.trim())) {
        showToast("E-mail do cliente inválido.", "error");
        return;
      }
      if (providerEmail.trim() && !emailRegex.test(providerEmail.trim())) {
        showToast("E-mail do profissional inválido.", "error");
        return;
      }
      if (startedFrom.trim() && startedTo.trim() && new Date(startedFrom) > new Date(startedTo)) {
        showToast("A data inicial deve ser anterior ou igual à data final.", "error");
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
        if (append) setNextCursor(null);
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
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        data={items}
        keyExtractor={(item) => item.bookingId}
        contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load(false)}
            tintColor={theme.primary}
            colors={[theme.primary]}
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
                  maxLength={254}
                />
                <MvInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="E-mail do profissional"
                  value={providerEmail}
                  onChangeText={setProviderEmail}
                  maxLength={254}
                />
                <MvInput
                  placeholder="Data de início da conversa (AAAA-MM-DD)"
                  value={startedFrom}
                  onChangeText={setStartedFrom}
                  maxLength={10}
                />
                <MvInput
                  placeholder="Data final da conversa (AAAA-MM-DD, opcional)"
                  value={startedTo}
                  onChangeText={setStartedTo}
                  maxLength={10}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <MvButton
                      label="Buscar"
                      loading={loading}
                      disabled={loading || !hasAnyFilter}
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
            accessibilityRole="button"
            accessibilityLabel={`Ver chat: ${item.client.name ?? "Cliente"} x ${item.provider.name ?? "Profissional"}`}
            onPress={() => navigation.navigate("AdminChatAuditDetail", { bookingId: item.bookingId })}
          >
            <MvCard>
              <View style={{ gap: 5 }}>
                <MvText variant="semi2">
                  {item.client.name ?? "Cliente"} x {item.provider.name ?? "Profissional"}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Cliente: {item.client.email ?? "—"}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Profissional: {item.provider.email ?? "—"}
                </MvText>
                <View style={{ flexDirection: "row", gap: 16 }}>
                  {item.client.email ? (
                    <TouchableOpacity
                      onPress={() => navigation.navigate("AdminUserSearch", { initialQuery: item.client.email! })}
                    >
                      <MvText variant="caption" color="green">Buscar cliente →</MvText>
                    </TouchableOpacity>
                  ) : null}
                  {item.provider.email ? (
                    <TouchableOpacity
                      onPress={() => navigation.navigate("AdminUserSearch", { initialQuery: item.provider.email! })}
                    >
                      <MvText variant="caption" color="green">Buscar profissional →</MvText>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <MvText variant="body4" color="secondary">
                  Início da conversa: {formatBRDateTime(item.chatStartedAt)}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Agendamento: {formatBRDateTime(item.bookingScheduledAt)}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Local: {item.sessionLocation?.trim() || "Não informado"}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Valor: {formatCurrencyBRL(item.priceCents / 100)} {item.currency}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Serviço: {item.serviceType ?? "Não informado"}
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
