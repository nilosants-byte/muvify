import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
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
  CAPTURE_FAILED: "Falha na cobrança de uma sessão concluída"
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

  const [decision, setDecision] = useState<"REFUNDED" | "DENIED" | null>(null);
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [chargeClientDebt, setChargeClientDebt] = useState(false);
  const [clientDebtAmountText, setClientDebtAmountText] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        <MvCard>
          <View style={{ gap: 6 }}>
            <MvText variant="h2">{TYPE_LABEL[disputeCase.type]}</MvText>
            <MvText variant="body4" color="secondary">Aberto em {formatDateTime(disputeCase.createdAt)}</MvText>
            <MvText variant="body4">Cliente: {disputeCase.client.name} ({disputeCase.client.email})</MvText>
            <MvText variant="body4">
              Profissional: {disputeCase.provider.displayName} ({disputeCase.provider.user.email})
            </MvText>
            <MvText variant="semi2">Valor em disputa: {formatCents(disputeCase.amountCents)}</MvText>
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
                {disputeCase.resolution === "REFUNDED" ? "Cliente reembolsado" : "Reembolso negado"}
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
              <View style={{ flexDirection: "row", gap: 8 }}>
                <MvButton
                  variant={decision === "REFUNDED" ? "primary" : "outline"}
                  label="Reembolsar"
                  onPress={() => setDecision("REFUNDED")}
                  style={{ flex: 1 }}
                />
                <MvButton
                  variant={decision === "DENIED" ? "danger" : "outline"}
                  label="Negar reembolso"
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
                    label={decision === "REFUNDED" ? "Confirmar reembolso" : "Confirmar negativa"}
                    loading={submitting}
                    onPress={() => void submitResolution()}
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
