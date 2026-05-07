import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MvButton, MvCard, MvText } from "../../components/mv";
import {
  adminApi,
  AdminChatAuditMessage,
  AdminChatAuditSessionSummary
} from "../../services/api/client";
import { AdminStackParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { formatBRDateTime, formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { AdminScaffold } from "./AdminScaffold";

type Props = NativeStackScreenProps<AdminStackParamList, "AdminChatAuditDetail">;

const PAGE_SIZE = 80;

function messageAuthor(item: AdminChatAuditMessage) {
  if (item.isSystem) return "Sistema";
  return item.senderName ?? "Usuario";
}

export function AdminChatAuditDetailScreen({ navigation, route }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const bookingId = route.params.bookingId;

  const [session, setSession] = useState<AdminChatAuditSessionSummary | null>(null);
  const [messages, setMessages] = useState<AdminChatAuditMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const load = useCallback(
    async (append: boolean) => {
      if (append && !nextCursor) {
        return;
      }

      try {
        if (append) setLoadingMore(true);
        else setLoading(true);

        const payload = await runWithAuth((token) =>
          adminApi.getChatAuditSessionMessages(token, bookingId, {
            take: PAGE_SIZE,
            cursor: append ? nextCursor ?? undefined : undefined
          })
        );

        setSession(payload.session);
        setMessages((current) => {
          const merged = append ? [...payload.messages, ...current] : payload.messages;
          const dedup = new Map<string, AdminChatAuditMessage>();
          for (const item of merged) {
            if (!dedup.has(item.id)) {
              dedup.set(item.id, item);
            }
          }
          return [...dedup.values()];
        });
        setNextCursor(payload.nextCursor);
      } catch (error) {
        handleScreenError({
          error,
          showToast,
          fallbackMessage: "Falha ao carregar mensagens do chat auditado.",
          navigation
        });
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [bookingId, navigation, nextCursor, runWithAuth, showToast]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const participants = useMemo(() => {
    if (!session) return null;
    return `${session.client.name} x ${session.provider.name}`;
  }, [session]);

  return (
    <AdminScaffold title="Detalhe do chat" navigation={navigation} currentScreen="AdminChatAudit">
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 8 }}
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
            <MvButton
              variant="outline"
              label="Voltar para lista"
              onPress={() => navigation.goBack()}
            />

            <MvCard>
              {!session ? (
                <MvText variant="body3" color="secondary">
                  Carregando resumo da conversa...
                </MvText>
              ) : (
                <View style={{ gap: 5 }}>
                  <MvText variant="semi2">{participants}</MvText>
                  <MvText variant="body4" color="secondary">
                    Cliente: {session.client.email}
                  </MvText>
                  <MvText variant="body4" color="secondary">
                    Prestador: {session.provider.email}
                  </MvText>
                  <MvText variant="body4" color="secondary">
                    Inicio da conversa: {formatBRDateTime(session.chatStartedAt)}
                  </MvText>
                  <MvText variant="body4" color="secondary">
                    Ultima mensagem: {formatBRDateTime(session.chatLastMessageAt)}
                  </MvText>
                  <MvText variant="body4" color="secondary">
                    Agendamento: {formatBRDateTime(session.bookingScheduledAt)}
                  </MvText>
                  <MvText variant="body4" color="secondary">
                    Local: {session.sessionLocation?.trim() || "Nao informado"}
                  </MvText>
                  <MvText variant="body4" color="secondary">
                    Valor: {formatCurrencyBRL(session.priceCents / 100)} {session.currency}
                  </MvText>
                  <MvText variant="body4" color="secondary">
                    Servico: {session.serviceType}
                  </MvText>
                  <MvText variant="caption" color="secondary">
                    Total de mensagens: {session.messageCount}
                  </MvText>
                </View>
              )}
            </MvCard>

            {nextCursor ? (
              <MvButton
                variant="outline"
                label={loadingMore ? "Carregando mensagens antigas..." : "Carregar mensagens anteriores"}
                loading={loadingMore}
                onPress={() => void load(true)}
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <MvCard
            style={{
              marginLeft: item.isSystem ? 0 : item.senderEmail === session?.provider.email ? 28 : 0,
              marginRight: item.isSystem ? 0 : item.senderEmail === session?.client.email ? 28 : 0,
              borderColor: item.isSystem ? "rgba(76,175,80,0.35)" : undefined
            }}
          >
            <View style={{ gap: 4 }}>
              <MvText variant="semi3">{messageAuthor(item)}</MvText>
              <MvText variant="body4" color="secondary">
                {item.senderEmail ?? (item.isSystem ? "Mensagem do sistema" : "Sem e-mail")}
              </MvText>
              <MvText variant="body3">{item.content}</MvText>
              <MvText variant="caption" color="secondary">
                {formatBRDateTime(item.createdAt)}
              </MvText>
            </View>
          </MvCard>
        )}
        ListEmptyComponent={
          !loading ? (
            <MvCard>
              <MvText variant="body3" color="secondary">
                Nenhuma mensagem encontrada para este chat.
              </MvText>
            </MvCard>
          ) : null
        }
      />
    </AdminScaffold>
  );
}
