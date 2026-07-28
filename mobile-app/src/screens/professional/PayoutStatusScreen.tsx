import React, { useCallback, useEffect, useMemo } from "react";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue, useAnimatedStyle,
  withTiming, withDelay, Easing,
} from "react-native-reanimated";
import { ScrollView, StatusBar, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Booking, FinancialDashboard, FinancialExpense, FinancialExpenseCategory, FinancialIncome,
  FinancialPayouts, FinancialRecurrence, FinancialStudent, ProviderAccountStatus, bookingsApi, financialApi, paymentsApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvDatePicker, MvInput, MvModalSheet, MvRefreshControl, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { AnimatedNumber } from "../../components/polish/AnimatedNumber";
import { AnimatedBar } from "../../components/professional/HomeWidgets";
import { SkeletonCard } from "../../components/polish/SkeletonCard";
import { formatCurrencyBRL, maskPriceInput } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "PayoutStatus">;
type RevenueMonth = { key: string; label: string; gross: number };

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(date: Date) {
  return date.toLocaleDateString("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" }).replace(".", "");
}
function currentMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function parseCents(v: string) { return Number(v.replace(/\D/g, "")); }

const EXPENSE_CAT_LABEL: Record<FinancialExpenseCategory, string> = {
  GYM: "Academia", TRANSPORT: "Transporte", EQUIPMENT: "Equipamento",
  MARKETING: "Marketing", FORMATION: "Cursos", SOFTWARE: "Softwares",
  PROFESSIONAL_SERVICES: "Serv. Prof.", RENT: "Aluguel",
  UNIFORM: "Uniforme", NUTRITION: "Nutrição", OTHER: "Outros",
};

type BillingOption = "one_time" | "recurring" | "period";
const BILLING_OPTIONS: { key: BillingOption; label: string }[] = [
  { key: "one_time", label: "Avulso" },
  { key: "recurring", label: "Recorrente" },
  { key: "period", label: "Por período" },
];

// ─── Monthly bar chart ───────────────────────────────────────────────────────
function MonthlyBarChart({
  data,
  primaryColor,
  barBg,
}: {
  data: RevenueMonth[];
  primaryColor: string;
  barBg: string;
}) {
  const maxGross = Math.max(...data.map((d) => d.gross), 1);
  const chartH = 64;
  const barW = 30;
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      {data.map((d, i) => {
        const isCurrent = d.key === currentKey;
        const barH = Math.max(4, Math.round((d.gross / maxGross) * chartH));
        return (
          <View key={d.key} style={{ flex: 1, alignItems: "center", gap: 4 }}>
            <AnimatedBar
              barH={barH}
              chartH={chartH}
              barW={barW}
              fillColor={isCurrent ? primaryColor : `${primaryColor}70`}
              bgColor={barBg}
              delay={i * 60}
            />
            <MvText
              style={{
                fontSize: 10,
                color: isCurrent ? primaryColor : "#6B7280",
                fontFamily: "DMSans_500Medium",
                lineHeight: 12,
              }}
            >
              {d.label}
            </MvText>
          </View>
        );
      })}
    </View>
  );
}

// ─── Metric card ─────────────────────────────────────────────────────────────
function MetricCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  const { theme } = useMvTheme();
  return (
    <View style={{ flex: 1, borderRadius: 16, padding: 14, borderWidth: 1, backgroundColor: theme.inputBg, borderColor: theme.border }}>
      <MvText variant="semi2" style={{ color: highlight ? theme.textGreen : theme.text1, fontSize: 15 }} numberOfLines={1}>
        {value}
      </MvText>
      <MvText variant="body4" color="secondary" style={{ marginTop: 3 }} numberOfLines={2}>
        {label}
      </MvText>
    </View>
  );
}

// ─── Quick action chip (ação rápida do hero) ─────────────────────────────────
function QuickChip({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { theme } = useMvTheme();
  return (
    <PressableScale scale={0.94} onPress={onPress} style={{ alignItems: "center", gap: 6, flex: 1 }}>
      <View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={20} color={theme.textGreen} />
      </View>
      <MvText variant="caption" color="secondary" numberOfLines={1}>{label}</MvText>
    </PressableScale>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export function PayoutStatusScreen({ navigation, route }: Props) {
  const { showToast, user, runWithAuth } = useAppState();
  const { theme } = useMvTheme();
  const isLight = theme.mode === "light";

  const chartOpacity = useSharedValue(0);
  const chartTranslateY = useSharedValue(12);

  const chartAnimStyle = useAnimatedStyle(() => ({
    opacity: chartOpacity.value,
    transform: [{ translateY: chartTranslateY.value }],
  }));

  useEffect(() => {
    chartOpacity.value = withDelay(120, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
    chartTranslateY.value = withDelay(120, withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, []);

  const queryClient = useQueryClient();
  const currentMonth = currentMonthStr();

  const payoutQuery = useAuthQuery(
    queryKeys.payments.providerPayouts(),
    async (token) => {
      const [accountResponse, bookingsResponse, payoutsResponse, dashboardResponse, incomesResponse, expensesResponse, studentsResponse] = await Promise.all([
        paymentsApi.providerStatus(token).catch(() => null as ProviderAccountStatus | null),
        bookingsApi.me(token),
        financialApi.payouts(token).catch(() => null as FinancialPayouts | null),
        financialApi.dashboard(token, currentMonth).catch(() => null as FinancialDashboard | null),
        financialApi.listIncomes(token, currentMonth).catch(() => [] as FinancialIncome[]),
        financialApi.listExpenses(token, currentMonth).catch(() => [] as FinancialExpense[]),
        financialApi.listStudents(token).catch(() => [] as FinancialStudent[]),
      ]);
      return {
        account: accountResponse, bookings: bookingsResponse, payouts: payoutsResponse,
        dashboard: dashboardResponse, incomes: incomesResponse, expenses: expensesResponse,
        students: studentsResponse,
      };
    },
  );
  const account = payoutQuery.data?.account ?? null;
  const bookings = payoutQuery.data?.bookings ?? ([] as Booking[]);
  const payouts = payoutQuery.data?.payouts ?? null;
  const dashboard = payoutQuery.data?.dashboard ?? null;
  const manualIncomes = payoutQuery.data?.incomes ?? ([] as FinancialIncome[]);
  const students = payoutQuery.data?.students ?? ([] as FinancialStudent[]);
  const loading = payoutQuery.isLoading;
  const refreshing = payoutQuery.isRefetching;

  useEffect(() => {
    if (payoutQuery.error) {
      handleScreenError({ error: payoutQuery.error, showToast, fallbackMessage: "Falha ao consultar status financeiro.", navigation });
    }
  }, [payoutQuery.error, showToast, navigation]);

  useFocusEffect(useCallback(() => { void payoutQuery.refetch(); }, [payoutQuery.refetch]));

  const onRefresh = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void payoutQuery.refetch();
  };

  // ── Métricas derivadas ────────────────────────────────────────────────────
  const completedBookings = useMemo(
    () => bookings.filter((b) => b.status === "COMPLETED"),
    [bookings]
  );
  const completedCount = completedBookings.length;
  const pendingCount = useMemo(
    () => bookings.filter((b) => b.status === "PENDING" || b.status === "CONFIRMED").length,
    [bookings]
  );
  const estimatedGross = useMemo(
    () => completedBookings.reduce((s, b) => s + Number(b.priceCents ?? 0) / 100, 0),
    [completedBookings]
  );
  // Usa dados reais da API quando disponíveis; fallback para cálculo client-side
  const estimatedNet  = payouts?.availableCents != null ? payouts.availableCents / 100 : estimatedGross * 0.9;
  const pendingNet    = payouts?.pendingCents != null ? payouts.pendingCents / 100 : 0;
  const commission    = estimatedGross - estimatedNet;

  const uniqueStudents = useMemo(() => {
    const ids = new Set(
      completedBookings
        .map((b) => (b as any).clientId ?? (b as any).client?.id)
        .filter(Boolean)
    );
    return ids.size;
  }, [completedBookings]);

  const currentMonthGross = useMemo(() => {
    const now = new Date();
    return completedBookings
      .filter((b) => {
        const d = new Date((b as any).completedAt ?? b.scheduledAt);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((s, b) => s + Number(b.priceCents ?? 0) / 100, 0);
  }, [completedBookings]);

  // "Disponível para saque" (acima) é só o saldo que o Mercado Pago vai repassar.
  // "Total recebido no mês" é um número mais amplo: soma o que veio pelo app com
  // o que foi lançado manualmente (dinheiro/PIX recebido por fora do app) — as
  // duas perguntas são diferentes e por isso os dois números convivem no hero.
  const manualIncomeCentsThisMonth = useMemo(
    () => manualIncomes.reduce((sum, i) => sum + i.amountCents, 0),
    [manualIncomes]
  );
  const appRevenueCentsThisMonth = dashboard?.appRevenueCents ?? Math.round(currentMonthGross * 100);
  const totalReceivedThisMonth = (appRevenueCentsThisMonth + manualIncomeCentsThisMonth) / 100;

  // Previsto: mensalidades de alunos recorrentes ainda não pagas este mês +
  // sessões já confirmadas mas ainda não concluídas (dinheiro que deve entrar,
  // mas ainda não entrou — diferente de "a caminho", que já foi capturado
  // pelo Mercado Pago e só está aguardando liberação).
  const previstoCents = useMemo(() => {
    const paidStudentIds = new Set(manualIncomes.filter((i) => i.studentId).map((i) => i.studentId));
    const unpaidStudentRevenueCents = students
      .filter((s) => s.isActive && s.billableThisMonth && !paidStudentIds.has(s.id))
      .reduce((sum, s) => sum + s.monthlyValueCents, 0);
    return unpaidStudentRevenueCents + (dashboard?.confirmedRevenueCents ?? 0);
  }, [students, manualIncomes, dashboard]);

  const revenueByMonth = useMemo<RevenueMonth[]>(() => {
    const now = new Date();
    const months: RevenueMonth[] = [];
    for (let offset = 5; offset >= 0; offset--) {
      const ref = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      months.push({ key: monthKey(ref), label: monthLabel(ref), gross: 0 });
    }
    completedBookings.forEach((b) => {
      const date = new Date((b as any).completedAt ?? b.scheduledAt);
      const key = monthKey(date);
      const match = months.find((m) => m.key === key);
      if (match) match.gross += Number(b.priceCents ?? 0) / 100;
    });
    return months;
  }, [completedBookings]);

  const hasRevenue = estimatedGross > 0;

  const [firstPaymentBannerVisible, setFirstPaymentBannerVisible] = React.useState(false);
  useEffect(() => {
    if (!user?.id || estimatedGross === 0) return;
    const key = `@muvify:firstPaymentSeen:${user.id}`;
    AsyncStorage.getItem(key).then((seen) => {
      if (!seen) {
        setFirstPaymentBannerVisible(true);
        void AsyncStorage.setItem(key, "1");
      }
    }).catch(() => {});
  }, [estimatedGross, user?.id]);

  const barBg = isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)";

  // ── Lançamento manual (receita/despesa) direto na tela principal ──────────
  const [addIncomeModal, setAddIncomeModal] = React.useState(false);
  const [addExpenseModal, setAddExpenseModal] = React.useState(false);
  const [savingEntry, setSavingEntry] = React.useState(false);
  const [iDesc, setIDesc] = React.useState("");
  const [iValue, setIValue] = React.useState("100,00");
  const [iDate, setIDate] = React.useState<Date>(new Date());
  const [iBilling, setIBilling] = React.useState<BillingOption>("one_time");
  const [iRecurrenceEndDate, setIRecurrenceEndDate] = React.useState<Date>(() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; });
  const [eDesc, setEDesc] = React.useState("");
  const [eValue, setEValue] = React.useState("50,00");
  const [eCat, setECat] = React.useState<FinancialExpenseCategory>("OTHER");
  const [eDate, setEDate] = React.useState<Date>(new Date());

  // Atalho da Home ("Nova receita") pode pedir pra abrir a tela já com o
  // formulário de lançamento pronto — evita que o atalho seja só um link
  // pra aba, que a barra inferior já oferece.
  useEffect(() => {
    const openModal = route.params?.openModal;
    if (openModal === "income") setAddIncomeModal(true);
    else if (openModal === "expense") setAddExpenseModal(true);
    if (openModal) navigation.setParams({ openModal: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [eBilling, setEBilling] = React.useState<BillingOption>("one_time");
  const [eRecurrenceEndDate, setERecurrenceEndDate] = React.useState<Date>(() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; });

  async function handleAddIncome() {
    if (!iDesc.trim()) { showToast("Informe a descrição.", "error"); return; }
    if (iBilling === "period" && iRecurrenceEndDate <= iDate) { showToast("A data de término precisa ser depois da data do lançamento.", "error"); return; }
    try {
      setSavingEntry(true);
      const paidAtStr = new Date(iDate.toISOString().slice(0, 10) + "T12:00:00.000Z").toISOString();
      const newIncome = await runWithAuth((token) => financialApi.createIncome(token, {
        description: iDesc.trim(),
        amountCents: parseCents(iValue),
        paidAt: paidAtStr,
        recurrence: (iBilling === "one_time" ? "ONE_TIME" : "RECURRING") as FinancialRecurrence,
        recurrenceEndDate: iBilling === "period" ? iRecurrenceEndDate.toISOString() : null,
      }));
      queryClient.setQueryData(queryKeys.payments.providerPayouts(), (old: any) =>
        old ? { ...old, incomes: [...(old.incomes ?? []), newIncome] } : old
      );
      setAddIncomeModal(false);
      setIDesc(""); setIValue("100,00"); setIDate(new Date()); setIBilling("one_time");
      showToast("Receita registrada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar receita." });
    } finally { setSavingEntry(false); }
  }

  async function handleAddExpense() {
    if (!eDesc.trim()) { showToast("Informe a descrição.", "error"); return; }
    if (eBilling === "period" && eRecurrenceEndDate <= eDate) { showToast("A data de término precisa ser depois da data do lançamento.", "error"); return; }
    try {
      setSavingEntry(true);
      const paidAtStr = new Date(eDate.toISOString().slice(0, 10) + "T12:00:00.000Z").toISOString();
      const newExpense = await runWithAuth((token) => financialApi.createExpense(token, {
        description: eDesc.trim(),
        amountCents: parseCents(eValue),
        category: eCat,
        paidAt: paidAtStr,
        recurrence: (eBilling === "one_time" ? "ONE_TIME" : "RECURRING") as FinancialRecurrence,
        recurrenceEndDate: eBilling === "period" ? eRecurrenceEndDate.toISOString() : null,
      }));
      queryClient.setQueryData(queryKeys.payments.providerPayouts(), (old: any) =>
        old ? { ...old, expenses: [...(old.expenses ?? []), newExpense] } : old
      );
      setAddExpenseModal(false);
      setEDesc(""); setEValue("50,00"); setECat("OTHER"); setEDate(new Date()); setEBilling("one_time");
      showToast("Despesa registrada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar despesa." });
    } finally { setSavingEntry(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.finance">
      <StatusBar barStyle={isLight ? "dark-content" : "light-content"} backgroundColor={theme.bg} />

      <ProfessionalScreenHeader
        title="Financeiro"
        subtitle={loading ? "Atualizando..." : "Seu saldo e repasses"}
        onBack={() => navigation.goBack()}
      />

      <ScreenEntrance>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, gap: 14 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <MvRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
        <>
        {/* ── BANNER PRIMEIRO PAGAMENTO (exibido uma única vez) ── */}
        {firstPaymentBannerVisible ? (
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 10,
            borderRadius: 14, padding: 14,
            backgroundColor: theme.primarySubtle,
            borderWidth: 1, borderColor: theme.primarySubtleBorder,
          }}>
            <Ionicons name="star-outline" size={20} color={theme.textGreen} />
            <View style={{ flex: 1 }}>
              <MvText variant="semi3" style={{ color: theme.textGreen }}>Seu primeiro pagamento está chegando!</MvText>
              <MvText variant="body4" color="secondary">Continue confirmando suas sessões para liberar o saldo.</MvText>
            </View>
          </View>
        ) : null}

        {/* ── CTA CONTA MP (quando conta não configurada, ou conexão perdida) ──
            Raio-X de pagamentos, Rodada 4, Lote 10: needsReconnect já existia
            na resposta da API e já era mostrado em ConnectPayoutAccountScreen,
            mas a tela financeira principal (a que o profissional realmente
            acompanha no dia a dia) nunca lia esse campo — vendas paradas
            passavam despercebidas até ele entrar na tela de conexão por
            acaso. */}
        {account?.hasAccount && account?.needsReconnect ? (
          <PressableScale
            onPress={() => navigation.navigate("ConnectPayoutAccount")}
            style={{
              flexDirection: "row", alignItems: "center", gap: 10,
              borderRadius: 14, padding: 14,
              backgroundColor: theme.warningSubtle,
              borderWidth: 1, borderColor: theme.warningSubtleBorder,
            }}
          >
            <Ionicons name="alert-circle-outline" size={20} color={theme.warning} />
            <View style={{ flex: 1 }}>
              <MvText variant="semi3" style={{ color: theme.warning }}>Reconexão necessária — vendas pausadas</MvText>
              <MvText variant="body4" color="secondary">Perdemos a conexão com sua conta Mercado Pago. Suas vendas não estão sendo processadas até você reconectar.</MvText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.warning} />
          </PressableScale>
        ) : !account?.hasAccount ? (
          <PressableScale
            onPress={() => navigation.navigate("ConnectPayoutAccount")}
            style={{
              flexDirection: "row", alignItems: "center", gap: 10,
              borderRadius: 14, padding: 14,
              backgroundColor: theme.warningSubtle,
              borderWidth: 1, borderColor: theme.warningSubtleBorder,
            }}
          >
            <Ionicons name="alert-circle-outline" size={20} color={theme.warning} />
            <View style={{ flex: 1 }}>
              <MvText variant="semi3" style={{ color: theme.warning }}>Conecte sua conta para receber</MvText>
              <MvText variant="body4" color="secondary">Conecte sua conta Mercado Pago para liberar o repasse do seu saldo.</MvText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.warning} />
          </PressableScale>
        ) : null}

        {/* ── HERO: um número, ações rápidas ── */}
        <View style={{ alignItems: "center", paddingVertical: 14, gap: 4 }}>
          <MvText variant="caption" color="secondary" style={{ textTransform: "uppercase", letterSpacing: 0.4 }}>
            Disponível para saque
          </MvText>
          <AnimatedNumber
            value={estimatedNet}
            format={formatCurrencyBRL}
            style={{
              fontFamily: "PlusJakartaSans_800ExtraBold",
              fontSize: 44,
              letterSpacing: -0.8,
              color: theme.text1,
              lineHeight: 52,
            }}
          />
          <MvText variant="body4" color="secondary">
            Bruto {formatCurrencyBRL(estimatedGross)} · Comissão {formatCurrencyBRL(commission)}
            {pendingNet > 0 ? ` · ${formatCurrencyBRL(pendingNet)} a caminho` : ""}
          </MvText>
          {/* Raio-X de pagamentos, Rodada 4, Lote 10: esse valor é uma
              estimativa somada dos registros locais — não é o saldo de
              verdade da conta Mercado Pago, que pode diferir por causa de
              taxas, prazos de liberação ou repasses já feitos fora daqui. */}
          <MvText variant="caption" color="tertiary" style={{ textAlign: "center", maxWidth: 280 }}>
            Estimativa com base nos registros do app — o valor exato pode diferir do saldo real na sua conta Mercado Pago.
          </MvText>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            <MvBadge label={account?.hasAccount ? "Conta ativa" : "Conta pendente"} variant={account?.hasAccount ? "green" : "orange"} />
          </View>
        </View>

        {/* ── Este mês: recebido (app + manual) e previsto ── */}
        <MvText variant="eyebrow" color="secondary" style={{ marginBottom: -4 }}>Este mês</MvText>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 12, backgroundColor: theme.inputBg }}>
          <View style={{ flex: 1 }}>
            <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>Recebido</MvText>
            <MvText variant="semi2" style={{ fontSize: 18, color: theme.text1 }}>{formatCurrencyBRL(totalReceivedThisMonth)}</MvText>
            <MvText variant="caption" color="secondary">
              Pelo app: {formatCurrencyBRL(appRevenueCentsThisMonth / 100)} · Manual: {formatCurrencyBRL(manualIncomeCentsThisMonth / 100)}
            </MvText>
          </View>
          {previstoCents > 0 && (
            <View style={{ alignItems: "flex-end", paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: theme.border }}>
              <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>Previsto</MvText>
              <MvText variant="semi2" style={{ fontSize: 16, color: theme.warning }}>{formatCurrencyBRL(previstoCents / 100)}</MvText>
              <MvText variant="caption" color="secondary" style={{ fontSize: 10 }}>alunos + sessões</MvText>
            </View>
          )}
        </View>

        <View style={{ flexDirection: "row", gap: 4 }}>
          <QuickChip icon="receipt-outline" label="Extrato" onPress={() => navigation.navigate("FinancialHistory")} />
          <QuickChip icon="flag-outline" label="Metas" onPress={() => navigation.navigate("FinancialGoals")} />
          <QuickChip icon="people-outline" label="Alunos" onPress={() => navigation.navigate("FinancialStudents")} />
          <QuickChip icon="document-text-outline" label="Relatório" onPress={() => navigation.navigate("AnnualReport")} />
        </View>

        {/* ── Lançamento manual (dinheiro recebido/pago fora do app) ── */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <MvButton variant="outline" label="+ Receita" onPress={() => setAddIncomeModal(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <MvButton variant="outline" label="+ Despesa" onPress={() => setAddExpenseModal(true)} />
          </View>
        </View>

        {/* ── Últimas transações ── */}
        {payouts != null && payouts.payments.length > 0 ? (
          <MvCard style={{ padding: 0, overflow: "hidden" }}>
            <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
              <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>Últimas transações</MvText>
            </View>
            {payouts.payments.slice(0, 5).map((p) => {
              const isCaptured = p.status === "CAPTURED";
              const isPartiallyRefunded = p.status === "PARTIALLY_REFUNDED";
              const date = new Date(p.capturedAt ?? p.scheduledAt ?? Date.now());
              const dateStr = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" });
              const methodLabel = p.method === "PIX" ? "PIX" : p.method.includes("CREDIT") ? "Cartão crédito" : p.method.includes("DEBIT") ? "Cartão débito" : "Cartão";
              const typeLabel =
                p.type === "CONSULTANCY"
                  ? "Consultoria"
                  : p.type === "CONSULTANCY_RENEWAL"
                    ? "Renovação de ficha"
                    : p.type === "PRESENTIAL_PACKAGE"
                      ? "Pacote presencial"
                      : "Sessão";
              return (
                <View key={p.id} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.border }}>
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: isCaptured ? theme.primarySubtle : theme.warningSubtle, alignItems: "center", justifyContent: "center", marginRight: 10 }}>
                    <Ionicons name={isCaptured ? "checkmark-circle-outline" : isPartiallyRefunded ? "arrow-undo-outline" : "time-outline"} size={16} color={isCaptured ? theme.textGreen : theme.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi3" style={{ fontSize: 12 }}>{typeLabel} · {methodLabel}</MvText>
                    <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>
                      {dateStr} · {isPartiallyRefunded ? "Estornado parcialmente" : isCaptured ? "Concluído" : "Aguardando captura"}
                    </MvText>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <MvText variant="semi3" style={{ fontSize: 13, color: isCaptured ? theme.textGreen : theme.warning }}>
                      {formatCurrencyBRL(p.providerAmountCents / 100)}
                    </MvText>
                    <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>
                      de {formatCurrencyBRL(p.amountCents / 100)}
                    </MvText>
                    {isPartiallyRefunded && p.refundedAmountCents > 0 ? (
                      <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>
                        estornado: {formatCurrencyBRL(p.refundedAmountCents / 100)}
                      </MvText>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </MvCard>
        ) : null}

        {/* ── GRID DE MÉTRICAS — acumulado desde o início, pelo app ── */}
        <MvText variant="eyebrow" color="secondary" style={{ marginBottom: -4 }}>Acumulado</MvText>
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <MetricCard label="Clientes atendidos" value={String(uniqueStudents)} />
            <MetricCard label="Concluídas" value={String(completedCount)} />
            <MetricCard label="Pendentes" value={String(pendingCount)} highlight={pendingCount > 0} />
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <MetricCard label="Bruto total" value={formatCurrencyBRL(estimatedGross)} />
            <MetricCard label="Líquido total" value={formatCurrencyBRL(estimatedNet)} highlight />
          </View>
        </View>

        {/* ── GRÁFICO COMPARATIVO MENSAL ── */}
        <View style={{ borderRadius: 16, padding: 18, borderWidth: 1, backgroundColor: theme.inputBg, borderColor: theme.border }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <MvText variant="semi2">Comparativo mensal</MvText>
            <MvBadge label="Últimos 6 meses" variant="green" />
          </View>

          {hasRevenue ? (
            <Animated.View style={[{ width: "100%", paddingHorizontal: 4 }, chartAnimStyle]}>
              <MonthlyBarChart data={revenueByMonth} primaryColor={theme.textGreen} barBg={barBg} />
            </Animated.View>
          ) : (
            <View style={{ paddingVertical: 28, alignItems: "center", gap: 8 }}>
              <Ionicons name="bar-chart-outline" size={28} color={theme.text3} />
              <MvText variant="body4" color="secondary">Nenhuma receita registrada ainda</MvText>
              <MvText variant="body4" color="secondary" style={{ textAlign: "center", fontSize: 12 }}>
                Quando suas sessões forem concluídas, seus ganhos aparecerão aqui.
              </MvText>
            </View>
          )}
        </View>

        {/* ── CONTA DE RECEBIMENTO (Mercado Pago) ── */}
        <MvCard style={{ padding: 0, overflow: "hidden" }}>
          <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: account?.hasAccount ? theme.primarySubtle : theme.warningSubtle, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="card-outline" size={18} color={account?.hasAccount ? theme.textGreen : theme.warning} />
              </View>
              <View>
                <MvText variant="semi3">Conta de recebimento</MvText>
                <MvText variant="body4" color="secondary" numberOfLines={1} style={{ maxWidth: 200 }}>
                  {account?.hasAccount
                    ? "Mercado Pago conectado"
                    : "Conecte sua conta Mercado Pago para receber repasses"}
                </MvText>
              </View>
            </View>
            <MvBadge label={account?.hasAccount ? "Configurada" : "Pendente"} variant={account?.hasAccount ? "green" : "orange"} />
          </View>

          <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
            <MvButton
              variant={account?.hasAccount ? "outline" : "primary"}
              label={account?.hasAccount ? "Gerenciar conta Mercado Pago" : "Conectar conta Mercado Pago"}
              onPress={() => navigation.navigate("ConnectPayoutAccount")}
            />
          </View>
        </MvCard>
        </>
        )}
      </ScrollView>
      </ScreenEntrance>

      <MvModalSheet
        visible={addIncomeModal}
        title="Registrar receita"
        onClose={() => { setAddIncomeModal(false); setIDesc(""); setIValue("100,00"); setIDate(new Date()); setIBilling("one_time"); }}
      >
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvInput placeholder="Descrição" value={iDesc} onChangeText={setIDesc} />
          <MvInput keyboardType="numeric" placeholder="Valor (R$)" value={iValue} onChangeText={(v) => setIValue(maskPriceInput(v))} />
          <MvText variant="body4" color="secondary">Data</MvText>
          <MvDatePicker value={iDate} onChange={setIDate} />
          <View style={{ gap: 7 }}>
            <MvText variant="body4" color="secondary">Cobrança</MvText>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {BILLING_OPTIONS.map((opt) => (
                <PressableScale key={opt.key} scale={0.95} onPress={() => setIBilling(opt.key)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: iBilling === opt.key ? theme.primarySubtle : theme.chipBg, borderWidth: 1, borderColor: iBilling === opt.key ? theme.primarySubtleBorder : theme.border }}>
                  <MvText variant="body4" style={{ color: iBilling === opt.key ? theme.primary : theme.text2 }}>{opt.label}</MvText>
                </PressableScale>
              ))}
            </View>
            {iBilling === "period" ? <MvDatePicker value={iRecurrenceEndDate} onChange={setIRecurrenceEndDate} /> : null}
          </View>
          <MvButton label="Salvar receita" loading={savingEntry} onPress={() => void handleAddIncome()} />
        </View>
      </MvModalSheet>

      <MvModalSheet
        visible={addExpenseModal}
        title="Registrar despesa"
        onClose={() => { setAddExpenseModal(false); setEDesc(""); setEValue("50,00"); setECat("OTHER"); setEDate(new Date()); setEBilling("one_time"); }}
      >
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvInput placeholder="Descrição" value={eDesc} onChangeText={setEDesc} />
          <MvInput keyboardType="numeric" placeholder="Valor (R$)" value={eValue} onChangeText={(v) => setEValue(maskPriceInput(v))} />
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {(Object.keys(EXPENSE_CAT_LABEL) as FinancialExpenseCategory[]).map((c) => (
              <PressableScale
                key={c}
                scale={0.95}
                onPress={() => setECat(c)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                  backgroundColor: eCat === c ? theme.primarySubtle : theme.chipBg,
                  borderWidth: 1, borderColor: eCat === c ? theme.primarySubtleBorder : theme.border,
                }}
              >
                <MvText variant="body4" style={{ color: eCat === c ? theme.primary : theme.text2, fontSize: 12 }}>{EXPENSE_CAT_LABEL[c]}</MvText>
              </PressableScale>
            ))}
          </View>
          <MvText variant="body4" color="secondary">Data</MvText>
          <MvDatePicker value={eDate} onChange={setEDate} />
          <View style={{ gap: 7 }}>
            <MvText variant="body4" color="secondary">Cobrança</MvText>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {BILLING_OPTIONS.map((opt) => (
                <PressableScale key={opt.key} scale={0.95} onPress={() => setEBilling(opt.key)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: eBilling === opt.key ? theme.primarySubtle : theme.chipBg, borderWidth: 1, borderColor: eBilling === opt.key ? theme.primarySubtleBorder : theme.border }}>
                  <MvText variant="body4" style={{ color: eBilling === opt.key ? theme.primary : theme.text2 }}>{opt.label}</MvText>
                </PressableScale>
              ))}
            </View>
            {eBilling === "period" ? <MvDatePicker value={eRecurrenceEndDate} onChange={setERecurrenceEndDate} /> : null}
          </View>
          <MvButton label="Salvar despesa" loading={savingEntry} onPress={() => void handleAddExpense()} />
        </View>
      </MvModalSheet>

      <ProfessionalBottomNav
        activeKey="financeiro"
        onPress={(key) => {
          if (key === "financeiro") return;
          if (key === "home") navigation.navigate("ProfessionalTabs", { screen: "ProfessionalHome" } as never);
          else if (key === "agenda") navigation.navigate("ProfessionalTabs", { screen: "ProfessionalAgenda" } as never);
          else if (key === "consultoria") navigation.navigate("ProfessionalTabs", { screen: "ProfessionalConsultancyCenter" } as never);
          else if (key === "alunos") navigation.navigate("ProfessionalStudents" as never);
        }}
      />
    </View>
  );
}
