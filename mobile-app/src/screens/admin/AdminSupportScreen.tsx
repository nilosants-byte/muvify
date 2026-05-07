import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, TouchableOpacity, View } from "react-native";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { adminApi, AdminSupportTicket } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { AdminScaffold } from "./AdminScaffold";
import { formatBRDateTime } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = {
  navigation: any;
};

type SupportStatus = "OPEN" | "ANSWERED";

export function AdminSupportScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState<AdminSupportTicket[]>([]);
  const [status, setStatus] = useState<SupportStatus>("OPEN");
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [responseMessage, setResponseMessage] = useState("");
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const payload = await runWithAuth((token) =>
        adminApi.listSupportTickets(token, { status, take: 100 })
      );
      setTickets(payload);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar chamados de suporte.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast, status]);

  useEffect(() => {
    void load();
  }, [load]);

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
      await load();
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

  return (
    <AdminScaffold title="Suporte ao usuário" navigation={navigation} currentScreen="AdminSupport">
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor="#4CAF50"
            colors={["#4CAF50"]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 10 }}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["OPEN", "ANSWERED"] as const).map((option) => (
            <TouchableOpacity
              key={option}
              onPress={() => {
                setStatus(option);
                setAnsweringId(null);
                setResponseMessage("");
              }}
              style={{
                borderWidth: 1,
                borderColor: status === option ? "rgba(76,175,80,0.8)" : "rgba(127,127,127,0.35)",
                borderRadius: 20,
                paddingHorizontal: 12,
                paddingVertical: 8
              }}
            >
              <MvText variant="caption">{option === "OPEN" ? "Abertos" : "Respondidos"}</MvText>
            </TouchableOpacity>
          ))}
        </View>

        {tickets.length === 0 ? (
          <MvCard>
            <MvText variant="body3">Nenhum chamado encontrado nessa fila.</MvText>
          </MvCard>
        ) : null}

        {tickets.map((ticket) => {
          const isAnsweringThis = answeringId === ticket.id;
          const isSubmittingThis = submittingId === ticket.id;
          return (
            <MvCard key={ticket.id}>
              <View style={{ gap: 8 }}>
                <MvText variant="semi2">{ticket.subject?.trim() || "Solicitacao sem assunto"}</MvText>
                <MvText variant="body4" color="secondary">{ticket.user.name} - {ticket.user.email}</MvText>
                <MvText variant="body3">{ticket.message}</MvText>
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
                        maxLength={300}
                        value={responseMessage}
                        onChangeText={setResponseMessage}
                        placeholder="Digite a devolutiva para o usuário (máximo 300 caracteres)"
                        style={{ textAlignVertical: "top" } as any}
                      />
                      <MvText variant="caption" color="secondary">
                        {responseMessage.length}/300
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
        })}
      </ScrollView>
    </AdminScaffold>
  );
}
