import { Ionicons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { MvCard, MvRefreshControl, MvText } from "../../components/mv";
import { adminApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { formatBRDateTime, formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { AdminScaffold } from "./AdminScaffold";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

type Props = {
  navigation: any;
  route: { params: { bookingId: string } };
};

function maskCpf(v: string | null | undefined) {
  if (!v) return "Não informado";
  const d = v.replace(/\D/g, "");
  if (d.length !== 11) return d;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function Row({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const { theme } = useMvTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 5 }}>
      <Ionicons name={icon} size={15} color={theme.text3} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <MvText variant="caption" color="tertiary">{label}</MvText>
        <MvText variant="body4">{value}</MvText>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <MvCard>
      <MvText variant="semi2" style={{ marginBottom: 6 }}>{title}</MvText>
      {children}
    </MvCard>
  );
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  CANCELLED: "Cancelado",
  COMPLETED: "Concluído"
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING_AUTH: "Aguardando autorização",
  AUTHORIZING: "Autorizando",
  AUTHORIZED: "Autorizado",
  CAPTURED: "Capturado",
  CANCELED: "Cancelado",
  FAILED: "Falhou",
  REFUNDED: "Reembolsado",
  PARTIALLY_REFUNDED: "Estornado parcialmente"
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CARD: "Cartão",
  CREDIT_CARD: "Crédito",
  DEBIT_CARD: "Débito",
  PIX: "Pix"
};

export function AdminConsultasBookingDetailScreen({ navigation, route }: Props) {
  const { bookingId } = route.params;
  const { showToast } = useAppState();
  const { theme } = useMvTheme();

  const bookingQuery = useAuthQuery(
    queryKeys.admin.lookupBookingDetail(bookingId),
    (token) => adminApi.lookupBookingDetail(token, bookingId)
  );

  useEffect(() => {
    if (bookingQuery.error) {
      handleScreenError({ error: bookingQuery.error, showToast, fallbackMessage: "Erro ao carregar agendamento.", navigation });
    }
  }, [bookingQuery.error, showToast, navigation]);

  const booking = bookingQuery.data ?? null;

  if (bookingQuery.isLoading) {
    return (
      <AdminScaffold title="Agendamento" navigation={navigation} currentScreen="AdminConsultas">
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </AdminScaffold>
    );
  }

  if (!booking) return (
    <AdminScaffold title="Agendamento" navigation={navigation} currentScreen="AdminConsultas">
      <MvCard style={{ margin: 16 }}>
        <MvText variant="body3" color="secondary">Agendamento não encontrado ou falha ao carregar.</MvText>
      </MvCard>
    </AdminScaffold>
  );

  const paid =
    booking.payment?.status === "CAPTURED" || booking.payment?.status === "AUTHORIZED";

  return (
    <AdminScaffold title="Agendamento" navigation={navigation} currentScreen="AdminConsultas">
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <MvRefreshControl
            refreshing={bookingQuery.isRefetching}
            onRefresh={() => void bookingQuery.refetch()}
          />
        }
      >

        <Section title="Resumo">
          <Row icon="calendar-outline" label="Data / Hora" value={formatBRDateTime(booking.scheduledAt)} />
          <Row icon="location-outline" label="Local" value={booking.sessionLocation ?? "Não informado"} />
          <Row icon="briefcase-outline" label="Serviço" value={booking.category?.name ?? "—"} />
          <Row icon="information-circle-outline" label="Status" value={STATUS_LABELS[booking.status] ?? booking.status} />
          {booking.notes ? (
            <Row icon="document-text-outline" label="Observações" value={booking.notes} />
          ) : null}
        </Section>

        <Section title="Realização">
          <Row
            icon="checkmark-circle-outline"
            label="Código validado em"
            value={booking.attendanceCodeValidatedAt ? formatBRDateTime(booking.attendanceCodeValidatedAt) : "Não validado"}
          />
          <Row
            icon="person-circle-outline"
            label="Confirmado pelo cliente em"
            value={booking.clientConfirmedAt ? formatBRDateTime(booking.clientConfirmedAt) : "Não confirmado"}
          />
          <Row
            icon="person-circle-outline"
            label="Confirmado pelo profissional em"
            value={booking.providerConfirmedAt ? formatBRDateTime(booking.providerConfirmedAt) : "Não confirmado"}
          />
          <Row
            icon="trophy-outline"
            label="Concluído em"
            value={booking.completedAt ? formatBRDateTime(booking.completedAt) : "Não concluído"}
          />
        </Section>

        <Section title="Pagamento">
          <Row icon="cash-outline" label="Valor" value={formatCurrencyBRL(booking.priceCents / 100)} />
          <Row
            icon="card-outline"
            label="Forma de pagamento"
            value={booking.payment ? (PAYMENT_METHOD_LABELS[booking.payment.method] ?? booking.payment.method) : "Não registrado"}
          />
          <Row
            icon={paid ? "checkmark-done-outline" : "close-circle-outline"}
            label="Status do pagamento"
            value={booking.payment ? (PAYMENT_STATUS_LABELS[booking.payment.status] ?? booking.payment.status) : "Nenhum pagamento registrado"}
          />
          {booking.payment?.authorizedAt ? (
            <Row icon="time-outline" label="Autorizado em" value={formatBRDateTime(booking.payment.authorizedAt)} />
          ) : null}
          {booking.payment?.capturedAt ? (
            <Row icon="time-outline" label="Capturado em" value={formatBRDateTime(booking.payment.capturedAt)} />
          ) : null}
          {booking.payment?.canceledAt ? (
            <Row icon="ban-outline" label="Cancelado em" value={formatBRDateTime(booking.payment.canceledAt)} />
          ) : null}
          {booking.payment?.refundedAt ? (
            <Row icon="return-down-back-outline" label="Reembolsado em" value={formatBRDateTime(booking.payment.refundedAt)} />
          ) : null}
          {booking.payment?.failureReason ? (
            <Row icon="alert-circle-outline" label="Motivo da falha" value={booking.payment.failureReason} />
          ) : null}
        </Section>

        <Section title="Cliente">
          <Row icon="person-outline" label="Nome" value={booking.client.name ?? "Não informado"} />
          <Row icon="mail-outline" label="E-mail" value={booking.client.email ?? "Não informado"} />
          <Row icon="card-outline" label="CPF" value={booking.client.documentMasked ?? "Não informado"} />
        </Section>

        <Section title="Profissional">
          <Row icon="person-outline" label="Nome" value={booking.provider.displayName ?? "Não informado"} />
          <Row icon="mail-outline" label="E-mail" value={booking.provider.user?.email ?? "Não informado"} />
          <Row icon="card-outline" label="CPF" value={booking.provider.user?.documentMasked ?? "Não informado"} />
          <Row icon="shield-checkmark-outline" label="CREF" value={booking.provider.crefNumber ?? "Não informado"} />
        </Section>

        <MvText variant="caption" color="tertiary" style={{ textAlign: "center" }}>
          Criado em {formatBRDateTime(booking.createdAt)}
        </MvText>

      </ScrollView>
    </AdminScaffold>
  );
}
