import React, { useState } from "react";
import { ScrollView, TouchableOpacity, View } from "react-native";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { adminApi, AdminUserDetail, AdminUserSearchResult } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { AdminScaffold } from "./AdminScaffold";
import { handleScreenError } from "../shared/api-helpers";

type Props = {
  navigation: any;
};

function formatCents(amountCents: number) {
  return (amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function AdminUserSearchScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { runWithAuth, showToast } = useAppState();

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AdminUserSearchResult[] | null>(null);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [suspending, setSuspending] = useState(false);
  const [showSuspendForm, setShowSuspendForm] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");

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
      const found = await runWithAuth((token) => adminApi.searchUsers(token, trimmed));
      setResults(found);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao buscar usuários.", navigation });
    } finally {
      setSearching(false);
    }
  }

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
                <MvText variant="body4">
                  {detail.provider ? "Profissional" : "Cliente"} · desde {formatDate(detail.createdAt)}
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
              </View>
            </MvCard>
          </>
        ) : null}
      </ScrollView>
    </AdminScaffold>
  );
}
