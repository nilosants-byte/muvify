import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import {
  FinancialExpense, FinancialExpenseCategory, FinancialIncome, FinancialReport,
  financialApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvDatePicker, MvInput, MvText } from "../../components/mv";
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
function currentMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(m: string) {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}
function getMonthAbbr(m: string): string {
  const mo = Number(m.split("-")[1]);
  return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][mo - 1] ?? "";
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

// ─── Modal sheet ─────────────────────────────────────────────────────────────

function ModalSheet({ visible, title, onClose, children, theme, topInset }: {
  visible: boolean; title: string; onClose: () => void;
  children: React.ReactNode; theme: MvThemeValue; topInset: number;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: topInset + 16, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 10 }}>
            <PressableScale scale={0.92} onPress={onClose} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={18} color={theme.text1} />
            </PressableScale>
            <MvText variant="semi2">{title}</MvText>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

type TxData = { incomes: FinancialIncome[]; expenses: FinancialExpense[] };

export function FinancialHistoryScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const isDark = theme.mode === "dark";
  const green = isDark ? theme.primary : "#16A34A";
  const RED   = isDark ? "#F87171" : "#E53935";
  const queryClient = useQueryClient();

  const now = currentMonthStr();
  const [period, setPeriod] = useState<Period>(6);
  const [selectedMonth, setSelectedMonth] = useState(now);
  const [txFilter, setTxFilter] = useState<TxFilter>("all");
  const [saving, setSaving] = useState(false);

  const reportQuery = useAuthQuery(
    queryKeys.financial.report(12),
    (token) => financialApi.report(token, 12),
  );

  const txQuery = useAuthQuery(
    queryKeys.financial.history(selectedMonth),
    async (token) => {
      const [incs, exps] = await Promise.all([
        financialApi.listIncomes(token, selectedMonth),
        financialApi.listExpenses(token, selectedMonth),
      ]);
      return { incomes: incs as FinancialIncome[], expenses: exps as FinancialExpense[] };
    },
  );

  const report = (reportQuery.data ?? null) as FinancialReport | null;
  const incomes = txQuery.data?.incomes ?? ([] as FinancialIncome[]);
  const expenses = txQuery.data?.expenses ?? ([] as FinancialExpense[]);
  const reportLoading = reportQuery.isLoading;
  const txLoading = txQuery.isLoading;

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
  const [eDesc,  setEDesc]  = useState("");
  const [eValue, setEValue] = useState("50,00");
  const [eCat,   setECat]   = useState<FinancialExpenseCategory>("OTHER");
  const [eDate,  setEDate]  = useState<Date>(new Date());

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
  const selNet = selRevenue - selExpenses;

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
    | { type: "expense"; item: FinancialExpense; date: Date };

  const allTx: TxItem[] = [
    ...incomes.map(i => ({ type: "income" as const, item: i, date: new Date(i.paidAt) })),
    ...expenses.map(e => ({ type: "expense" as const, item: e, date: new Date(e.paidAt) })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const filteredTx = txFilter === "income"
    ? allTx.filter(t => t.type === "income")
    : txFilter === "expense"
    ? allTx.filter(t => t.type === "expense")
    : allTx;

  async function handleAddIncome() {
    if (!iDesc.trim()) { showToast("Informe a descrição.", "error"); return; }
    try {
      setSaving(true);
      const newIncome = await runWithAuth(t => financialApi.createIncome(t, {
        description: iDesc.trim(),
        amountCents: parseCents(iValue),
        paidAt: new Date(iDate.toISOString().slice(0, 10) + "T12:00:00.000Z").toISOString(),
      }));
      queryClient.setQueryData<TxData>(queryKeys.financial.history(selectedMonth), (old) =>
        old ? { ...old, incomes: [...old.incomes, newIncome as FinancialIncome] } : old
      );
      setAddIncomeModal(false);
      setIDesc(""); setIValue("100,00"); setIDate(new Date());
      showToast("Receita registrada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar receita." });
    } finally { setSaving(false); }
  }

  async function handleEditIncome() {
    if (!editingIncome || !iDesc.trim()) return;
    try {
      setSaving(true);
      const updated = await runWithAuth(t => financialApi.updateIncome(t, editingIncome.id, {
        description: iDesc.trim(),
        amountCents: parseCents(iValue),
        paidAt: new Date(iDate.toISOString().slice(0, 10) + "T12:00:00.000Z").toISOString(),
      }));
      queryClient.setQueryData<TxData>(queryKeys.financial.history(selectedMonth), (old) =>
        old ? { ...old, incomes: old.incomes.map(i => i.id === updated.id ? updated as FinancialIncome : i) } : old
      );
      setEditingIncome(null);
      setIDesc(""); setIValue("100,00"); setIDate(new Date());
      showToast("Receita atualizada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao atualizar receita." });
    } finally { setSaving(false); }
  }

  async function handleDeleteIncome(id: string) {
    try {
      await runWithAuth(t => financialApi.deleteIncome(t, id));
      queryClient.setQueryData<TxData>(queryKeys.financial.history(selectedMonth), (old) =>
        old ? { ...old, incomes: old.incomes.filter(i => i.id !== id) } : old
      );
    } catch { showToast("Falha ao remover.", "error"); }
  }

  async function handleAddExpense() {
    if (!eDesc.trim()) { showToast("Informe a descrição.", "error"); return; }
    try {
      setSaving(true);
      const newExpense = await runWithAuth(t => financialApi.createExpense(t, {
        description: eDesc.trim(),
        amountCents: parseCents(eValue),
        category: eCat,
        paidAt: new Date(eDate.toISOString().slice(0, 10) + "T12:00:00.000Z").toISOString(),
      }));
      queryClient.setQueryData<TxData>(queryKeys.financial.history(selectedMonth), (old) =>
        old ? { ...old, expenses: [...old.expenses, newExpense as FinancialExpense] } : old
      );
      setAddExpenseModal(false);
      setEDesc(""); setEValue("50,00"); setECat("OTHER"); setEDate(new Date());
      showToast("Despesa registrada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar despesa." });
    } finally { setSaving(false); }
  }

  async function handleEditExpense() {
    if (!editingExpense || !eDesc.trim()) return;
    try {
      setSaving(true);
      const updated = await runWithAuth(t => financialApi.updateExpense(t, editingExpense.id, {
        description: eDesc.trim(),
        amountCents: parseCents(eValue),
        category: eCat,
        paidAt: new Date(eDate.toISOString().slice(0, 10) + "T12:00:00.000Z").toISOString(),
      }));
      queryClient.setQueryData<TxData>(queryKeys.financial.history(selectedMonth), (old) =>
        old ? { ...old, expenses: old.expenses.map(e => e.id === updated.id ? updated as FinancialExpense : e) } : old
      );
      setEditingExpense(null);
      setEDesc(""); setEValue("50,00"); setECat("OTHER"); setEDate(new Date());
      showToast("Despesa atualizada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao atualizar despesa." });
    } finally { setSaving(false); }
  }

  async function handleDeleteExpense(id: string) {
    try {
      await runWithAuth(t => financialApi.deleteExpense(t, id));
      queryClient.setQueryData<TxData>(queryKeys.financial.history(selectedMonth), (old) =>
        old ? { ...old, expenses: old.expenses.filter(e => e.id !== id) } : old
      );
    } catch { showToast("Falha ao remover.", "error"); }
  }

  function openEditIncome(inc: FinancialIncome) {
    setIDesc(inc.description);
    setIValue(maskPriceInput(String(inc.amountCents)));
    setIDate(new Date(inc.paidAt));
    setEditingIncome(inc);
  }

  function openEditExpense(exp: FinancialExpense) {
    setEDesc(exp.description);
    setEValue(maskPriceInput(String(exp.amountCents)));
    setECat(exp.category);
    setEDate(new Date(exp.paidAt));
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
      <ProfessionalScreenHeader title="Histórico" onBack={() => navigation.goBack()} />

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
              const id = tx.item.id;
              const desc = isInc
                ? (tx.item as FinancialIncome).description
                : (tx.item as FinancialExpense).description;
              const amount = isInc
                ? (tx.item as FinancialIncome).amountCents
                : (tx.item as FinancialExpense).amountCents;
              const dateStr = tx.date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" });
              const sub = isInc
                ? ((tx.item as FinancialIncome).student?.name ?? null)
                : catLabel[(tx.item as FinancialExpense).category];

              return (
                <MvCard key={`${tx.type}-${id}`}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isInc ? (isDark ? "rgba(0,200,83,0.10)" : "rgba(22,163,74,0.08)") : (isDark ? "rgba(248,113,113,0.10)" : "rgba(229,57,53,0.08)"), alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={isInc ? "arrow-up" : "arrow-down"} size={14} color={isInc ? green : RED} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <MvText variant="semi3" style={{ fontSize: 13 }} numberOfLines={1}>{desc}</MvText>
                      <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>
                        {sub ? `${sub} · ` : ""}{dateStr}
                      </MvText>
                    </View>
                    <MvText variant="semi2" style={{ color: isInc ? green : RED, fontSize: 14, letterSpacing: -0.4 }}>
                      {isInc ? "+" : "-"}{fmtCents(amount)}
                    </MvText>
                    <View style={{ flexDirection: "row", gap: 2 }}>
                      <PressableScale scale={0.88} onPress={() => isInc ? openEditIncome(tx.item as FinancialIncome) : openEditExpense(tx.item as FinancialExpense)} style={{ padding: 6 }}>
                        <Ionicons name="pencil-outline" size={14} color={theme.text3} />
                      </PressableScale>
                      <PressableScale scale={0.88} onPress={() => isInc ? void handleDeleteIncome(id) : void handleDeleteExpense(id)} style={{ padding: 6 }}>
                        <Ionicons name="trash-outline" size={14} color={RED} />
                      </PressableScale>
                    </View>
                  </View>
                </MvCard>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Income modal */}
      <ModalSheet
        visible={addIncomeModal || editingIncome !== null}
        title={editingIncome ? "Editar receita" : "Registrar receita"}
        onClose={() => { setAddIncomeModal(false); setEditingIncome(null); setIDesc(""); setIValue("100,00"); setIDate(new Date()); }}
        theme={theme} topInset={insets.top}
      >
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvInput placeholder="Descrição" value={iDesc} onChangeText={setIDesc} />
          <MvInput keyboardType="numeric" placeholder="Valor (R$)" value={iValue} onChangeText={v => setIValue(maskPriceInput(v))} />
          <MvText variant="body4" color="secondary">Data</MvText>
          <MvDatePicker value={iDate} onChange={setIDate} />
          <MvButton label={editingIncome ? "Salvar alterações" : "Salvar receita"} loading={saving} onPress={() => editingIncome ? void handleEditIncome() : void handleAddIncome()} />
        </View>
      </ModalSheet>

      {/* Expense modal */}
      <ModalSheet
        visible={addExpenseModal || editingExpense !== null}
        title={editingExpense ? "Editar despesa" : "Registrar despesa"}
        onClose={() => { setAddExpenseModal(false); setEditingExpense(null); setEDesc(""); setEValue("50,00"); setECat("OTHER"); setEDate(new Date()); }}
        theme={theme} topInset={insets.top}
      >
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvInput placeholder="Descrição" value={eDesc} onChangeText={setEDesc} />
          <MvInput keyboardType="numeric" placeholder="Valor (R$)" value={eValue} onChangeText={v => setEValue(maskPriceInput(v))} />
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {(Object.keys(catLabel) as FinancialExpenseCategory[]).map(c => (
              <PressableScale key={c} scale={0.95} onPress={() => setECat(c)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: eCat === c ? "rgba(34,197,94,0.12)" : theme.chipBg, borderWidth: 1, borderColor: eCat === c ? "rgba(34,197,94,0.30)" : theme.border }}>
                <MvText variant="body4" style={{ color: eCat === c ? theme.primary : theme.text2, fontSize: 12 }}>{catLabel[c]}</MvText>
              </PressableScale>
            ))}
          </View>
          <MvText variant="body4" color="secondary">Data</MvText>
          <MvDatePicker value={eDate} onChange={setEDate} />
          <MvButton label={editingExpense ? "Salvar alterações" : "Salvar despesa"} loading={saving} onPress={() => editingExpense ? void handleEditExpense() : void handleAddExpense()} />
        </View>
      </ModalSheet>
    </View>
  );
}
