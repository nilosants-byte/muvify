import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
import { FlatList, RefreshControl, TouchableOpacity, View } from "react-native";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { adminApi, AdminWaitlistSignup } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { AdminScaffold } from "./AdminScaffold";
import { handleScreenError } from "../shared/api-helpers";

type Props = {
  navigation: any;
};

type AudienceFilter = "CLIENT" | "PROFESSIONAL" | undefined;

const AUDIENCE_LABEL: Record<"CLIENT" | "PROFESSIONAL", string> = {
  CLIENT: "Aluno",
  PROFESSIONAL: "Profissional"
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Painel dos cadastros da lista de espera pré-lançamento (/lista-espera) —
// antes só dava pra ver via SELECT direto no banco. Mesma estrutura de
// AdminDebtsScreen.tsx (chips de filtro + paginação anterior/próxima),
// com busca por nome/e-mail a mais porque aqui o volume tende a crescer
// rápido (divulgação em massa via vídeo) e "achar uma pessoa específica"
// é um caso de uso real (conferir se alguém já se cadastrou antes de
// contatar, por exemplo).
export function AdminWaitlistScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { showToast } = useAppState();
  const [audience, setAudience] = useState<AudienceFilter>(undefined);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState<string | undefined>(undefined);
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);

  const signupsQuery = useAuthQuery(
    queryKeys.admin.waitlistSignups({ audience, q, page }),
    (token) => adminApi.listWaitlistSignups(token, { audience, q, skip: page * PAGE_SIZE, take: PAGE_SIZE })
  );

  const loading = signupsQuery.isLoading;
  const items = signupsQuery.data?.items ?? [];
  const total = signupsQuery.data?.total ?? 0;
  const hasMore = page * PAGE_SIZE + items.length < total;

  function changeAudience(next: AudienceFilter) {
    setAudience(next);
    setPage(0);
  }

  function submitSearch() {
    setQ(qInput.trim() || undefined);
    setPage(0);
  }

  function clearSearch() {
    setQInput("");
    setQ(undefined);
    setPage(0);
  }

  useEffect(() => {
    if (signupsQuery.error) {
      handleScreenError({
        error: signupsQuery.error,
        showToast,
        fallbackMessage: "Falha ao carregar a lista de espera.",
        navigation
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signupsQuery.error, navigation]);

  useFocusEffectSkippingFirst(
    useCallback(() => {
      void signupsQuery.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signupsQuery.refetch])
  );

  function renderItem({ item }: { item: AdminWaitlistSignup }) {
    return (
      <MvCard style={{ marginBottom: 10 }}>
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <MvText variant="semi2">{item.name?.trim() || "(sem nome)"}</MvText>
            <MvText variant="caption" color={item.audience === "PROFESSIONAL" ? "green" : "secondary"}>
              {AUDIENCE_LABEL[item.audience]}
            </MvText>
          </View>
          <MvText variant="body4" color="secondary">{item.email}</MvText>
          {item.whatsapp ? <MvText variant="body4">WhatsApp: {item.whatsapp}</MvText> : null}
          {item.city ? <MvText variant="body4" color="secondary">{item.city}</MvText> : null}
          <MvText variant="caption" color="secondary">
            Cadastrado em {formatDate(item.createdAt)}{item.utmSource ? ` · veio de: ${item.utmSource}` : ""}
          </MvText>
        </View>
      </MvCard>
    );
  }

  return (
    <AdminScaffold title="Lista de espera" navigation={navigation} currentScreen="AdminWaitlist">
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={signupsQuery.isRefetching}
            onRefresh={() => void signupsQuery.refetch()}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 10 }}>
            <MvText variant="h2">{total}</MvText>
            <MvText variant="body4" color="secondary">
              Cadastro pré-lançamento pela landing page pública /lista-espera.
            </MvText>

            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {([undefined, "CLIENT", "PROFESSIONAL"] as const).map((option) => (
                <TouchableOpacity
                  key={option ?? "ALL"}
                  onPress={() => changeAudience(option)}
                  style={{
                    borderWidth: 1,
                    borderColor: audience === option ? theme.primary : "rgba(127,127,127,0.35)",
                    borderRadius: 20,
                    paddingHorizontal: 12,
                    paddingVertical: 8
                  }}
                >
                  <MvText variant="caption">{option ? AUDIENCE_LABEL[option] : "Todos"}</MvText>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <MvInput
                  placeholder="Buscar por nome ou e-mail"
                  value={qInput}
                  onChangeText={setQInput}
                  onSubmitEditing={submitSearch}
                  autoCapitalize="none"
                />
              </View>
              <MvButton variant="outline" label="Buscar" onPress={submitSearch} />
              {q ? <MvButton variant="ghost" label="Limpar" onPress={clearSearch} /> : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <MvCard>
              <MvText variant="body3">Nenhum cadastro encontrado para este filtro.</MvText>
            </MvCard>
          ) : null
        }
        ListFooterComponent={
          page > 0 || hasMore ? (
            <View style={{ flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 4 }}>
              <MvButton
                variant="outline"
                label="Anterior"
                disabled={page === 0}
                onPress={() => setPage((p) => Math.max(0, p - 1))}
              />
              <MvButton
                variant="outline"
                label="Próxima"
                disabled={!hasMore}
                onPress={() => setPage((p) => p + 1)}
              />
            </View>
          ) : null
        }
      />
    </AdminScaffold>
  );
}
