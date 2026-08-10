import React, { useEffect, useState } from "react";
import { Alert, ScrollView, TouchableOpacity, View } from "react-native";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { MvButton, MvCard, MvInput, MvText, MvToggle } from "../../components/mv";
import { adminApi, AdminDisputeCaseType } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { AdminScaffold } from "./AdminScaffold";
import { handleScreenError } from "../shared/api-helpers";

type Props = {
  navigation: any;
  route: { params: { caseId: string } };
};

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

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function AdminDisputeDetailScreen({ navigation, route }: Props) {
  const { caseId } = route.params;
  const { theme } = useMvTheme();
  const { runWithAuth, showToast } = useAppState();

  const [decision, setDecision] = useState<"REFUNDED" | "DENIED" | "RETRY_CAPTURE" | null>(null);
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [chargeClientDebt, setChargeClientDebt] = useState(false);
  const [clientDebtAmountText, setClientDebtAmountText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [suspendTarget, setSuspendTarget] = useState<"CLIENT" | "PROVIDER" | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspending, setSuspending] = useState(false);

  const detailQuery = useAuthQuery(
    queryKeys.admin.disputeCaseDetail(caseId),
    (token) => adminApi.getDisputeCaseDetail(token, caseId)
  );

  const disputeCase = detailQuery.data;

  useEffect(() => {
    if (detailQuery.error) {
      handleScreenError({
        error: detailQuery.error,
        showToast,
        fallbackMessage: "Falha ao carregar o caso.",
        navigation
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailQuery.error, navigation]);

  useEffect(() => {
    if (disputeCase && !amountText) {
      setAmountText((disputeCase.amountCents / 100).toFixed(2).replace(".", ","));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputeCase]);

  async function submitResolution() {
    if (!disputeCase || !decision) return;

    const trimmedNote = note.trim();
    if (trimmedNote.length < 5) {
      showToast("Explique o motivo da decisão (mínimo 5 caracteres).", "error");
      return;
    }

    let amountCents: number | undefined;
    if (decision === "REFUNDED") {
      const normalized = amountText.trim().replace(/\./g, "").replace(",", ".");
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        showToast("Informe um valor de reembolso válido.", "error");
        return;
      }
      amountCents = Math.round(parsed * 100);
    }

    let chargeClientDebtCents: number | undefined;
    if (decision === "DENIED" && chargeClientDebt) {
      const normalized = clientDebtAmountText.trim().replace(/\./g, "").replace(",", ".");
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        showToast("Informe um valor de pendência válido.", "error");
        return;
      }
      chargeClientDebtCents = Math.round(parsed * 100);
    }

    try {
      setSubmitting(true);
      await runWithAuth((token) =>
        adminApi.resolveDisputeCase(token, caseId, {
          resolution: decision,
          amountCents,
          note: trimmedNote,
          chargeClientDebtCents
        })
      );
      showToast("Caso resolvido. As partes foram notificadas.", "success");
      await detailQuery.refetch();
      setDecision(null);
      setNote("");
      setChargeClientDebt(false);
      setClientDebtAmountText("");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao resolver o caso.", navigation });
    } finally {
      setSubmitting(false);
    }
  }

  // Frente 7 (segunda camada), Lote 9: resolver uma disputa aciona chamadas
  // reais ao gateway de pagamento (captura/liberação de pré-autorização) e
  // não existe "desfazer decisão" em lugar nenhum da tela — diferente de
  // outras ações de impacto menor (ocultar post, excluir exercício), que já
  // pedem confirmação nativa antes de executar.
  function confirmSubmitResolution() {
    if (!decision) return;
    const actionLabel =
      decision === "REFUNDED"
        ? "liberar a pré-autorização/reembolsar o cliente"
        : decision === "RETRY_CAPTURE"
          ? "tentar capturar o pagamento de novo"
          : disputeCase?.type === "CAPTURE_FAILED"
            ? "manter sem cobrar"
            : "negar o reembolso e capturar o pagamento a favor do profissional";
    Alert.alert(
      "Confirmar decisão?",
      `Esta ação vai ${actionLabel}, é executada de verdade no Mercado Pago e não pode ser desfeita nesta tela. As partes serão notificadas imediatamente.`,
      [
        { text: "Revisar de novo", style: "cancel" },
        { text: "Confirmar", style: decision === "DENIED" ? "destructive" : "default", onPress: () => void submitResolution() }
      ]
    );
  }

  async function submitSuspension() {
    if (!disputeCase || !suspendTarget) return;

    const trimmedReason = suspendReason.trim();
    if (trimmedReason.length < 5) {
      showToast("Explique o motivo da suspensão (mínimo 5 caracteres).", "error");
      return;
    }

    const targetUserId = suspendTarget === "CLIENT" ? disputeCase.client.id : disputeCase.provider.user.id;

    try {
      setSuspending(true);
      await runWithAuth((token) => adminApi.suspendUser(token, targetUserId, trimmedReason));
      showToast("Usuário suspenso.", "success");
      await detailQuery.refetch();
      setSuspendTarget(null);
      setSuspendReason("");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao suspender o usuário.", navigation });
    } finally {
      setSuspending(false);
    }
  }

  async function reactivate(userId: string) {
    try {
      setSuspending(true);
      await runWithAuth((token) => adminApi.reactivateUser(token, userId));
      showToast("Usuário reativado.", "success");
      await detailQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao reativar o usuário.", navigation });
    } finally {
      setSuspending(false);
    }
  }

  if (detailQuery.isLoading || !disputeCase) {
    return (
      <AdminScaffold title="Detalhe do caso" navigation={navigation} currentScreen="AdminDisputes">
        <View style={{ padding: 16 }}>
          <MvText variant="body3">Carregando...</MvText>
        </View>
      </AdminScaffold>
    );
  }

  const booking = disputeCase.booking;
  const noShowReport = disputeCase.noShowReport;
  const consultancyContract = disputeCase.consultancyContract;
  const presentialPackage = disputeCase.presentialPackage;
  const presentialPackageCycle = disputeCase.presentialPackageCycle;

  return (
    <AdminScaffold title="Detalhe do caso" navigation={navigation} currentScreen="AdminDisputes">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 12 }}>
        <MvButton
          variant="outline"
          label="Voltar para lista"
          onPress={() => navigation.goBack()}
        />

        <MvCard>
          <View style={{ gap: 6 }}>
            <MvText variant="h2">{TYPE_LABEL[disputeCase.type]}</MvText>
            <MvText variant="body4" color="secondary">Aberto em {formatDateTime(disputeCase.createdAt)}</MvText>
            <MvText variant="body4">Cliente: {disputeCase.client.name} ({disputeCase.client.email})</MvText>
            <MvText variant="body4">
              Profissional: {disputeCase.provider.displayName} ({disputeCase.provider.user.email})
            </MvText>
            <MvText variant="semi2">Valor em disputa: {formatCents(disputeCase.amountCents)}</MvText>
            {disputeCase.contextNote ? (
              <MvText variant="body4" color="secondary">Motivo: {disputeCase.contextNote}</MvText>
            ) : null}
            <View style={{ flexDirection: "row", gap: 16 }}>
              <TouchableOpacity
                onPress={() => navigation.navigate("AdminUserSearch", { initialQuery: disputeCase.client.email })}
              >
                <MvText variant="caption" color="green">Ver cadastro do cliente →</MvText>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigation.navigate("AdminUserSearch", { initialQuery: disputeCase.provider.user.email })}
              >
                <MvText variant="caption" color="green">Ver cadastro do profissional →</MvText>
              </TouchableOpacity>
            </View>
          </View>
        </MvCard>

        <MvCard>
          <View style={{ gap: 10 }}>
            <MvText variant="semi2">Ações administrativas</MvText>

            {[
              { role: "CLIENT" as const, label: "Cliente", user: disputeCase.client },
              { role: "PROVIDER" as const, label: "Profissional", user: disputeCase.provider.user }
            ].map(({ role, label, user }) => (
              <View key={role} style={{ gap: 4 }}>
                <MvText variant="body4">
                  {label}: {user.name} {user.suspendedAt ? "— suspenso" : ""}
                </MvText>
                {user.suspendedAt ? (
                  <MvButton
                    variant="outline"
                    label="Reativar conta"
                    loading={suspending}
                    onPress={() => void reactivate(user.id)}
                  />
                ) : (
                  <MvButton
                    variant={suspendTarget === role ? "danger" : "outline"}
                    label={`Suspender ${label.toLowerCase()}`}
                    onPress={() => setSuspendTarget(suspendTarget === role ? null : role)}
                  />
                )}
              </View>
            ))}

            {suspendTarget ? (
              <View style={{ gap: 4 }}>
                <MvText variant="caption" color="secondary">
                  Motivo da suspensão — o usuário verá esse texto e não conseguirá mais fazer login
                </MvText>
                <MvInput
                  multiline
                  numberOfLines={3}
                  maxLength={500}
                  placeholder="Explique o motivo (ex: fraude confirmada, abuso reportado)"
                  value={suspendReason}
                  onChangeText={setSuspendReason}
                  style={{ textAlignVertical: "top" } as any}
                />
                <MvButton
                  variant="danger"
                  label="Confirmar suspensão"
                  loading={suspending}
                  onPress={() => void submitSuspension()}
                />
                <MvButton
                  variant="ghost"
                  label="Cancelar"
                  onPress={() => {
                    setSuspendTarget(null);
                    setSuspendReason("");
                  }}
                />
              </View>
            ) : null}
          </View>
        </MvCard>

        {noShowReport ? (
          <MvCard>
            <View style={{ gap: 6 }}>
              <MvText variant="semi2">Relato de falta</MvText>
              <MvText variant="body4">
                Motivo do relato: {noShowReport.reportReason ?? "Não informado"}
              </MvText>
              <MvText variant="body4">
                Motivo da contestação: {noShowReport.contestReason ?? "Não informado"}
              </MvText>
              <MvText variant="body4" color="secondary">
                Prazo de contestação: {formatDateTime(noShowReport.contestDeadlineAt)}
              </MvText>
            </View>
          </MvCard>
        ) : null}

        {booking ? (
          <MvCard>
            <View style={{ gap: 6 }}>
              <MvText variant="semi2">Agendamento</MvText>
              <MvText variant="body4">Serviço: {booking.category?.name ?? "—"}</MvText>
              <MvText variant="body4">Horário marcado: {formatDateTime(booking.scheduledAt)}</MvText>
              <MvText variant="body4">Local: {booking.sessionLocation ?? "—"}</MvText>
              <MvText variant="body4">
                Presença confirmada por código:{" "}
                {booking.attendanceCodeValidatedAt ? formatDateTime(booking.attendanceCodeValidatedAt) : "Não"}
              </MvText>
              <MvText variant="body4">
                Ciência de início imediato (dispensa do prazo de arrependimento):{" "}
                {booking.immediateExecutionAcknowledgedAt
                  ? formatDateTime(booking.immediateExecutionAcknowledgedAt)
                  : "Não coletada"}
              </MvText>
              <MvText variant="body4">
                Selfies de comprovação enviadas: {booking.completionEvidences.length}
              </MvText>
              <MvText variant="body4">
                Mensagens trocadas no chat: {booking.chatMessages.length}
              </MvText>
            </View>
          </MvCard>
        ) : null}

        {consultancyContract ? (
          <MvCard>
            <View style={{ gap: 6 }}>
              <MvText variant="semi2">Consultoria</MvText>
              <MvText variant="body4">Oferta: {consultancyContract.offer?.title ?? "—"}</MvText>
              <MvText variant="body4">Valor pago: {formatCents(consultancyContract.paymentAmountCents)}</MvText>
            </View>
          </MvCard>
        ) : null}

        {disputeCase.trainingPlan ? (
          <MvCard>
            <View style={{ gap: 6 }}>
              <MvText variant="semi2">Ficha de treino em disputa</MvText>
              <MvText variant="body4">Título: {disputeCase.trainingPlan.title}</MvText>
              {disputeCase.trainingPlan.description ? (
                <MvText variant="body4" color="secondary">{disputeCase.trainingPlan.description}</MvText>
              ) : null}
              <MvText variant="body4" color="secondary">
                Entregue em: {formatDateTime(disputeCase.trainingPlan.createdAt)}
              </MvText>
              {!disputeCase.trainingPlan.isActive ? (
                <MvText variant="body4" color="secondary">Esta ficha não é mais a ativa do contrato.</MvText>
              ) : null}
              {/* Frente 4 (Criação/entrega/evolução do treino), Lote 3: antes o
                  admin só via título/data - nunca os exercícios prescritos,
                  exatamente o que precisa julgar se a ficha era vazia/
                  inadequada. */}
              {disputeCase.trainingPlan.exercises.length > 0 ? (
                <View style={{ gap: 8, marginTop: 6 }}>
                  <MvText variant="semi3">Exercícios prescritos ({disputeCase.trainingPlan.exercises.length})</MvText>
                  {disputeCase.trainingPlan.exercises.map((ex, index) => (
                    <View key={ex.id} style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: "rgba(127,127,127,0.25)" }}>
                      <MvText variant="body4">{index + 1}. {ex.name}</MvText>
                      <MvText variant="caption" color="secondary">
                        {ex.repetitionsSets} · carga: {ex.load}
                        {ex.restSeconds ? ` · descanso: ${ex.restSeconds}s` : ""}
                      </MvText>
                    </View>
                  ))}
                </View>
              ) : (
                <MvText variant="body4" color="secondary">Nenhum exercício registrado nesta ficha.</MvText>
              )}
            </View>
          </MvCard>
        ) : null}

        {presentialPackage ? (
          <MvCard>
            <View style={{ gap: 6 }}>
              <MvText variant="semi2">Pacote presencial</MvText>
              <MvText variant="body4">Oferta: {presentialPackage.offer?.title ?? "—"}</MvText>
              {presentialPackageCycle ? (
                <MvText variant="body4">
                  Ciclo #{presentialPackageCycle.cycleIndex} — {formatCents(presentialPackageCycle.amountCents)}
                </MvText>
              ) : null}
            </View>
          </MvCard>
        ) : null}

        {disputeCase.status === "RESOLVED" ? (
          <MvCard>
            <View style={{ gap: 6 }}>
              <MvText variant="semi2">Decisão já registrada</MvText>
              <MvText variant="body4">
                {disputeCase.resolution === "REFUNDED"
                  ? "Cliente reembolsado"
                  : disputeCase.resolution === "CAPTURED"
                    ? "Cobrança capturada com sucesso"
                    : disputeCase.type === "CAPTURE_FAILED"
                      ? "Mantido sem cobrar"
                      : "Reembolso negado"}
                {disputeCase.resolvedAmountCents ? ` — ${formatCents(disputeCase.resolvedAmountCents)}` : ""}
              </MvText>
              <MvText variant="body4">Motivo: {disputeCase.resolutionNote}</MvText>
              {disputeCase.resolvedByAdmin ? (
                <MvText variant="body4" color="secondary">Resolvido por: {disputeCase.resolvedByAdmin.name}</MvText>
              ) : null}
              {disputeCase.resolvedAt ? (
                <MvText variant="body4" color="secondary">Em: {formatDateTime(disputeCase.resolvedAt)}</MvText>
              ) : null}
            </View>
          </MvCard>
        ) : (
          <MvCard>
            <View style={{ gap: 10 }}>
              <MvText variant="semi2">Decidir este caso</MvText>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {disputeCase.type === "CAPTURE_FAILED" ? (
                  <MvButton
                    variant={decision === "RETRY_CAPTURE" ? "primary" : "outline"}
                    label="Tentar capturar de novo"
                    onPress={() => setDecision("RETRY_CAPTURE")}
                    style={{ flex: 1 }}
                  />
                ) : (
                  <MvButton
                    variant={decision === "REFUNDED" ? "primary" : "outline"}
                    label="Reembolsar"
                    onPress={() => setDecision("REFUNDED")}
                    style={{ flex: 1 }}
                  />
                )}
                <MvButton
                  variant={decision === "DENIED" ? "danger" : "outline"}
                  label={disputeCase.type === "CAPTURE_FAILED" ? "Manter sem cobrar" : "Negar reembolso"}
                  onPress={() => setDecision("DENIED")}
                  style={{ flex: 1 }}
                />
              </View>

              {decision === "REFUNDED" ? (
                <View style={{ gap: 4 }}>
                  <MvText variant="caption" color="secondary">
                    Valor a devolver (máximo {formatCents(disputeCase.amountCents)})
                  </MvText>
                  <MvInput
                    keyboardType="decimal-pad"
                    value={amountText}
                    onChangeText={setAmountText}
                    placeholder="0,00"
                  />
                </View>
              ) : null}

              {decision === "DENIED" ? (
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <MvText variant="caption" color="secondary" style={{ flex: 1, marginRight: 8 }}>
                      Este aluno já recebeu um reembolso indevido antes desta disputa e precisa devolver o valor
                    </MvText>
                    <MvToggle value={chargeClientDebt} onValueChange={setChargeClientDebt} />
                  </View>
                  {chargeClientDebt ? (
                    <View style={{ gap: 4 }}>
                      <MvText variant="caption" color="secondary">Valor a cobrar do aluno</MvText>
                      <MvInput
                        keyboardType="decimal-pad"
                        value={clientDebtAmountText}
                        onChangeText={setClientDebtAmountText}
                        placeholder="0,00"
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}

              {decision ? (
                <View style={{ gap: 4 }}>
                  <MvText variant="caption" color="secondary">
                    Motivo da decisão — este texto será enviado ao cliente e ao profissional
                  </MvText>
                  <MvInput
                    multiline
                    numberOfLines={4}
                    maxLength={500}
                    placeholder="Explique de forma simples por que decidiu assim"
                    value={note}
                    onChangeText={setNote}
                    style={{ textAlignVertical: "top" } as any}
                  />
                  <MvText variant="caption" color="secondary">{note.length}/500</MvText>
                  <MvButton
                    variant={decision === "DENIED" ? "danger" : "primary"}
                    label={
                      decision === "REFUNDED"
                        ? "Confirmar reembolso"
                        : decision === "RETRY_CAPTURE"
                          ? "Confirmar nova tentativa de captura"
                          : disputeCase.type === "CAPTURE_FAILED"
                            ? "Confirmar sem cobrar"
                            : "Confirmar negativa"
                    }
                    loading={submitting}
                    onPress={confirmSubmitResolution}
                  />
                  <MvButton
                    variant="ghost"
                    label="Cancelar"
                    onPress={() => {
                      setDecision(null);
                      setNote("");
                    }}
                  />
                </View>
              ) : null}
            </View>
          </MvCard>
        )}
      </ScrollView>
    </AdminScaffold>
  );
}
