import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert, Share,
  ScrollView, StatusBar, TouchableOpacity, View,
} from "react-native";
import { PressableScale } from "../../components/polish/PressableScale";
import Svg, {
  Circle, Defs, Line as SvgLine, LinearGradient, Path, Stop,
  Text as SvgText,
} from "react-native-svg";

// react-native-svg v15 omits children from Defs prop types in strict TS
const SvgDefs = Defs as React.ComponentType<{ children?: React.ReactNode }>;
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import {
  FinancialExpense, FinancialExpenseCategory, FinancialIncome, FinancialPayoutItem, FinancialPayouts, FinancialRecurrence, FinancialReport,
  financialApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvDatePicker, MvInput, MvModalSheet, MvText } from "../../components/mv";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { formatCurrencyBRL, maskPriceInput } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "FinancialHistory">;
type MvThemeValue = ReturnType<typeof import("../../theme/MvThemeContext").useMvTheme>["theme"];
type TxFilter = "all" | "income" | "expense";
type Period = 3 | 6 | 12;

function parseCents(v: string) { return Number(v.replace(/\D/g, "")); }
function fmtCents(cents: number) { return formatCurrencyBRL(cents / 100); }
// Épico de Frentes, Frente 7, Lote 1: extrai ano/mês/dia LOCAIS do aparelho
// (não `.toISOString()`, que converte pra UTC antes) - lançar "hoje" entre
// 21h-23h59 (Brasília) gravava com a data UTC do dia seguinte.
function toLocalDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function currentMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function toLocalMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(m: string) {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}
function getMonthAbbr(m: string): string {
  const mo = Number(m.split("-")[1]);
  return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][mo - 1] ?? "";
}
function methodLabel(method: string): string {
  if (method === "PIX") return "PIX";
  if (method.includes("CREDIT")) return "Cartão crédito";
  if (method.includes("DEBIT")) return "Cartão débito";
  return "Cartão";
}
type BillingOption = "one_time" | "recurring" | "period";
const BILLING_OPTIONS: { key: BillingOption; label: string }[] = [
  { key: "one_time", label: "Avulso" },
  { key: "recurring", label: "Recorrente" },
  { key: "period", label: "Por período" },
];
function billingOptionOf(item: Pick<FinancialIncome | FinancialExpense, "recurrence" | "recurrenceEndDate">): BillingOption {
  if (item.recurrence === "ONE_TIME") return "one_time";
  return item.recurrenceEndDate ? "period" : "recurring";
}
function prevMonths(fromMonth: string, count: number): string[] {
  const [y, mo] = fromMonth.split("-").map(Number);
  const result: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, mo - 1 - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return result;
}

// ─── Beautiful area chart ────────────────────────────────────────────────────

type ChartPoint = { month: string; revenue: number; expenses: number };

function RevenueAreaChart({
  data, selectedMonth, onSelectMonth, isDark, theme,
}: {
  data: ChartPoint[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  isDark: boolean;
  theme: MvThemeValue;
}) {
  const [chartWidth, setChartWidth] = useState(300);
  const CHART_H = 140;
  const PAD_H = 16;
  const PAD_TOP = 14;
  const PAD_BTM = 8;
  const LABEL_H = 20;
  const green = isDark ? theme.primary : "#16A34A";

  if (data.length === 0) return null;

  const maxRev = Math.max(...data.map(d => d.revenue), 1);
  const innerW = chartWidth - PAD_H * 2;
  const innerH = CHART_H - PAD_TOP - PAD_BTM;

  const pts = data.map((d, i) => ({
    ...d,
    x: data.length > 1
      ? PAD_H + (i / (data.length - 1)) * innerW
      : PAD_H + innerW / 2,
    y: PAD_TOP + innerH - Math.max(0, d.revenue / maxRev) * innerH,
  }));

  function curvePath(points: { x: number; y: number }[]): string {
    if (points.length < 2) {
      return points.length === 1 ? `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}` : "";
    }
    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }

  const linePath = curvePath(pts);
  const fp = pts[0];
  const lp = pts[pts.length - 1];
  const areaPath = `${linePath} L ${lp.x.toFixed(1)} ${(CHART_H + 2).toFixed(1)} L ${fp.x.toFixed(1)} ${(CHART_H + 2).toFixed(1)} Z`;

  const selIdx = data.findIndex(d => d.month === selectedMonth);
  const selPt  = selIdx >= 0 ? pts[selIdx] : null;

  return (
    <View onLayout={e => setChartWidth(e.nativeEvent.layout.width)}>
      <Svg width={chartWidth} height={CHART_H + LABEL_H}>
        <SvgDefs>
          <LinearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={green} stopOpacity={isDark ? "0.28" : "0.22"} />
            <Stop offset="100%" stopColor={green} stopOpacity="0" />
          </LinearGradient>
        </SvgDefs>

        {/* Gradient area */}
        <Path d={areaPath} fill="url(#revGrad)" />

        {/* Revenue line */}
        <Path d={linePath} stroke={green} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {/* Selected month guide */}
        {selPt ? (
          <SvgLine
            x1={selPt.x.toFixed(1)} y1={PAD_TOP.toFixed(1)}
            x2={selPt.x.toFixed(1)} y2={CHART_H.toFixed(1)}
            stroke={green} strokeWidth={1} strokeDasharray="3,4" opacity={0.38}
          />
        ) : null}

        {/* Data point dots */}
        {pts.map((pt, i) => {
          const isSel = i === selIdx;
          return (
            <Circle
              key={`pt-${i}`}
              cx={pt.x.toFixed(1)} cy={pt.y.toFixed(1)}
              r={isSel ? 5 : 2.5}
              fill={isSel ? (isDark ? "#111" : "#fff") : green}
              stroke={green} strokeWidth={isSel ? 2 : 0}
            />
          );
        })}

        {/* Month labels */}
        {pts.map((pt, i) => (
          <SvgText
            key={`lbl-${i}`}
            x={pt.x.toFixed(1)} y={(CHART_H + LABEL_H - 2).toFixed(1)}
            textAnchor="middle" fontSize={9}
            fill={isDark ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.28)"}
          >
            {getMonthAbbr(data[i].month)}
          </SvgText>
        ))}
      </Svg>

      {/* Invisible touch zones over chart */}
      <View style={{ position: "absolute", top: 0, left: PAD_H, right: PAD_H, height: CHART_H, flexDirection: "row" }}>
        {data.map((d, i) => (
          <TouchableOpacity
            key={`touch-${i}`} style={{ flex: 1 }}
            onPress={() => onSelectMonth(d.month)}
            activeOpacity={0.4}
          />
        ))}
      </View>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

type TxData = { incomes: FinancialIncome[]; expenses: FinancialExpense[]; payouts: FinancialPayouts | null };

export function FinancialHistoryScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const isDark = theme.mode === "dark";
  const green = isDark ? theme.primary : "#16A34A";
  const RED   = isDark ? "#F87171" : "#E53935";
  const queryClient = useQueryClient();

  const now = currentMonthStr();
  const [period, setPeriod] = useState<Period>(6);
  const [selectedMonth, setSelectedMonth] = useState(now);
  const [txFilter, setTxFilter] = useState<TxFilter>("all");
  const [exportingCsv, setExportingCsv] = useState(false);

  async function exportTransactionsCsv() {
    try {
      setExportingCsv(true);
      const csv = await runWithAuth((token) => financialApi.exportTransactionsCsv(token));
      await Share.share({ message: csv, title: "Transações financeiras" });
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao exportar transações.", navigation });
    } finally {
      setExportingCsv(false);
    }
  }
  const [saving, setSaving] = useState(false);

  const reportQuery = useAuthQuery(
    queryKeys.financial.report(12),
    (token) => financialApi.report(token, 12),
  );

  const txQuery = useAuthQuery(
    queryKeys.financial.history(selectedMonth),
    async (token) => {
      const [incs, exps, payoutsRes] = await Promise.all([
        financialApi.listIncomes(token, selectedMonth),
        financialApi.listExpenses(token, selectedMonth),
        financialApi.payouts(token, selectedMonth).catch(() => null),
      ]);
      return { incomes: incs as FinancialIncome[], expenses: exps as FinancialExpense[], payouts: payoutsRes };
    },
  );

  // Épico de Frentes, Frente 7, Lote 10: Extrato ficava sem recarregar ao
  // voltar de outra tela (ex: editar um lançamento em outro lugar, ou
  // voltar da tela de conexão MP) - só dashboard e Home tinham esse padrão.
  useFocusEffectSkippingFirst(useCallback(() => {
    void reportQuery.refetch();
    void txQuery.refetch();
  }, [reportQuery.refetch, txQuery.refetch]));

  const report = (reportQuery.data ?? null) as FinancialReport | null;
  const incomes = txQuery.data?.incomes ?? ([] as FinancialIncome[]);
  const expenses = txQuery.data?.expenses ?? ([] as FinancialExpense[]);
  const reportLoading = reportQuery.isLoading;
  const txLoading = txQuery.isLoading;

  // Épico de Frentes, Frente 7, Lote 3: `payouts(token, selectedMonth)` já
  // devolve só as transações do mês selecionado (backend filtra por
  // capturedAt/paymentCapturedAt/createdAt) - antes buscava os 50 pagamentos
  // mais recentes de TODA a história e filtrava aqui, então um profissional
  // com mais de 50 transações via app via o total do topo bater mas a lista
  // de lançamentos abaixo ficar vazia/incompleta pra um mês antigo.
  const appPayments = txQuery.data?.payouts?.payments ?? [];

  useEffect(() => {
    if (reportQuery.error) {
      handleScreenError({ error: reportQuery.error, showToast, fallbackMessage: "Falha ao carregar histórico.", navigation });
    }
  }, [reportQuery.error, showToast, navigation]);

  useEffect(() => {
    if (txQuery.error) {
      showToast("Falha ao carregar lançamentos.", "error");
    }
  }, [txQuery.error, showToast]);

  const [addIncomeModal,  setAddIncomeModal]  = useState(false);
  const [addExpenseModal, setAddExpenseModal] = useState(false);
  const [editingIncome,   setEditingIncome]   = useState<FinancialIncome | null>(null);
  const [editingExpense,  setEditingExpense]  = useState<FinancialExpense | null>(null);

  const [iDesc,  setIDesc]  = useState("");
  const [iValue, setIValue] = useState("100,00");
  const [iDate,  setIDate]  = useState<Date>(new Date());
  const [iBilling, setIBilling] = useState<BillingOption>("one_time");
  const [iRecurrenceEndDate, setIRecurrenceEndDate] = useState<Date>(() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; });
  const [eDesc,  setEDesc]  = useState("");
  const [eValue, setEValue] = useState("50,00");
  const [eCat,   setECat]   = useState<FinancialExpenseCategory>("OTHER");
  const [eDate,  setEDate]  = useState<Date>(new Date());
  const [eBilling, setEBilling] = useState<BillingOption>("one_time");
  const [eRecurrenceEndDate, setERecurrenceEndDate] = useState<Date>(() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; });

  // Chart data
  const chartMonths = prevMonths(now, period);
  const chartData: ChartPoint[] = chartMonths.map(m => {
    const entry = report?.months.find(e => e.month === m);
    return {
      month: m,
      revenue: (entry?.revenueCents ?? 0) + (entry?.appRevenueCents ?? 0),
      expenses: entry?.expensesCents ?? 0,
    };
  });

  // Selected month stats
  const selEntry = report?.months.find(e => e.month === selectedMonth);
  const selRevenue  = chartData.find(d => d.month === selectedMonth)?.revenue ?? 0;
  const selExpenses = chartData.find(d => d.month === selectedMonth)?.expenses ?? 0;
  // Frente 3 (segunda camada), Lote 2: "Lucro" antes era recalculado aqui
  // como receita bruta menos despesas manuais (sem descontar a comissão da
  // plataforma) — usa direto o netCents já correto que vem da API.
  const selNet = selEntry?.netCents ?? (selRevenue - selExpenses);

  // Previous month comparison
  const [selY, selM] = selectedMonth.split("-").map(Number);
  const prevMonthKey = (() => {
    const d = new Date(selY, selM - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const prevEntry = report?.months.find(e => e.month === prevMonthKey);
  const prevRevenue = (prevEntry?.revenueCents ?? 0) + (prevEntry?.appRevenueCents ?? 0);
  const growth = prevRevenue > 0 ? ((selRevenue - prevRevenue) / prevRevenue) * 100 : null;

  // Transactions list
  type TxItem =
    | { type: "income"; item: FinancialIncome; date: Date }
    | { type: "expense"; item: FinancialExpense; date: Date }
    | { type: "app_payment"; item: FinancialPayoutItem; date: Date };

  const allTx: TxItem[] = [
    ...incomes.map(i => ({ type: "income" as const, item: i, date: new Date(i.paidAt) })),
    ...expenses.map(e => ({ type: "expense" as const, item: e, date: new Date(e.paidAt) })),
    ...appPayments.map(p => ({ type: "app_payment" as const, item: p, date: new Date(p.capturedAt ?? p.scheduledAt ?? Date.now()) })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const filteredTx = txFilter === "income"
    ? allTx.filter(t => t.type === "income" || t.type === "app_payment")
    : txFilter === "expense"
    ? allTx.filter(t => t.type === "expense")
    : allTx;

  async function handleAddIncome() {
    if (!iDesc.trim()) { showToast("Informe a descrição.", "error"); return; }
    if (iBilling === "period" && iRecurrenceEndDate <= iDate) { showToast("A data de término precisa ser depois da data do lançamento.", "error"); return; }
    try {
      setSaving(true);
      const newIncome = await runWithAuth(t => financialApi.createIncome(t, {
        description: iDesc.trim(),
        amountCents: parseCents(iValue),
        paidAt: new Date(toLocalDateKey(iDate) + "T12:00:00.000Z").toISOString(),
        recurrence: (iBilling === "one_time" ? "ONE_TIME" : "RECURRING") as FinancialRecurrence,
        recurrenceEndDate: iBilling === "period" ? iRecurrenceEndDate.toISOString() : null,
      }));
      queryClient.setQueryData<TxData>(queryKeys.financial.history(selectedMonth), (old) =>
        old ? { ...old, incomes: [...old.incomes, newIncome as FinancialIncome] } : old
      );
      // Épico de Frentes, Frente 7, Lote 10: o topo da tela (total/gráfico)
      // vem de uma query separada (financial.report) que nunca era
      // invalidada por essas mutações - podia ficar mostrando um total
      // desatualizado em relação à lista de lançamentos logo abaixo, na
      // mesma tela, até sair e voltar.
      void queryClient.invalidateQueries({ queryKey: queryKeys.financial.report(12) });
      setAddIncomeModal(false);
      setIDesc(""); setIValue("100,00"); setIDate(new Date()); setIBilling("one_time");
      showToast("Receita registrada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar receita." });
    } finally { setSaving(false); }
  }

  async function handleEditIncome() {
    if (!editingIncome || !iDesc.trim()) return;
    try {
      setSaving(true);
      const editingId = editingIncome.id;
      const updated = await runWithAuth(t => financialApi.updateIncome(t, editingId, {
        description: iDesc.trim(),
        amountCents: parseCents(iValue),
        paidAt: new Date(toLocalDateKey(iDate) + "T12:00:00.000Z").toISOString(),
        recurrence: (iBilling === "one_time" ? "ONE_TIME" : "RECURRING") as FinancialRecurrence,
        recurrenceEndDate: iBilling === "period" ? iRecurrenceEndDate.toISOString() : null,
        occurrenceMonth: selectedMonth,
      }));
      // Editar uma projeção de mês futuro "divide a série" no backend (pra não
      // reescrever o histórico) e devolve uma linha nova, com id diferente —
      // por isso o match é pelo id que estava sendo editado, não pelo retornado.
      queryClient.setQueryData<TxData>(queryKeys.financial.history(selectedMonth), (old) =>
        old ? { ...old, incomes: old.incomes.map(i => i.id === editingId ? updated as FinancialIncome : i) } : old
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.financial.report(12) });
      setEditingIncome(null);
      setIDesc(""); setIValue("100,00"); setIDate(new Date()); setIBilling("one_time");
      showToast("Receita atualizada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao atualizar receita." });
    } finally { setSaving(false); }
  }

  async function handleDeleteIncome(item: FinancialIncome) {
    // Épico de Frentes, Frente 7, Lote 4: excluir uma recorrência (virtual
    // ou a própria âncora) nunca apaga meses já registrados — só encerra a
    // recorrência dali pra frente. O backend decide sozinho, a partir de
    // `beforeMonth`, se ainda dá pra fechar exatamente nesse mês ou se
    // precisa proteger histórico já elapsed fechando a partir de hoje.
    const message = item.recurrence === "RECURRING"
      ? "Isso encerra a recorrência a partir de agora. Meses já registrados continuam guardados."
      : "Remover este lançamento?";
    Alert.alert("Remover receita", message, [
      { text: "Cancelar", style: "cancel" },
      { text: "Remover", style: "destructive", onPress: async () => {
        try {
          const beforeMonth = toLocalMonthKey(new Date(item.paidAt));
          await runWithAuth(t => financialApi.deleteIncome(t, item.id, beforeMonth));
          // Não dá pra prever de forma otimista se o item some do mês
          // selecionado (depende do backend ter feito delete de verdade ou
          // só fechado a recorrência a partir de um mês mais à frente) -
          // refaz a busca em vez de arriscar remover algo que continua válido.
          await queryClient.invalidateQueries({ queryKey: queryKeys.financial.history(selectedMonth) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.financial.report(12) });
        } catch { showToast("Falha ao remover.", "error"); }
      }},
    ]);
  }

  async function handleAddExpense() {
    if (!eDesc.trim()) { showToast("Informe a descrição.", "error"); return; }
    if (eBilling === "period" && eRecurrenceEndDate <= eDate) { showToast("A data de término precisa ser depois da data do lançamento.", "error"); return; }
    try {
      setSaving(true);
      const newExpense = await runWithAuth(t => financialApi.createExpense(t, {
        description: eDesc.trim(),
        amountCents: parseCents(eValue),
        category: eCat,
        paidAt: new Date(toLocalDateKey(eDate) + "T12:00:00.000Z").toISOString(),
        recurrence: (eBilling === "one_time" ? "ONE_TIME" : "RECURRING") as FinancialRecurrence,
        recurrenceEndDate: eBilling === "period" ? eRecurrenceEndDate.toISOString() : null,
      }));
      queryClient.setQueryData<TxData>(queryKeys.financial.history(selectedMonth), (old) =>
        old ? { ...old, expenses: [...old.expenses, newExpense as FinancialExpense] } : old
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.financial.report(12) });
      setAddExpenseModal(false);
      setEDesc(""); setEValue("50,00"); setECat("OTHER"); setEDate(new Date()); setEBilling("one_time");
      showToast("Despesa registrada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar despesa." });
    } finally { setSaving(false); }
  }

  async function handleEditExpense() {
    if (!editingExpense || !eDesc.trim()) return;
    try {
      setSaving(true);
      const editingId = editingExpense.id;
      const updated = await runWithAuth(t => financialApi.updateExpense(t, editingId, {
        description: eDesc.trim(),
        amountCents: parseCents(eValue),
        category: eCat,
        paidAt: new Date(toLocalDateKey(eDate) + "T12:00:00.000Z").toISOString(),
        recurrence: (eBilling === "one_time" ? "ONE_TIME" : "RECURRING") as FinancialRecurrence,
        recurrenceEndDate: eBilling === "period" ? eRecurrenceEndDate.toISOString() : null,
        occurrenceMonth: selectedMonth,
      }));
      queryClient.setQueryData<TxData>(queryKeys.financial.history(selectedMonth), (old) =>
        old ? { ...old, expenses: old.expenses.map(e => e.id === editingId ? updated as FinancialExpense : e) } : old
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.financial.report(12) });
      setEditingExpense(null);
      setEDesc(""); setEValue("50,00"); setECat("OTHER"); setEDate(new Date()); setEBilling("one_time");
      showToast("Despesa atualizada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao atualizar despesa." });
    } finally { setSaving(false); }
  }

  async function handleDeleteExpense(item: FinancialExpense) {
    // Épico de Frentes, Frente 7, Lote 4: mesma proteção de handleDeleteIncome.
    const message = item.recurrence === "RECURRING"
      ? "Isso encerra a recorrência a partir de agora. Meses já registrados continuam guardados."
      : "Remover esta despesa?";
    Alert.alert("Remover despesa", message, [
      { text: "Cancelar", style: "cancel" },
      { text: "Remover", style: "destructive", onPress: async () => {
        try {
          const beforeMonth = toLocalMonthKey(new Date(item.paidAt));
          await runWithAuth(t => financialApi.deleteExpense(t, item.id, beforeMonth));
          await queryClient.invalidateQueries({ queryKey: queryKeys.financial.history(selectedMonth) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.financial.report(12) });
        } catch { showToast("Falha ao remover.", "error"); }
      }},
    ]);
  }

  function openEditIncome(inc: FinancialIncome) {
    setIDesc(inc.description);
    setIValue(maskPriceInput(String(inc.amountCents)));
    setIDate(new Date(inc.paidAt));
    setIBilling(billingOptionOf(inc));
    setIRecurrenceEndDate(inc.recurrenceEndDate ? new Date(inc.recurrenceEndDate) : (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; })());
    setEditingIncome(inc);
  }

  function openEditExpense(exp: FinancialExpense) {
    setEDesc(exp.description);
    setEValue(maskPriceInput(String(exp.amountCents)));
    setECat(exp.category);
    setEDate(new Date(exp.paidAt));
    setEBilling(billingOptionOf(exp));
    setERecurrenceEndDate(exp.recurrenceEndDate ? new Date(exp.recurrenceEndDate) : (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; })());
    setEditingExpense(exp);
  }

  const catLabel: Record<FinancialExpenseCategory, string> = {
    GYM: "Academia", TRANSPORT: "Transporte", EQUIPMENT: "Equipamento",
    MARKETING: "Marketing", FORMATION: "Cursos", SOFTWARE: "Softwares",
    PROFESSIONAL_SERVICES: "Serv. Prof.", RENT: "Aluguel",
    UNIFORM: "Uniforme", NUTRITION: "Nutrição", OTHER: "Outros",
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader
        title="Extrato"
        onBack={() => navigation.goBack()}
        action={{
          icon: "share-outline",
          label: exportingCsv ? "Exportando..." : "CSV",
          onPress: () => { if (!exportingCsv) void exportTransactionsCsv(); }
        }}
      />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Period selector */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
          {([3, 6, 12] as Period[]).map(p => {
            const sel = p === period;
            const label = p === 12 ? "1 ano" : `${p}M`;
            return (
              <TouchableOpacity
                key={p}
                onPress={() => setPeriod(p)}
                style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, backgroundColor: sel ? (isDark ? "rgba(0,200,83,0.14)" : "rgba(22,163,74,0.10)") : theme.chipBg, borderWidth: 1, borderColor: sel ? (isDark ? "rgba(0,200,83,0.30)" : "rgba(22,163,74,0.25)") : theme.border }}
              >
                <MvText variant="badge" style={{ fontSize: 11, color: sel ? green : theme.text3 }}>{label}</MvText>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Selected month info */}
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
          <MvText variant="body4" color="secondary" style={{ fontSize: 11, marginBottom: 2 }}>
            {monthLabel(selectedMonth)}
          </MvText>
          {reportLoading ? (
            <>
              <View style={{ height: 36, width: "45%", borderRadius: 8, backgroundColor: theme.chipBg, marginBottom: 4 }} />
              <View style={{ height: 12, width: "30%", borderRadius: 6, backgroundColor: theme.chipBg }} />
            </>
          ) : (
            <>
              <MvText variant="semi2" style={{ fontSize: 34, letterSpacing: -1.5, color: green, lineHeight: 40 }}>
                {fmtCents(selRevenue)}
              </MvText>
              {growth !== null ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <Ionicons name={growth >= 0 ? "trending-up" : "trending-down"} size={12} color={growth >= 0 ? green : RED} />
                  <MvText variant="body4" style={{ fontSize: 11, color: growth >= 0 ? green : RED }}>
                    {growth >= 0 ? "+" : ""}{growth.toFixed(0)}% vs mês anterior
                  </MvText>
                </View>
              ) : null}
              <View style={{ flexDirection: "row", gap: 16, marginTop: 6 }}>
                <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>
                  Despesas: <MvText variant="body4" style={{ color: RED, fontSize: 11 }}>{fmtCents(selExpenses)}</MvText>
                </MvText>
                <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>
                  Lucro: <MvText variant="body4" style={{ color: selNet >= 0 ? green : RED, fontSize: 11 }}>{fmtCents(selNet)}</MvText>
                </MvText>
              </View>
            </>
          )}
        </View>

        {/* Chart */}
        {reportLoading ? (
          <View style={{ marginHorizontal: 16, height: 160, borderRadius: 16, backgroundColor: theme.chipBg }} />
        ) : (
          <View style={{ marginHorizontal: 0, paddingHorizontal: 16, paddingBottom: 8 }}>
            <RevenueAreaChart
              data={chartData}
              selectedMonth={selectedMonth}
              onSelectMonth={setSelectedMonth}
              isDark={isDark}
              theme={theme}
            />
          </View>
        )}

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: theme.border, marginHorizontal: 16, marginBottom: 12 }} />

        {/* Transaction list header */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8 }}>
          <MvText variant="semi3" style={{ fontSize: 13 }}>Lançamentos</MvText>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {(["all", "income", "expense"] as TxFilter[]).map(f => {
              const sel = txFilter === f;
              const labels = { all: "Todos", income: "Receitas", expense: "Despesas" };
              return (
                <TouchableOpacity
                  key={f}
                  onPress={() => setTxFilter(f)}
                  style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: sel ? (isDark ? "rgba(0,200,83,0.14)" : "rgba(22,163,74,0.10)") : "transparent", borderWidth: 1, borderColor: sel ? (isDark ? "rgba(0,200,83,0.30)" : "rgba(22,163,74,0.25)") : theme.border }}
                >
                  <MvText variant="badge" style={{ fontSize: 9.5, color: sel ? green : theme.text3 }}>{labels[f]}</MvText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Add buttons */}
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 10 }}>
          <TouchableOpacity
            onPress={() => setAddIncomeModal(true)}
            style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 10, backgroundColor: isDark ? "rgba(0,200,83,0.10)" : "rgba(22,163,74,0.08)", borderWidth: 1, borderColor: isDark ? "rgba(0,200,83,0.22)" : "rgba(22,163,74,0.18)" }}
          >
            <Ionicons name="arrow-up-outline" size={14} color={green} />
            <MvText variant="semi3" style={{ color: green, fontSize: 12 }}>+ Receita</MvText>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setAddExpenseModal(true)}
            style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 10, backgroundColor: isDark ? "rgba(248,113,113,0.08)" : "rgba(229,57,53,0.06)", borderWidth: 1, borderColor: isDark ? "rgba(248,113,113,0.18)" : "rgba(229,57,53,0.14)" }}
          >
            <Ionicons name="arrow-down-outline" size={14} color={RED} />
            <MvText variant="semi3" style={{ color: RED, fontSize: 12 }}>+ Despesa</MvText>
          </TouchableOpacity>
        </View>

        {/* Transactions */}
        {txLoading ? (
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {[1, 2, 3].map(i => (
              <View key={i} style={{ height: 56, borderRadius: 12, backgroundColor: theme.chipBg }} />
            ))}
          </View>
        ) : filteredTx.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 32, gap: 8 }}>
            <Ionicons name="receipt-outline" size={36} color={theme.text3} />
            <MvText variant="body4" color="secondary">Nenhum lançamento em {monthLabel(selectedMonth)}</MvText>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 6, paddingBottom: 32 }}>
            {filteredTx.map(tx => {
              const isInc = tx.type === "income";
              const isAppPayment = tx.type === "app_payment";
              const id = tx.item.id;
              const desc = tx.type === "income"
                ? tx.item.description
                : tx.type === "expense"
                ? tx.item.description
                : `${
                    tx.item.type === "CONSULTANCY"
                      ? "Consultoria"
                      : tx.item.type === "CONSULTANCY_RENEWAL"
                        ? "Renovação de ficha"
                        : tx.item.type === "PRESENTIAL_PACKAGE"
                          ? "Pacote presencial"
                          : "Sessão"
                  } via app · ${methodLabel(tx.item.method)}`;
              const amount = tx.type === "income"
                ? tx.item.amountCents
                : tx.type === "expense"
                ? tx.item.amountCents
                : tx.item.providerAmountCents;
              const dateStr = tx.date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" });
              const sub = tx.type === "income"
                ? (tx.item.student?.name ?? null)
                : tx.type === "expense"
                ? catLabel[tx.item.category]
                : `Comissão: ${fmtCents(tx.item.platformFeeCents)}`;

              return (
                <MvCard key={`${tx.type}-${id}`}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isInc || isAppPayment ? (isDark ? "rgba(0,200,83,0.10)" : "rgba(22,163,74,0.08)") : (isDark ? "rgba(248,113,113,0.10)" : "rgba(229,57,53,0.08)"), alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={isInc || isAppPayment ? "arrow-up" : "arrow-down"} size={14} color={isInc || isAppPayment ? green : RED} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <MvText variant="semi3" style={{ fontSize: 13 }} numberOfLines={1}>{desc}</MvText>
                      <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>
                        {sub ? `${sub} · ` : ""}{dateStr}
                      </MvText>
                    </View>
                    <MvText variant="semi2" style={{ color: isInc || isAppPayment ? green : RED, fontSize: 14, letterSpacing: -0.4 }}>
                      {isInc || isAppPayment ? "+" : "-"}{fmtCents(amount)}
                    </MvText>
                    {isAppPayment ? (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.chipBg }}>
                        <MvText variant="badge" style={{ fontSize: 9, color: theme.text3 }}>App</MvText>
                      </View>
                    ) : (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                        {tx.item.recurrence === "RECURRING" ? (
                          <Ionicons name="repeat" size={12} color={theme.text3} style={{ marginRight: 2 }} />
                        ) : null}
                        <PressableScale scale={0.88} onPress={() => isInc ? openEditIncome(tx.item as FinancialIncome) : openEditExpense(tx.item as FinancialExpense)} style={{ padding: 6 }}>
                          <Ionicons name="pencil-outline" size={14} color={theme.text3} />
                        </PressableScale>
                        <PressableScale scale={0.88} onPress={() => isInc ? void handleDeleteIncome(tx.item as FinancialIncome) : void handleDeleteExpense(tx.item as FinancialExpense)} style={{ padding: 6 }}>
                          <Ionicons name="trash-outline" size={14} color={RED} />
                        </PressableScale>
                      </View>
                    )}
                  </View>
                </MvCard>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Income modal */}
      <MvModalSheet
        visible={addIncomeModal || editingIncome !== null}
        title={editingIncome ? "Editar receita" : "Registrar receita"}
        onClose={() => { setAddIncomeModal(false); setEditingIncome(null); setIDesc(""); setIValue("100,00"); setIDate(new Date()); setIBilling("one_time"); }}
      >
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvInput placeholder="Descrição" value={iDesc} onChangeText={setIDesc} />
          <MvInput keyboardType="numeric" placeholder="Valor (R$)" value={iValue} onChangeText={v => setIValue(maskPriceInput(v))} />
          <MvText variant="body4" color="secondary">Data</MvText>
          <MvDatePicker value={iDate} onChange={setIDate} />
          <View style={{ gap: 7 }}>
            <MvText variant="body4" color="secondary">Cobrança</MvText>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {BILLING_OPTIONS.map(opt => (
                <PressableScale key={opt.key} scale={0.95} onPress={() => setIBilling(opt.key)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: iBilling === opt.key ? theme.primarySubtle : theme.chipBg, borderWidth: 1, borderColor: iBilling === opt.key ? "rgba(34,197,94,0.30)" : theme.border }}>
                  <MvText variant="body4" style={{ color: iBilling === opt.key ? theme.primary : theme.text2 }}>{opt.label}</MvText>
                </PressableScale>
              ))}
            </View>
            {iBilling === "period" ? <MvDatePicker value={iRecurrenceEndDate} onChange={setIRecurrenceEndDate} /> : null}
          </View>
          {editingIncome?.isVirtual ? (
            <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>
              Isso vale a partir de {monthLabel(selectedMonth)} — os meses anteriores mantêm os valores já registrados.
            </MvText>
          ) : null}
          <MvButton label={editingIncome ? "Salvar alterações" : "Salvar receita"} loading={saving} onPress={() => editingIncome ? void handleEditIncome() : void handleAddIncome()} />
        </View>
      </MvModalSheet>

      {/* Expense modal */}
      <MvModalSheet
        visible={addExpenseModal || editingExpense !== null}
        title={editingExpense ? "Editar despesa" : "Registrar despesa"}
        onClose={() => { setAddExpenseModal(false); setEditingExpense(null); setEDesc(""); setEValue("50,00"); setECat("OTHER"); setEDate(new Date()); setEBilling("one_time"); }}
      >
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvInput placeholder="Descrição" value={eDesc} onChangeText={setEDesc} />
          <MvInput keyboardType="numeric" placeholder="Valor (R$)" value={eValue} onChangeText={v => setEValue(maskPriceInput(v))} />
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {(Object.keys(catLabel) as FinancialExpenseCategory[]).map(c => (
              <PressableScale key={c} scale={0.95} onPress={() => setECat(c)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: eCat === c ? theme.primarySubtle : theme.chipBg, borderWidth: 1, borderColor: eCat === c ? "rgba(34,197,94,0.30)" : theme.border }}>
                <MvText variant="body4" style={{ color: eCat === c ? theme.primary : theme.text2, fontSize: 12 }}>{catLabel[c]}</MvText>
              </PressableScale>
            ))}
          </View>
          <MvText variant="body4" color="secondary">Data</MvText>
          <MvDatePicker value={eDate} onChange={setEDate} />
          <View style={{ gap: 7 }}>
            <MvText variant="body4" color="secondary">Cobrança</MvText>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {BILLING_OPTIONS.map(opt => (
                <PressableScale key={opt.key} scale={0.95} onPress={() => setEBilling(opt.key)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: eBilling === opt.key ? theme.primarySubtle : theme.chipBg, borderWidth: 1, borderColor: eBilling === opt.key ? "rgba(34,197,94,0.30)" : theme.border }}>
                  <MvText variant="body4" style={{ color: eBilling === opt.key ? theme.primary : theme.text2 }}>{opt.label}</MvText>
                </PressableScale>
              ))}
            </View>
            {eBilling === "period" ? <MvDatePicker value={eRecurrenceEndDate} onChange={setERecurrenceEndDate} /> : null}
          </View>
          {editingExpense?.isVirtual ? (
            <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>
              Isso vale a partir de {monthLabel(selectedMonth)} — os meses anteriores mantêm os valores já registrados.
            </MvText>
          ) : null}
          <MvButton label={editingExpense ? "Salvar alterações" : "Salvar despesa"} loading={saving} onPress={() => editingExpense ? void handleEditExpense() : void handleAddExpense()} />
        </View>
      </MvModalSheet>
    </View>
  );
}
