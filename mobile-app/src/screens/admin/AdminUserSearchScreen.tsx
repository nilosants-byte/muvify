import React, { useEffect, useRef, useState } from "react";
import { ScrollView, Share, TouchableOpacity, View } from "react-native";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { adminApi, AdminUserDetail, AdminUserSearchResult } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { AdminScaffold } from "./AdminScaffold";
import { handleScreenError } from "../shared/api-helpers";

type Props = {
  navigation: any;
  route?: { params?: { initialQuery?: string } };
};

function formatCents(amountCents: number) {
  return (amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function AdminUserSearchScreen({ navigation, route }: Props) {
  const { theme } = useMvTheme();
  const { runWithAuth, showToast } = useAppState();

  const initialQuery = route?.params?.initialQuery;
  const [query, setQuery] = useState(initialQuery ?? "");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AdminUserSearchResult[] | null>(null);
  // Épico de Frentes, Frente 10, Lote 4: take fixo (30) sem paginação real
  // - resultado além dos 30 primeiros ficava inalcançável.
  const [resultsTotal, setResultsTotal] = useState(0);
  const [resultsPage, setResultsPage] = useState(1);
  const [loadingMoreResults, setLoadingMoreResults] = useState(false);
  const RESULTS_PAGE_SIZE = 20;

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [suspending, setSuspending] = useState(false);
  const [showSuspendForm, setShowSuspendForm] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");

  const [settingHold, setSettingHold] = useState(false);
  const [showHoldForm, setShowHoldForm] = useState(false);
  const [holdDays, setHoldDays] = useState(90);
  const [holdReason, setHoldReason] = useState("");
  const [exporting, setExporting] = useState(false);

  // Épico de Frentes, Frente 10, Lote 4: changeUserRole existe desde a
  // Frente 3 mas nunca ganhou tela mobile - só chamada HTTP direta.
  const [changingRole, setChangingRole] = useState(false);
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [roleReason, setRoleReason] = useState("");

  async function search() {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      showToast("Digite pelo menos 3 caracteres para buscar.", "error");
      return;
    }
    try {
      setSearching(true);
      setSelectedUserId(null);
      setDetail(null);
      const found = await runWithAuth((token) => adminApi.searchUsers(token, trimmed, { page: 1, limit: RESULTS_PAGE_SIZE }));
      setResults(found.items);
      setResultsTotal(found.total);
      setResultsPage(1);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao buscar usuários.", navigation });
    } finally {
      setSearching(false);
    }
  }

  async function loadMoreResults() {
    const trimmed = query.trim();
    if (loadingMoreResults || !results || results.length >= resultsTotal) return;
    try {
      setLoadingMoreResults(true);
      const nextPage = resultsPage + 1;
      const found = await runWithAuth((token) =>
        adminApi.searchUsers(token, trimmed, { page: nextPage, limit: RESULTS_PAGE_SIZE })
      );
      setResults((prev) => [...(prev ?? []), ...found.items]);
      setResultsTotal(found.total);
      setResultsPage(nextPage);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar mais usuários." });
    } finally {
      setLoadingMoreResults(false);
    }
  }

  const didAutoSearch = useRef(false);
  useEffect(() => {
    if (initialQuery && initialQuery.trim().length >= 3 && !didAutoSearch.current) {
      didAutoSearch.current = true;
      void search();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openUser(userId: string) {
    try {
      setSelectedUserId(userId);
      setLoadingDetail(true);
      setShowSuspendForm(false);
      setSuspendReason("");
      const data = await runWithAuth((token) => adminApi.getUserDetail(token, userId));
      setDetail(data);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar usuário.", navigation });
    } finally {
      setLoadingDetail(false);
    }
  }

  async function submitSuspend() {
    if (!detail) return;
    const trimmedReason = suspendReason.trim();
    if (trimmedReason.length < 5) {
      showToast("Explique o motivo da suspensão (mínimo 5 caracteres).", "error");
      return;
    }
    try {
      setSuspending(true);
      await runWithAuth((token) => adminApi.suspendUser(token, detail.id, trimmedReason));
      showToast("Usuário suspenso.", "success");
      setShowSuspendForm(false);
      setSuspendReason("");
      await openUser(detail.id);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao suspender o usuário.", navigation });
    } finally {
      setSuspending(false);
    }
  }

  async function reactivate() {
    if (!detail) return;
    try {
      setSuspending(true);
      await runWithAuth((token) => adminApi.reactivateUser(token, detail.id));
      showToast("Usuário reativado.", "success");
      await openUser(detail.id);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao reativar o usuário.", navigation });
    } finally {
      setSuspending(false);
    }
  }

  // Raio-X de pagamentos, Rodada 4, Lote 9: legal hold persistido por
  // usuário — o job automático de retenção passa a respeitar isso sem
  // precisar de deploy nenhum (antes só existia a env var).
  async function submitLegalHold() {
    if (!detail) return;
    const trimmedReason = holdReason.trim();
    if (trimmedReason.length < 5) {
      showToast("Explique o motivo do legal hold (mínimo 5 caracteres).", "error");
      return;
    }
    if (!holdDays || holdDays < 1) {
      showToast("Informe quantos dias o hold deve durar.", "error");
      return;
    }
    try {
      setSettingHold(true);
      const until = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000).toISOString();
      await runWithAuth((token) => adminApi.setLegalHold(token, detail.id, until, trimmedReason));
      showToast("Legal hold aplicado.", "success");
      setShowHoldForm(false);
      setHoldReason("");
      await openUser(detail.id);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao aplicar o legal hold.", navigation });
    } finally {
      setSettingHold(false);
    }
  }

  async function clearHold() {
    if (!detail) return;
    try {
      setSettingHold(true);
      await runWithAuth((token) => adminApi.clearLegalHold(token, detail.id));
      showToast("Legal hold removido.", "success");
      await openUser(detail.id);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao remover o legal hold.", navigation });
    } finally {
      setSettingHold(false);
    }
  }

  async function submitChangeRole() {
    if (!detail) return;
    const trimmedReason = roleReason.trim();
    if (trimmedReason.length < 5) {
      showToast("Explique o motivo da troca de tipo de conta (mínimo 5 caracteres).", "error");
      return;
    }
    const newRole = detail.role === "PROVIDER" ? "CLIENT" : "PROVIDER";
    try {
      setChangingRole(true);
      await runWithAuth((token) => adminApi.changeUserRole(token, detail.id, newRole, trimmedReason));
      showToast("Tipo de conta atualizado. A sessão atual do usuário foi encerrada.", "success");
      setShowRoleForm(false);
      setRoleReason("");
      await openUser(detail.id);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao trocar o tipo de conta.", navigation });
    } finally {
      setChangingRole(false);
    }
  }

  // Épico de Frentes, Frente 10, Lote 6 (decisão do usuário: share sheet
  // nativo): o JSON exportado era gerado no backend e descartado - o app
  // só mostrava um toast de sucesso, sem salvar/exibir/compartilhar nada.
  async function exportData() {
    if (!detail) return;
    try {
      setExporting(true);
      const data = await runWithAuth((token) => adminApi.exportUserData(token, detail.id));
      showToast("Exportação gerada e registrada em log de auditoria.", "success");
      await Share.share({
        message: JSON.stringify(data, null, 2),
        title: `Dados exportados — ${detail.name}`
      });
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao exportar dados do usuário.", navigation });
    } finally {
      setExporting(false);
    }
  }

  return (
    <AdminScaffold title="Buscar usuário" navigation={navigation} currentScreen="AdminUserSearch">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 12 }}>
        <MvText variant="body4" color="secondary">
          Busque um cliente ou profissional por nome ou e-mail pra ver dívidas, disputas e status de suspensão num
          lugar só.
        </MvText>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <MvInput
            style={{ flex: 1 }}
            placeholder="Nome ou e-mail"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
          <MvButton label="Buscar" loading={searching} onPress={() => void search()} />
        </View>

        {results && results.length === 0 ? (
          <MvCard>
            <MvText variant="body3">Nenhum usuário encontrado.</MvText>
          </MvCard>
        ) : null}

        {results && !selectedUserId
          ? results.map((u) => (
              <TouchableOpacity key={u.id} onPress={() => void openUser(u.id)}>
                <MvCard>
                  <View style={{ gap: 4 }}>
                    <MvText variant="semi2">
                      {u.name} {u.suspendedAt ? "— suspenso" : ""}
                    </MvText>
                    <MvText variant="body4" color="secondary">{u.email}</MvText>
                    <MvText variant="caption" color="secondary">
                      {u.role === "PROVIDER" || u.isProvider ? "Profissional" : "Cliente"} · desde {formatDate(u.createdAt)}
                    </MvText>
                  </View>
                </MvCard>
              </TouchableOpacity>
            ))
          : null}

        {results && !selectedUserId && results.length < resultsTotal ? (
          <MvButton
            variant="outline"
            label={loadingMoreResults ? "Carregando..." : "Carregar mais"}
            loading={loadingMoreResults}
            onPress={() => void loadMoreResults()}
          />
        ) : null}

        {selectedUserId ? (
          <MvButton variant="ghost" label="← Voltar aos resultados" onPress={() => { setSelectedUserId(null); setDetail(null); }} />
        ) : null}

        {loadingDetail ? (
          <MvCard>
            <MvText variant="body3">Carregando...</MvText>
          </MvCard>
        ) : null}

        {detail ? (
          <>
            <MvCard>
              <View style={{ gap: 6 }}>
                <MvText variant="h2">{detail.name}</MvText>
                <MvText variant="body4" color="secondary">{detail.email}</MvText>
                {detail.phone ? (
                  <MvText variant="body4" color="secondary">{detail.phone}</MvText>
                ) : null}
                <MvText variant="body4">
                  {detail.provider ? "Profissional" : "Cliente"} · desde {formatDate(detail.createdAt)}
                </MvText>
                {/* Épico de Frentes, Frente 10, Lote 4: getUserDetail só trazia
                    dívida/disputa - nada do lado operacional (verificação,
                    tickets, denúncias). */}
                <MvText variant="caption" color="secondary">
                  E-mail {detail.emailVerifiedAt ? "verificado" : "não verificado"} · 2FA {detail.twoFactorEnabled ? "ativo" : "inativo"}
                </MvText>
                <MvText variant="caption" color="secondary">
                  {detail.supportTicketsCount} chamado(s) de suporte · {detail.reportsFiledCount} denúncia(s) feita(s) · {detail.reportsAgainstCount} denúncia(s) recebida(s)
                </MvText>
                {detail.noShowStrikes > 0 ? (
                  <MvText variant="body4" color="secondary">Faltas registradas: {detail.noShowStrikes}</MvText>
                ) : null}
                {detail.provider ? (
                  <MvText variant="body4" color="secondary">
                    CREF: {detail.provider.crefValidationStatus} · Mercado Pago: {detail.provider.mpConnected ? "conectado" : "não conectado"}
                  </MvText>
                ) : null}
                {detail.suspendedAt ? (
                  <MvText variant="body4" style={{ color: theme.danger }}>
                    Suspenso em {formatDate(detail.suspendedAt)} — {detail.suspensionReason}
                  </MvText>
                ) : null}
                {detail.legalHoldUntil ? (
                  <MvText variant="body4" color="secondary">
                    Legal hold até {formatDate(detail.legalHoldUntil)} — {detail.legalHoldReason}
                  </MvText>
                ) : null}
              </View>
            </MvCard>

            <MvCard>
              <View style={{ gap: 8 }}>
                <MvText variant="semi2">Como cliente</MvText>
                <MvText variant="body4" color="secondary">
                  {detail.clientDebts.length} dívida(s) · {detail.clientDisputes.filter((d) => d.status === "OPEN").length} disputa(s) em aberto
                </MvText>
                {detail.clientDebts.slice(0, 5).map((d) => (
                  <MvText key={d.id} variant="body4">
                    {formatCents(d.amountCents)} — {d.status} — {d.reason}
                  </MvText>
                ))}
              </View>
            </MvCard>

            {detail.provider ? (
              <MvCard>
                <View style={{ gap: 8 }}>
                  <MvText variant="semi2">Como profissional</MvText>
                  <MvText variant="body4" color="secondary">
                    {detail.providerDebts.length} dívida(s) · {detail.providerDisputes.filter((d) => d.status === "OPEN").length} disputa(s) em aberto
                  </MvText>
                  {detail.providerDebts.slice(0, 5).map((d) => (
                    <MvText key={d.id} variant="body4">
                      {formatCents(d.amountCents)} — {d.status} — {d.reason}
                    </MvText>
                  ))}
                </View>
              </MvCard>
            ) : null}

            {/* Épico de Frentes, Frente 10, Lote 5: AdminAuditLog era write-only -
                reincidência de um usuário (3ª suspensão em 2 meses, por exemplo)
                ficava invisível sem consultar o banco na mão. */}
            {detail.recentModerationHistory.length > 0 ? (
              <MvCard>
                <View style={{ gap: 8 }}>
                  <MvText variant="semi2">Histórico de moderação</MvText>
                  {detail.recentModerationHistory.map((entry) => (
                    <View key={entry.id} style={{ gap: 2, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.border }}>
                      <MvText variant="body4">{entry.action}</MvText>
                      <MvText variant="caption" color="secondary">
                        {entry.admin.name} · {formatDate(entry.createdAt)}
                      </MvText>
                    </View>
                  ))}
                </View>
              </MvCard>
            ) : null}

            <MvCard>
              <View style={{ gap: 10 }}>
                <MvText variant="semi2">Ações administrativas</MvText>
                {detail.suspendedAt ? (
                  <MvButton variant="outline" label="Reativar conta" loading={suspending} onPress={() => void reactivate()} />
                ) : showSuspendForm ? (
                  <View style={{ gap: 4 }}>
                    <MvText variant="caption" color="secondary">
                      Motivo da suspensão — o usuário verá esse texto e não conseguirá mais fazer login
                    </MvText>
                    <MvInput
                      multiline
                      numberOfLines={3}
                      maxLength={500}
                      placeholder="Explique o motivo"
                      value={suspendReason}
                      onChangeText={setSuspendReason}
                      style={{ textAlignVertical: "top" } as any}
                    />
                    <MvButton variant="danger" label="Confirmar suspensão" loading={suspending} onPress={() => void submitSuspend()} />
                    <MvButton variant="ghost" label="Cancelar" onPress={() => { setShowSuspendForm(false); setSuspendReason(""); }} />
                  </View>
                ) : (
                  <MvButton variant="danger" label="Suspender conta" onPress={() => setShowSuspendForm(true)} />
                )}

                {detail.legalHoldUntil ? (
                  <MvButton variant="outline" label="Remover legal hold" loading={settingHold} onPress={() => void clearHold()} />
                ) : showHoldForm ? (
                  <View style={{ gap: 4 }}>
                    <MvText variant="caption" color="secondary">
                      Legal hold impede que os dados desse usuário sejam apagados/anonimizados pela retenção automática
                    </MvText>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {[30, 90, 365].map((days) => (
                        <MvButton
                          key={days}
                          variant={holdDays === days ? "primary" : "ghost"}
                          label={`${days}d`}
                          onPress={() => setHoldDays(days)}
                        />
                      ))}
                    </View>
                    <MvInput
                      multiline
                      numberOfLines={3}
                      maxLength={500}
                      placeholder="Motivo (ex: processo judicial em curso, número do processo)"
                      value={holdReason}
                      onChangeText={setHoldReason}
                      style={{ textAlignVertical: "top" } as any}
                    />
                    <MvButton variant="primary" label="Aplicar legal hold" loading={settingHold} onPress={() => void submitLegalHold()} />
                    <MvButton variant="ghost" label="Cancelar" onPress={() => { setShowHoldForm(false); setHoldReason(""); }} />
                  </View>
                ) : (
                  <MvButton variant="outline" label="Aplicar legal hold" onPress={() => setShowHoldForm(true)} />
                )}

                {detail.role !== "ADMIN" ? (
                  showRoleForm ? (
                    <View style={{ gap: 4 }}>
                      <MvText variant="caption" color="secondary">
                        Troca {detail.role === "PROVIDER" ? "Profissional → Cliente" : "Cliente → Profissional"}. A
                        sessão atual do usuário será encerrada (precisa fazer login de novo).
                      </MvText>
                      <MvInput
                        multiline
                        numberOfLines={3}
                        maxLength={500}
                        placeholder="Explique o motivo da troca"
                        value={roleReason}
                        onChangeText={setRoleReason}
                        style={{ textAlignVertical: "top" } as any}
                      />
                      <MvButton
                        variant="primary"
                        label="Confirmar troca de tipo de conta"
                        loading={changingRole}
                        onPress={() => void submitChangeRole()}
                      />
                      <MvButton variant="ghost" label="Cancelar" onPress={() => { setShowRoleForm(false); setRoleReason(""); }} />
                    </View>
                  ) : (
                    <MvButton
                      variant="outline"
                      label={detail.role === "PROVIDER" ? "Trocar para Cliente" : "Trocar para Profissional"}
                      onPress={() => setShowRoleForm(true)}
                    />
                  )
                ) : null}

                <MvButton variant="ghost" label="Exportar dados deste usuário" loading={exporting} onPress={() => void exportData()} />
              </View>
            </MvCard>
          </>
        ) : null}
      </ScrollView>
    </AdminScaffold>
  );
}
