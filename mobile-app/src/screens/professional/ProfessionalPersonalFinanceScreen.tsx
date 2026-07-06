import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StatusBar, TextInput, TouchableOpacity, View,
} from "react-native";
import { PressableScale } from "../../components/polish/PressableScale";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import {
  FinancialAppClient, FinancialDashboard, FinancialExpense, FinancialExpenseCategory,
  FinancialGoal, FinancialIncome, FinancialStudent, financialApi, paymentsApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvDatePicker, MvInput, MvText } from "../../components/mv";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { formatCurrencyBRL, maskPriceInput } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "PersonalFinance">;
type MvThemeValue = ReturnType<typeof import("../../theme/MvThemeContext").useMvTheme>["theme"];

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
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, badge, onAction, actionLabel = "Ver →", theme, isDark }: {
  title: string; badge?: number; onAction?: () => void; actionLabel?: string;
  theme: MvThemeValue; isDark: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, marginTop: 20, marginBottom: 8 }}>
      <MvText variant="semi2" style={{ flex: 1, fontSize: 15, letterSpacing: -0.4 }}>{title}</MvText>
      {badge !== undefined ? (
        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)", marginRight: 6 }}>
          <MvText variant="badge" style={{ fontSize: 10, color: theme.text3 }}>{badge}</MvText>
        </View>
      ) : null}
      {onAction ? (
        <TouchableOpacity onPress={onAction} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <MvText variant="body4" style={{ fontSize: 12, color: theme.text3 }}>{actionLabel}</MvText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── Expense category labels ──────────────────────────────────────────────────

const CAT_LABEL: Record<FinancialExpenseCategory, string> = {
  GYM: "Academia", TRANSPORT: "Transporte", EQUIPMENT: "Equipamento",
  MARKETING: "Marketing", FORMATION: "Cursos", SOFTWARE: "Softwares",
  PROFESSIONAL_SERVICES: "Serv. Prof.", RENT: "Aluguel",
  UNIFORM: "Uniforme", NUTRITION: "Nutrição", OTHER: "Outros",
};

// ─── Main screen ─────────────────────────────────────────────────────────────

export function ProfessionalPersonalFinanceScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const isDark = theme.mode === "dark";
  const green = isDark ? theme.primary : "#16A34A";
  const RED   = isDark ? "#F87171" : "#E53935";

  const [month, setMonth] = useState(currentMonthStr());
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  const [dashboard,    setDashboard]    = useState<FinancialDashboard | null>(null);
  const [students,     setStudents]     = useState<FinancialStudent[]>([]);
  const [incomes,      setIncomes]      = useState<FinancialIncome[]>([]);
  const [expenses,     setExpenses]     = useState<FinancialExpense[]>([]);
  const [goal,         setGoal]         = useState<FinancialGoal | null>(null);
  const [appClients,   setAppClients]   = useState<FinancialAppClient[]>([]);
  const [providerHasMp, setProviderHasMp] = useState<boolean | null>(null);

  // Income modal state
  const [addIncomeModal, setAddIncomeModal] = useState(false);
  const [editingIncome,  setEditingIncome]  = useState<FinancialIncome | null>(null);
  const [iDesc,  setIDesc]  = useState("");
  const [iValue, setIValue] = useState("100,00");
  const [iDate,  setIDate]  = useState<Date>(new Date());

  // Expense modal state
  const [addExpenseModal, setAddExpenseModal] = useState(false);
  const [editingExpense,  setEditingExpense]  = useState<FinancialExpense | null>(null);
  const [eDesc,  setEDesc]  = useState("");
  const [eValue, setEValue] = useState("50,00");
  const [eCat,   setECat]   = useState<FinancialExpenseCategory>("OTHER");
  const [eDate,  setEDate]  = useState<Date>(new Date());

  // Mark as paid modal state
  const [payStudentModal, setPayStudentModal] = useState<FinancialStudent | null>(null);
  const [payStudentValue, setPayStudentValue] = useState("");
  const [payStudentDate,  setPayStudentDate]  = useState<Date>(new Date());

  // Computed values
  const studentRevenueCents = useMemo(
    () => students.filter(s => s.isActive).reduce((sum, s) => sum + s.monthlyValueCents, 0),
    [students]
  );
  const manualIncomeCents = useMemo(
    () => incomes.reduce((sum, i) => sum + i.amountCents, 0),
    [incomes]
  );
  const manualExpensesCents = useMemo(
    () => expenses.reduce((sum, e) => sum + e.amountCents, 0),
    [expenses]
  );
  const appRevenueCents = useMemo(
    () => appClients.length > 0
      ? appClients.reduce((sum, c) => sum + c.completedCents, 0)
      : (dashboard?.appRevenueCents ?? 0),
    [appClients, dashboard]
  );
  const effectiveRevenueCents = appRevenueCents + studentRevenueCents + manualIncomeCents;
  const effectiveProfitCents  = effectiveRevenueCents - manualExpensesCents;

  const paidStudentIds = useMemo(() => {
    const set = new Set<string>();
    incomes.forEach(inc => { if (inc.studentId) set.add(inc.studentId); });
    return set;
  }, [incomes]);

  // Load all data
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [dash, studs, incs, exps, gl, appCl, mpStatus] = await Promise.all([
        runWithAuth(t => financialApi.dashboard(t, month)),
        runWithAuth(t => financialApi.listStudents(t)),
        runWithAuth(t => financialApi.listIncomes(t, month)),
        runWithAuth(t => financialApi.listExpenses(t, month)),
        runWithAuth(t => financialApi.getGoal(t, month)),
        runWithAuth(t => financialApi.listAppClients(t, month)),
        runWithAuth(t => paymentsApi.providerStatus(t)).catch(() => null),
      ]);
      setDashboard(dash);
      setStudents(studs);
      setIncomes(incs);
      setExpenses(exps);
      setGoal(gl);
      setAppClients(appCl);
      setProviderHasMp(mpStatus?.hasAccount ?? null);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar financeiro.", navigation });
    } finally {
      setLoading(false);
    }
  }, [month, navigation, runWithAuth, showToast]);

  // Initial load on mount + re-load when month changes
  useEffect(() => { void load(); }, [load]);

  // Refresh when returning from sub-screens
  const initialLoadRef = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!initialLoadRef.current) { initialLoadRef.current = true; return; }
    void load();
  }, [load]));

  function prevMonth() {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  function nextMonth() {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  // Handlers
  async function handleAddIncome() {
    if (!iDesc.trim()) { showToast("Informe a descrição.", "error"); return; }
    try {
      setSaving(true);
      const newIncome = await runWithAuth(t => financialApi.createIncome(t, {
        description: iDesc.trim(),
        amountCents: parseCents(iValue),
        paidAt: new Date(iDate.toISOString().slice(0, 10) + "T12:00:00.000Z").toISOString(),
      }));
      setIncomes(prev => [...prev, newIncome]);
      setAddIncomeModal(false);
      setIDesc(""); setIValue("100,00"); setIDate(new Date());
      showToast("Receita registrada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar receita." });
    } finally { setSaving(false); }
  }

  async function handleMarkStudentPaid() {
    if (!payStudentModal) return;
    try {
      setSaving(true);
      const newIncome = await runWithAuth(t => financialApi.createIncome(t, {
        description: `Mensalidade — ${payStudentModal.name}`,
        amountCents: parseCents(payStudentValue),
        studentId: payStudentModal.id,
        paidAt: new Date(payStudentDate.toISOString().slice(0, 10) + "T12:00:00.000Z").toISOString(),
      }));
      setIncomes(prev => [...prev, newIncome]);
      setPayStudentModal(null);
      showToast("Mensalidade registrada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao registrar pagamento." });
    } finally { setSaving(false); }
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
      setExpenses(prev => [...prev, newExpense]);
      setAddExpenseModal(false);
      setEDesc(""); setEValue("50,00"); setECat("OTHER"); setEDate(new Date());
      showToast("Despesa registrada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar despesa." });
    } finally { setSaving(false); }
  }

  // ─── Compact students section ──────────────────────────────────────────────

  function CompactStudentItem({ s }: { s: FinancialStudent }) {
    const isPaid = paidStudentIds.has(s.id);
    const todayDay = new Date().getDate();
    const daysOverdue = s.paymentDueDay && !isPaid ? Math.max(0, todayDay - s.paymentDueDay) : 0;
    const statusColor = isPaid ? green : daysOverdue > 0 ? RED : (isDark ? "#FCD34D" : "#B45309");
    const statusText  = isPaid ? "Pago" : daysOverdue > 0 ? `Atrasado ${daysOverdue}d` : s.paymentDueDay ? `Vence dia ${s.paymentDueDay}` : "Pendente";

    return (
      <TouchableOpacity
        onPress={() => !isPaid ? (setPayStudentModal(s), setPayStudentValue(maskPriceInput(String(s.monthlyValueCents))), setPayStudentDate(new Date())) : undefined}
        activeOpacity={isPaid ? 1 : 0.7}
        style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.border }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor, marginRight: 10 }} />
        <MvText variant="semi3" style={{ flex: 1, fontSize: 13 }} numberOfLines={1}>{s.name}</MvText>
        <MvText variant="body4" style={{ fontSize: 11, color: statusColor, marginRight: 4 }}>{statusText}</MvText>
        {!isPaid ? <Ionicons name="chevron-forward" size={13} color={theme.text3} /> : null}
      </TouchableOpacity>
    );
  }

  // ─── Recent transactions section ──────────────────────────────────────────

  const recentTransactions = useMemo(() => {
    type TxItem =
      | { type: "income"; item: FinancialIncome; date: Date }
      | { type: "expense"; item: FinancialExpense; date: Date };
    const all: TxItem[] = [
      ...incomes.map(i => ({ type: "income" as const, item: i, date: new Date(i.paidAt) })),
      ...expenses.map(e => ({ type: "expense" as const, item: e, date: new Date(e.paidAt) })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());
    return all.slice(0, 5);
  }, [incomes, expenses]);

  // ─── Loading skeleton ──────────────────────────────────────────────────────

  function SkeletonBlock({ height = 80, mx = 16 }: { height?: number; mx?: number }) {
    return <View style={{ height, marginHorizontal: mx, borderRadius: 16, backgroundColor: theme.chipBg }} />;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const activeStudents = students.filter(s => s.isActive);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader
        title="Financeiro"
        onBack={() => navigation.goBack()}
        action={{ icon: "document-text-outline", label: "Relatório", onPress: () => navigation.navigate("AnnualReport") }}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Month selector */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 8 }}>
          <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={20} color={theme.text3} />
          </TouchableOpacity>
          <MvText variant="semi2" style={{ fontSize: 15, letterSpacing: -0.3 }}>{monthLabel(month)}</MvText>
          <TouchableOpacity onPress={nextMonth} disabled={month >= currentMonthStr()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ opacity: month >= currentMonthStr() ? 0.3 : 1 }}>
            <Ionicons name="chevron-forward" size={20} color={theme.text3} />
          </TouchableOpacity>
        </View>

        {/* Hero card */}
        {loading ? (
          <SkeletonBlock height={120} />
        ) : (
          <View style={{ marginHorizontal: 16, borderRadius: 20, padding: 20, backgroundColor: isDark ? "rgba(0,200,83,0.08)" : "rgba(22,163,74,0.06)", borderWidth: 1, borderColor: isDark ? "rgba(0,200,83,0.18)" : "rgba(22,163,74,0.15)" }}>
            <MvText variant="body4" style={{ fontSize: 12, color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.38)", marginBottom: 2 }}>
              {month === currentMonthStr() ? "Faturamento este mês" : `Faturamento em ${monthLabel(month)}`}
            </MvText>
            <MvText variant="semi2" style={{ fontSize: 38, letterSpacing: -1.8, color: green, lineHeight: 44 }}>
              {fmtCents(effectiveRevenueCents)}
            </MvText>
            {dashboard?.growthPct != null ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, marginBottom: 10 }}>
                <Ionicons name={dashboard.growthPct >= 0 ? "trending-up" : "trending-down"} size={12} color={dashboard.growthPct >= 0 ? green : RED} />
                <MvText variant="body4" style={{ fontSize: 11, color: dashboard.growthPct >= 0 ? green : RED }}>
                  {dashboard.growthPct >= 0 ? "+" : ""}{dashboard.growthPct.toFixed(0)}% vs mês anterior
                </MvText>
              </View>
            ) : <View style={{ height: 10 }} />}
            <View style={{ height: 1, backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)", marginBottom: 12 }} />
            <View style={{ flexDirection: "row" }}>
              <View style={{ flex: 1 }}>
                <MvText variant="body4" style={{ fontSize: 10, color: isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.35)", marginBottom: 2 }}>Despesas</MvText>
                <MvText variant="semi2" style={{ color: RED, fontSize: 18, letterSpacing: -0.5 }}>{fmtCents(manualExpensesCents)}</MvText>
              </View>
              <View style={{ width: 1, backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)", marginHorizontal: 16 }} />
              <View style={{ flex: 1 }}>
                <MvText variant="body4" style={{ fontSize: 10, color: isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.35)", marginBottom: 2 }}>Lucro líquido</MvText>
                <MvText variant="semi2" style={{ color: effectiveProfitCents >= 0 ? green : RED, fontSize: 18, letterSpacing: -0.5 }}>{fmtCents(effectiveProfitCents)}</MvText>
              </View>
            </View>
          </View>
        )}

        {/* Quick actions */}
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, marginTop: 12 }}>
          <TouchableOpacity
            onPress={() => setAddIncomeModal(true)}
            style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: isDark ? "rgba(0,200,83,0.10)" : "rgba(22,163,74,0.08)", borderWidth: 1, borderColor: isDark ? "rgba(0,200,83,0.22)" : "rgba(22,163,74,0.18)" }}
          >
            <Ionicons name="arrow-up-outline" size={15} color={green} />
            <MvText variant="semi3" style={{ color: green, fontSize: 13 }}>+ Receita</MvText>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setAddExpenseModal(true)}
            style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: isDark ? "rgba(248,113,113,0.08)" : "rgba(229,57,53,0.06)", borderWidth: 1, borderColor: isDark ? "rgba(248,113,113,0.18)" : "rgba(229,57,53,0.14)" }}
          >
            <Ionicons name="arrow-down-outline" size={15} color={RED} />
            <MvText variant="semi3" style={{ color: RED, fontSize: 13 }}>+ Despesa</MvText>
          </TouchableOpacity>
        </View>

        {/* MP banner */}
        {providerHasMp === false ? (
          <TouchableOpacity
            onPress={() => navigation.navigate("ConnectPayoutAccount")}
            activeOpacity={0.8}
            style={{ marginHorizontal: 16, marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: "rgba(250,204,21,0.35)", backgroundColor: isDark ? "rgba(250,204,21,0.10)" : "rgba(250,204,21,0.12)", paddingHorizontal: 12, paddingVertical: 10 }}
          >
            <Ionicons name="warning-outline" size={15} color={isDark ? "#FACC15" : "#B45309"} />
            <MvText variant="body4" style={{ flex: 1, color: isDark ? "#FACC15" : "#B45309", fontSize: 11 }}>
              Configure sua conta para ativar repasse automático via Mercado Pago.
            </MvText>
            <Ionicons name="chevron-forward" size={13} color={isDark ? "#FACC15" : "#B45309"} />
          </TouchableOpacity>
        ) : null}

        {/* Alunos section */}
        <SectionHeader
          title="Alunos"
          badge={activeStudents.length + appClients.length}
          onAction={() => navigation.navigate("FinancialStudents")}
          actionLabel="Ver e gerenciar →"
          theme={theme}
          isDark={isDark}
        />
        {loading ? (
          <SkeletonBlock height={100} />
        ) : activeStudents.length === 0 && appClients.length === 0 ? (
          <TouchableOpacity onPress={() => navigation.navigate("FinancialStudents")} style={{ marginHorizontal: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: "center", gap: 4 }}>
            <Ionicons name="person-add-outline" size={20} color={theme.text3} />
            <MvText variant="body4" color="secondary" style={{ fontSize: 12 }}>Nenhum aluno. Toque para adicionar.</MvText>
          </TouchableOpacity>
        ) : (
          <View style={{ marginHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: "hidden", backgroundColor: theme.bgSurface }}>
            {[...activeStudents.slice(0, 3)].map(s => (
              <CompactStudentItem key={s.id} s={s} />
            ))}
            {appClients.slice(0, Math.max(0, 3 - activeStudents.length)).map(c => (
              <View key={c.clientId} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: green, marginRight: 10 }} />
                <MvText variant="semi3" style={{ flex: 1, fontSize: 13 }} numberOfLines={1}>{c.name}</MvText>
                <MvText variant="body4" style={{ fontSize: 11, color: green }}>Pelo app</MvText>
              </View>
            ))}
            {(activeStudents.length + appClients.length) > 3 ? (
              <TouchableOpacity onPress={() => navigation.navigate("FinancialStudents")} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, gap: 4 }}>
                <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>
                  + {(activeStudents.length + appClients.length) - 3} mais
                </MvText>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Histórico section */}
        <SectionHeader
          title="Histórico do mês"
          onAction={() => navigation.navigate("FinancialHistory")}
          actionLabel="Ver tudo →"
          theme={theme}
          isDark={isDark}
        />
        {loading ? (
          <SkeletonBlock height={130} />
        ) : recentTransactions.length === 0 ? (
          <View style={{ marginHorizontal: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: "center" }}>
            <MvText variant="body4" color="secondary" style={{ fontSize: 12 }}>Nenhum lançamento este mês.</MvText>
          </View>
        ) : (
          <View style={{ marginHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: "hidden", backgroundColor: theme.bgSurface }}>
            {recentTransactions.map(tx => {
              const isInc = tx.type === "income";
              const desc = isInc ? (tx.item as FinancialIncome).description : (tx.item as FinancialExpense).description;
              const amount = isInc ? (tx.item as FinancialIncome).amountCents : (tx.item as FinancialExpense).amountCents;
              const dateStr = tx.date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" });
              return (
                <View key={`${tx.type}-${tx.item.id}`} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                  <Ionicons name={isInc ? "arrow-up" : "arrow-down"} size={13} color={isInc ? green : RED} style={{ marginRight: 10 }} />
                  <MvText variant="semi3" style={{ flex: 1, fontSize: 12 }} numberOfLines={1}>{desc}</MvText>
                  <MvText variant="body4" style={{ fontSize: 11, color: isInc ? green : RED, marginRight: 6 }}>
                    {isInc ? "+" : "-"}{fmtCents(amount)}
                  </MvText>
                  <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>{dateStr}</MvText>
                </View>
              );
            })}
          </View>
        )}

        {/* Metas section */}
        <SectionHeader
          title="Metas"
          onAction={() => navigation.navigate("FinancialGoals")}
          actionLabel="Ver →"
          theme={theme}
          isDark={isDark}
        />
        {loading ? (
          <SkeletonBlock height={60} />
        ) : !goal || (!goal.targetRevenueCents && !goal.targetStudents && !goal.targetWeeklyClasses) ? (
          <TouchableOpacity onPress={() => navigation.navigate("FinancialGoals")} style={{ marginHorizontal: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}>
            <Ionicons name="flag-outline" size={16} color={theme.text3} />
            <MvText variant="body4" color="secondary" style={{ fontSize: 12 }}>Nenhuma meta definida. Toque para configurar.</MvText>
          </TouchableOpacity>
        ) : (
          <View style={{ marginHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: "hidden", backgroundColor: theme.bgSurface, paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
            {goal.targetRevenueCents ? (() => {
              const pct = Math.min(100, Math.round((effectiveRevenueCents / goal.targetRevenueCents) * 100));
              return (
                <View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
                    <MvText variant="body4" style={{ fontSize: 12 }}>Faturamento</MvText>
                    <MvText variant="body4" style={{ fontSize: 11, color: pct >= 100 ? green : theme.text3 }}>{pct}%</MvText>
                  </View>
                  <View style={{ height: 7, borderRadius: 4, backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)", overflow: "hidden" }}>
                    <View style={{ height: 7, borderRadius: 4, width: `${pct}%`, backgroundColor: green }} />
                  </View>
                </View>
              );
            })() : null}
            {goal.targetStudents && dashboard ? (() => {
              const pct = Math.min(100, Math.round((dashboard.activeStudents / goal.targetStudents!) * 100));
              return (
                <View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
                    <MvText variant="body4" style={{ fontSize: 12 }}>Alunos ativos</MvText>
                    <MvText variant="body4" style={{ fontSize: 11, color: pct >= 100 ? "#42A5F5" : theme.text3 }}>{pct}%</MvText>
                  </View>
                  <View style={{ height: 7, borderRadius: 4, backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)", overflow: "hidden" }}>
                    <View style={{ height: 7, borderRadius: 4, width: `${pct}%`, backgroundColor: "#42A5F5" }} />
                  </View>
                </View>
              );
            })() : null}
          </View>
        )}
      </ScrollView>

      {/* Add Income modal */}
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
          <MvButton label={editingIncome ? "Salvar alterações" : "Salvar receita"} loading={saving} onPress={() => void handleAddIncome()} />
        </View>
      </ModalSheet>

      {/* Add Expense modal */}
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
            {(Object.keys(CAT_LABEL) as FinancialExpenseCategory[]).map(c => (
              <PressableScale key={c} scale={0.95} onPress={() => setECat(c)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: eCat === c ? "rgba(34,197,94,0.12)" : theme.chipBg, borderWidth: 1, borderColor: eCat === c ? "rgba(34,197,94,0.30)" : theme.border }}>
                <MvText variant="body4" style={{ color: eCat === c ? theme.primary : theme.text2, fontSize: 12 }}>{CAT_LABEL[c]}</MvText>
              </PressableScale>
            ))}
          </View>
          <MvText variant="body4" color="secondary">Data</MvText>
          <MvDatePicker value={eDate} onChange={setEDate} />
          <MvButton label={editingExpense ? "Salvar alterações" : "Salvar despesa"} loading={saving} onPress={() => void handleAddExpense()} />
        </View>
      </ModalSheet>

      {/* Mark as paid modal */}
      <ModalSheet
        visible={payStudentModal !== null}
        title={payStudentModal ? `Pago — ${payStudentModal.name}` : ""}
        onClose={() => setPayStudentModal(null)}
        theme={theme} topInset={insets.top}
      >
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvText variant="body4" color="secondary">Confirme o valor e a data do pagamento.</MvText>
          <MvInput keyboardType="numeric" placeholder="Valor recebido (R$)" value={payStudentValue} onChangeText={v => setPayStudentValue(maskPriceInput(v))} />
          <MvText variant="body4" color="secondary">Data do pagamento</MvText>
          <MvDatePicker value={payStudentDate} onChange={setPayStudentDate} />
          <MvButton label="Confirmar pagamento" loading={saving} onPress={() => void handleMarkStudentPaid()} />
        </View>
      </ModalSheet>
    </View>
  );
}
