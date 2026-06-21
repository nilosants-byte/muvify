import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import {
  Linking,
  ScrollView,
  TouchableOpacity,
  View
} from "react-native";
import { MvButton, MvCard, MvInput, MvRefreshControl, MvText } from "../../components/mv";
import {
  adminApi,
  AdminLookupBookingItem,
  AdminLookupChatItem,
  AdminLookupCrefResult
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { formatBRDateTime, formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { AdminScaffold } from "./AdminScaffold";

type Tab = "cref" | "chat" | "agendamento";

type Props = { navigation: any };

function normalizeCpf(v: string) {
  return v.replace(/\D/g, "").slice(0, 11);
}

function maskCpf(digits: string) {
  const d = normalizeCpf(digits);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

// ─── Tab selector ─────────────────────────────────────────────────────────────

function TabBar({
  active,
  onChange
}: {
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  const { theme } = useMvTheme();
  const tabs: { key: Tab; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    { key: "cref", icon: "shield-checkmark-outline", label: "CREF" },
    { key: "chat", icon: "chatbubbles-outline", label: "Chat" },
    { key: "agendamento", icon: "calendar-outline", label: "Agendamento" }
  ];
  return (
    <View
      style={{
        flexDirection: "row",
        marginHorizontal: 16,
        marginBottom: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.border,
        overflow: "hidden"
      }}
    >
      {tabs.map((t) => {
        const selected = t.key === active;
        return (
          <TouchableOpacity
            key={t.key}
            onPress={() => onChange(t.key)}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: "center",
              gap: 4,
              backgroundColor: selected ? theme.primarySubtle : "transparent"
            }}
          >
            <Ionicons
              name={t.icon}
              size={18}
              color={selected ? theme.primary : theme.text3}
            />
            <MvText
              variant="caption"
              color={selected ? "primary" : "tertiary"}
              style={{ fontWeight: selected ? "700" : "400" }}
            >
              {t.label}
            </MvText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Aba CREF ─────────────────────────────────────────────────────────────────

function TabCref({ navigation }: { navigation: any }) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const [cpf, setCpf] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdminLookupCrefResult | "not_found" | null>(null);

  const search = useCallback(async () => {
    const digits = normalizeCpf(cpf);
    if (digits.length !== 11) {
      showToast("Informe um CPF com 11 dígitos.", "error");
      return;
    }
    if (/^(\d)\1{10}$/.test(digits)) {
      showToast("CPF inválido.", "error");
      return;
    }
    try {
      setLoading(true);
      const data = await runWithAuth((token) => adminApi.lookupCref(token, digits));
      setResult(data ?? "not_found");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Erro ao buscar CREF.", navigation });
    } finally {
      setLoading(false);
    }
  }, [cpf, navigation, runWithAuth, showToast]);

  const clear = () => {
    setCpf("");
    setResult(null);
  };

  const credentials: Array<{ id: string; name: string; uri: string }> =
    result && result !== "not_found" && result.cref.credentialDocuments
      ? (result.cref.credentialDocuments as any[])
      : [];

  return (
    <View style={{ gap: 10 }}>
      <MvCard>
        <View style={{ gap: 8 }}>
          <MvInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numeric"
            placeholder="CPF do profissional (apenas números)"
            value={maskCpf(cpf)}
            onChangeText={(v) => setCpf(normalizeCpf(v))}
            maxLength={14}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <MvButton label="Buscar" loading={loading} onPress={() => void search()} />
            </View>
            <View style={{ flex: 1 }}>
              <MvButton variant="outline" label="Limpar" onPress={clear} />
            </View>
          </View>
        </View>
      </MvCard>

      {result === "not_found" && (
        <MvCard>
          <MvText variant="body3" color="secondary">
            Nenhum profissional encontrado com este CPF.
          </MvText>
        </MvCard>
      )}

      {result && result !== "not_found" && (
        <MvCard>
          <View style={{ gap: 6 }}>
            <MvText variant="semi2">{result.user.name}</MvText>
            <MvText variant="body4" color="secondary">{result.user.email}</MvText>
            <MvText variant="body4" color="secondary">
              CPF: {maskCpf(result.user.document ?? "")}
            </MvText>
            <MvText variant="body4" color="secondary">
              CREF: {result.cref.crefNumber ?? "Não informado"}
            </MvText>
            <MvText variant="body4" color="secondary">
              Status: {({ APPROVED: "Aprovado", REJECTED: "Reprovado", IN_REVIEW: "Em análise", PENDING: "Pendente" } as Record<string, string>)[result.cref.crefValidationStatus ?? ""] ?? result.cref.crefValidationStatus ?? "Desconhecido"}
            </MvText>
            {result.cref.crefRejectionReason ? (
              <MvText variant="body4" color="danger">
                Motivo rejeição: {result.cref.crefRejectionReason}
              </MvText>
            ) : null}
          </View>

          {result.cref.crefDocumentUrl ? (
            <TouchableOpacity
              style={{ marginTop: 10 }}
              onPress={() => {
                try { void Linking.openURL(result.cref.crefDocumentUrl!); }
                catch { showToast("Não foi possível abrir o documento.", "error"); }
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: theme.primarySubtleBorder
                }}
              >
                <Ionicons name="document-outline" size={16} color={theme.primary} />
                <MvText variant="body4" color="primary">
                  Abrir documento CREF
                </MvText>
              </View>
            </TouchableOpacity>
          ) : null}

          {credentials.length === 0 && (
            <MvText variant="body4" color="secondary" style={{ marginTop: 8 }}>
              Nenhum documento de credencial enviado.
            </MvText>
          )}
          {credentials.map((doc) => (
            <TouchableOpacity
              key={doc.id}
              style={{ marginTop: 8 }}
              onPress={() => {
                try { void Linking.openURL(doc.uri); }
                catch { showToast("Não foi possível abrir o documento.", "error"); }
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: theme.primarySubtleBorder
                }}
              >
                <Ionicons name="image-outline" size={16} color={theme.primary} />
                <MvText variant="body4" color="primary" style={{ flex: 1 }} numberOfLines={1}>
                  {doc.name}
                </MvText>
                <Ionicons name="open-outline" size={14} color={theme.primary} />
              </View>
            </TouchableOpacity>
          ))}
        </MvCard>
      )}
    </View>
  );
}

// ─── Aba Chat ─────────────────────────────────────────────────────────────────

function TabChat({ navigation }: { navigation: any }) {
  const { runWithAuth, showToast } = useAppState();
  const [cpfProv, setCpfProv] = useState("");
  const [cpfCli, setCpfCli] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AdminLookupChatItem[] | null>(null);
  const [provName, setProvName] = useState("");
  const [cliName, setCliName] = useState("");

  const search = useCallback(async () => {
    const pDoc = normalizeCpf(cpfProv);
    const cDoc = normalizeCpf(cpfCli);
    if (pDoc.length !== 11 || cDoc.length !== 11) {
      showToast("Informe os dois CPFs com 11 dígitos.", "error");
      return;
    }
    try {
      setLoading(true);
      const data = await runWithAuth((token) => adminApi.lookupChats(token, pDoc, cDoc));
      setItems(data.items);
      setProvName(data.provider?.name ?? "Profissional desconhecido");
      setCliName(data.client?.name ?? "Cliente desconhecido");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Erro ao buscar conversas.", navigation });
    } finally {
      setLoading(false);
    }
  }, [cpfCli, cpfProv, navigation, runWithAuth, showToast]);

  const clear = () => {
    setCpfProv("");
    setCpfCli("");
    setItems(null);
    setProvName("");
    setCliName("");
  };

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      refreshControl={
        items !== null ? (
          <MvRefreshControl refreshing={loading} onRefresh={() => void search()} />
        ) : undefined
      }
      style={{ gap: 10 }}
      contentContainerStyle={{ gap: 10 }}
      showsVerticalScrollIndicator={false}
    >
      <MvCard>
        <View style={{ gap: 8 }}>
          <MvInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numeric"
            placeholder="CPF do profissional"
            value={maskCpf(cpfProv)}
            onChangeText={(v) => setCpfProv(normalizeCpf(v))}
            maxLength={14}
          />
          <MvInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numeric"
            placeholder="CPF do cliente"
            value={maskCpf(cpfCli)}
            onChangeText={(v) => setCpfCli(normalizeCpf(v))}
            maxLength={14}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <MvButton label="Buscar" loading={loading} onPress={() => void search()} />
            </View>
            <View style={{ flex: 1 }}>
              <MvButton variant="outline" label="Limpar" onPress={clear} />
            </View>
          </View>
        </View>
      </MvCard>

      {items !== null && items.length === 0 && (
        <MvCard>
          <MvText variant="body3" color="secondary">
            Nenhuma conversa encontrada entre estes usuários.
          </MvText>
        </MvCard>
      )}

      {items?.map((item) => (
        <TouchableOpacity
          key={item.bookingId}
          activeOpacity={0.86}
          onPress={() =>
            navigation.navigate("AdminChatAuditDetail", { bookingId: item.bookingId })
          }
        >
          <MvCard>
            <View style={{ gap: 5 }}>
              <MvText variant="semi2">
                {provName} x {cliName}
              </MvText>
              <MvText variant="body4" color="secondary">
                Início: {formatBRDateTime(item.chatStartedAt)}
              </MvText>
              <MvText variant="body4" color="secondary">
                Agendamento: {formatBRDateTime(item.scheduledAt)}
              </MvText>
              {item.sessionLocation ? (
                <MvText variant="body4" color="secondary">
                  Local: {item.sessionLocation}
                </MvText>
              ) : null}
              <MvText variant="caption" color="secondary">
                {item.messageCount} mensagem{item.messageCount !== 1 ? "s" : ""}
              </MvText>
            </View>
          </MvCard>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ─── Aba Agendamento ───────────────────────────────────────────────────────────

function TabAgendamento({ navigation }: { navigation: any }) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const [cpfProv, setCpfProv] = useState("");
  const [cpfCli, setCpfCli] = useState("");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AdminLookupBookingItem[] | null>(null);
  const [provName, setProvName] = useState("");
  const [cliName, setCliName] = useState("");
  const search = useCallback(
    async (overrideDate?: string) => {
      const pDoc = normalizeCpf(cpfProv);
      const cDoc = normalizeCpf(cpfCli);
      if (pDoc.length !== 11 || cDoc.length !== 11) {
        showToast("Informe os dois CPFs com 11 dígitos.", "error");
        return;
      }
      const d = overrideDate !== undefined ? overrideDate : date;
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        showToast("Data deve estar no formato AAAA-MM-DD.", "error");
        return;
      }
      try {
        setLoading(true);
        const data = await runWithAuth((token) =>
          adminApi.lookupBookings(token, pDoc, cDoc, d || undefined)
        );
        setItems([...(data.items ?? [])].sort((a, b) =>
          new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        ));
        setProvName(data.provider?.name ?? "Profissional desconhecido");
        setCliName(data.client?.name ?? "Cliente desconhecido");
      } catch (error) {
        handleScreenError({
          error,
          showToast,
          fallbackMessage: "Erro ao buscar agendamentos.",
          navigation
        });
      } finally {
        setLoading(false);
      }
    },
    [cpfCli, cpfProv, date, navigation, runWithAuth, showToast]
  );

  const clear = () => {
    setCpfProv("");
    setCpfCli("");
    setDate("");
    setItems(null);
    setProvName("");
    setCliName("");
  };

  const applyDateFilter = (d: string) => {
    setDate(d);
    if (items !== null) void search(d);
  };

  const statusLabel: Record<string, string> = {
    PENDING: "Pendente",
    CONFIRMED: "Confirmado",
    CANCELLED: "Cancelado",
    COMPLETED: "Concluído"
  };

  return (
    <View style={{ gap: 10 }}>
      <MvCard>
        <View style={{ gap: 8 }}>
          <MvInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numeric"
            placeholder="CPF do profissional"
            value={maskCpf(cpfProv)}
            onChangeText={(v) => setCpfProv(normalizeCpf(v))}
            maxLength={14}
          />
          <MvInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numeric"
            placeholder="CPF do cliente"
            value={maskCpf(cpfCli)}
            onChangeText={(v) => setCpfCli(normalizeCpf(v))}
            maxLength={14}
          />
          <MvInput
            placeholder="Data (AAAA-MM-DD) — opcional"
            value={date}
            onChangeText={setDate}
            keyboardType="numeric"
            maxLength={10}
          />
          {items !== null && date ? (
            <MvText variant="caption" color="secondary">
              Filtro de data ativo: {date}. Limpe a data para ver todos os resultados.
            </MvText>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <MvButton label="Buscar" loading={loading} onPress={() => void search()} />
            </View>
            <View style={{ flex: 1 }}>
              <MvButton variant="outline" label="Limpar" onPress={clear} />
            </View>
          </View>
        </View>
      </MvCard>

      {items !== null && items.length === 0 && (
        <MvCard>
          <MvText variant="body3" color="secondary">
            Nenhum agendamento encontrado com os filtros informados.
          </MvText>
        </MvCard>
      )}

      {items?.map((item) => (
        <TouchableOpacity
          key={item.bookingId}
          activeOpacity={0.86}
          onPress={() =>
            navigation.navigate("AdminConsultasBookingDetail", { bookingId: item.bookingId })
          }
        >
          <MvCard>
            <View style={{ gap: 5 }}>
              <MvText variant="semi2">
                {provName} x {cliName}
              </MvText>
              <MvText variant="body4" color="secondary">
                Data: {formatBRDateTime(item.scheduledAt)}
              </MvText>
              {item.sessionLocation ? (
                <MvText variant="body4" color="secondary">
                  Local: {item.sessionLocation}
                </MvText>
              ) : null}
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <MvText variant="body4" color="secondary">
                  {statusLabel[item.status] ?? item.status}
                </MvText>
                <MvText variant="body4" color="secondary">
                  {formatCurrencyBRL(item.priceCents / 100)}
                </MvText>
              </View>
            </View>
          </MvCard>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Tela principal ────────────────────────────────────────────────────────────

export function AdminConsultasScreen({ navigation }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("cref");

  const handleTabChange = (t: Tab) => {
    setActiveTab(t);
  };

  return (
    <AdminScaffold title="Consultas" navigation={navigation} currentScreen="AdminConsultas">
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        keyboardShouldPersistTaps="handled"
      >
        <TabBar active={activeTab} onChange={handleTabChange} />
        <View style={{ paddingHorizontal: 16 }}>
          {activeTab === "cref" && <TabCref navigation={navigation} />}
          {activeTab === "chat" && <TabChat navigation={navigation} />}
          {activeTab === "agendamento" && <TabAgendamento navigation={navigation} />}
        </View>
      </ScrollView>
    </AdminScaffold>
  );
}
