import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator, Alert,
  ScrollView, StatusBar, TextInput, TouchableOpacity, View,
} from "react-native";
import { PressableScale } from "../../components/polish/PressableScale";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import {
  FinancialAppClient, FinancialIncome, FinancialRecurrence, FinancialStudent, FinancialStudentType,
  WeeklyScheduleSlot, financialApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvButton, MvCard, MvInput, MvModalSheet, MvText, MvToggle } from "../../components/mv";
import { MvDatePicker } from "../../components/mv";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { formatCurrencyBRL, maskPriceInput } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { useGooglePlacesSearch } from "../../hooks/useGooglePlacesSearch";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "FinancialStudents">;
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

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

type BillingOption = "recurring" | "period" | "one_time";
const BILLING_OPTIONS: { key: BillingOption; label: string }[] = [
  { key: "recurring", label: "Recorrente" },
  { key: "period", label: "Por período" },
  { key: "one_time", label: "Avulso" },
];
function billingOptionOf(s: Pick<FinancialStudent, "recurrence" | "recurrenceEndDate">): BillingOption {
  if (s.recurrence === "ONE_TIME") return "one_time";
  return s.recurrenceEndDate ? "period" : "recurring";
}

function normalizeTimeInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
function isValidTime(value: string) { return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value); }
function sortSchedule(schedule: WeeklyScheduleSlot[]) {
  return [...schedule].sort((a, b) => {
    const ai = WEEK_ORDER.indexOf(a.dayOfWeek as (typeof WEEK_ORDER)[number]);
    const bi = WEEK_ORDER.indexOf(b.dayOfWeek as (typeof WEEK_ORDER)[number]);
    return ai - bi;
  });
}

function CompactSchedulePicker({ schedule, onChange, theme }: {
  schedule: WeeklyScheduleSlot[]; onChange: (s: WeeklyScheduleSlot[]) => void; theme: MvThemeValue;
}) {
  const [selectedDays, setSelectedDays] = useState<number[]>(() => schedule.map(s => s.dayOfWeek));
  const [startTime, setStartTime] = useState(() => schedule.length > 0 ? schedule[0].startTime : "07:00");
  const [endTime, setEndTime]     = useState(() => schedule.length > 0 ? schedule[0].endTime   : "08:00");

  function buildSlots(days: number[], s: string, e: string): WeeklyScheduleSlot[] {
    return sortSchedule(days.map(d => ({ dayOfWeek: d, startTime: s, endTime: e })));
  }
  function toggleDay(day: number) {
    const next = selectedDays.includes(day) ? selectedDays.filter(d => d !== day) : [...selectedDays, day];
    setSelectedDays(next);
    onChange(buildSlots(next, startTime, endTime));
  }
  function onChangeStart(v: string) {
    const n = normalizeTimeInput(v); setStartTime(n);
    if (isValidTime(n) && isValidTime(endTime) && selectedDays.length > 0) onChange(buildSlots(selectedDays, n, endTime));
  }
  function onChangeEnd(v: string) {
    const n = normalizeTimeInput(v); setEndTime(n);
    if (isValidTime(startTime) && isValidTime(n) && selectedDays.length > 0) onChange(buildSlots(selectedDays, startTime, n));
  }

  return (
    <View style={{ gap: 7 }}>
      <MvText variant="badge" style={{ color: theme.text3, fontSize: 10 }}>Dias de aula</MvText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
        {WEEK_ORDER.map(day => {
          const active = selectedDays.includes(day);
          return (
            <PressableScale key={`csp-${day}`} scale={0.94} onPress={() => toggleDay(day)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: active ? "rgba(34,197,94,0.45)" : theme.border, backgroundColor: active ? "rgba(34,197,94,0.14)" : theme.chipBg }}>
              <MvText variant="badge" style={{ fontSize: 11, color: active ? theme.primary : theme.text2 }}>{DAY_LABELS[day]}</MvText>
            </PressableScale>
          );
        })}
      </View>
      {selectedDays.length > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput value={startTime} onChangeText={onChangeStart} placeholder="07:00" placeholderTextColor={theme.text3} keyboardType="numbers-and-punctuation" maxLength={5} style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 8, backgroundColor: theme.inputBg, paddingHorizontal: 10, paddingVertical: 7, color: theme.text1, fontSize: 13, textAlign: "center", fontFamily: "DMSans_400Regular" }} />
          <MvText variant="body4" color="secondary">às</MvText>
          <TextInput value={endTime} onChangeText={onChangeEnd} placeholder="08:00" placeholderTextColor={theme.text3} keyboardType="numbers-and-punctuation" maxLength={5} style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 8, backgroundColor: theme.inputBg, paddingHorizontal: 10, paddingVertical: 7, color: theme.text1, fontSize: 13, textAlign: "center", fontFamily: "DMSans_400Regular" }} />
        </View>
      ) : null}
    </View>
  );
}

type StudentsPageData = { students: FinancialStudent[]; incomes: FinancialIncome[]; appClients: FinancialAppClient[] };

export function FinancialStudentsScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const isDark = theme.mode === "dark";
  const green = isDark ? theme.primary : "#16A34A";
  const blue  = isDark ? "#38BDF8" : "#0284C7";
  const RED   = isDark ? "#F87171" : "#E53935";
  const warnColor  = isDark ? "#FCD34D" : "#B45309";
  const warnBg     = isDark ? "rgba(252,211,77,0.08)" : "rgba(180,83,9,0.07)";
  const warnBorder = isDark ? "rgba(252,211,77,0.18)" : "rgba(180,83,9,0.15)";
  const queryClient = useQueryClient();

  const [month, setMonth] = useState(currentMonthStr());

  const studentsQuery = useAuthQuery(
    queryKeys.financial.studentsPage(month),
    async (token) => {
      const [studs, incs, appCl] = await Promise.all([
        financialApi.listStudents(token),
        financialApi.listIncomes(token, month),
        financialApi.listAppClients(token, month),
      ]);
      return { students: studs as FinancialStudent[], incomes: incs as FinancialIncome[], appClients: appCl as FinancialAppClient[] };
    },
  );

  const students = studentsQuery.data?.students ?? ([] as FinancialStudent[]);
  const incomes = studentsQuery.data?.incomes ?? ([] as FinancialIncome[]);
  const appClients = studentsQuery.data?.appClients ?? ([] as FinancialAppClient[]);
  const loading = studentsQuery.isLoading;

  useEffect(() => {
    if (studentsQuery.error) {
      handleScreenError({ error: studentsQuery.error, showToast, fallbackMessage: "Falha ao carregar alunos.", navigation });
    }
  }, [studentsQuery.error, showToast, navigation]);

  const [saving, setSaving] = useState(false);
  const [addStudentModal, setAddStudentModal] = useState(false);
  const [togglingStudentId, setTogglingStudentId] = useState<string | null>(null);

  const [editingStudent, setEditingStudent] = useState<FinancialStudent | null>(null);

  const [sName, setSName] = useState("");
  const [sValue, setSValue] = useState("100,00");
  const [sType, setSType] = useState<FinancialStudentType>("PRESENTIAL");
  const [sSchedule, setSSchedule] = useState<WeeklyScheduleSlot[]>([]);
  const [sLocation, setSLocation] = useState("");
  const [sLocationQuery, setSLocationQuery] = useState("");
  const [sLocSuggOpen, setSLocSuggOpen] = useState(false);
  const [sPaymentDueDay, setSPaymentDueDay] = useState("");
  const [sBilling, setSBilling] = useState<BillingOption>("recurring");
  const [sRecurrenceEndDate, setSRecurrenceEndDate] = useState<Date>(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1); return d;
  });
  const locBlurRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { suggestions: locationSuggs, loading: locationSuggsLoading } = useGooglePlacesSearch(
    sLocationQuery, 0, 0, 50, sLocSuggOpen, ""
  );

  const paidStudentIds = React.useMemo(() => {
    const set = new Set<string>();
    incomes.forEach(inc => { if (inc.studentId) set.add(inc.studentId); });
    return set;
  }, [incomes]);


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

  function resetStudentForm() {
    setSName(""); setSValue("100,00"); setSType("PRESENTIAL"); setSSchedule([]);
    setSLocation(""); setSLocationQuery(""); setSLocSuggOpen(false); setSPaymentDueDay("");
    setSBilling("recurring");
    const d = new Date(); d.setMonth(d.getMonth() + 1); setSRecurrenceEndDate(d);
    setEditingStudent(null);
  }

  function openEditStudent(s: FinancialStudent) {
    setEditingStudent(s);
    setSName(s.name);
    setSValue(maskPriceInput(String(s.monthlyValueCents)));
    setSType(s.type);
    setSSchedule((s.weeklySchedule ?? []) as WeeklyScheduleSlot[]);
    setSLocation(s.location ?? "");
    setSLocationQuery(s.location ?? "");
    setSPaymentDueDay(s.paymentDueDay ? String(s.paymentDueDay) : "");
    setSBilling(billingOptionOf(s));
    setSRecurrenceEndDate(s.recurrenceEndDate ? new Date(s.recurrenceEndDate) : (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; })());
    setAddStudentModal(true);
  }

  async function handleAddStudent() {
    if (!sName.trim()) { showToast("Informe o nome.", "error"); return; }
    if (sBilling === "period" && sRecurrenceEndDate <= new Date()) {
      showToast("A data de término precisa ser no futuro.", "error");
      return;
    }
    try {
      setSaving(true);
      const parsedDueDay = Number(sPaymentDueDay);
      const hasPresential = sType === "PRESENTIAL" || sType === "BOTH";
      const payload = {
        name: sName.trim(),
        monthlyValueCents: parseCents(sValue),
        type: sType,
        weeklyFrequency: sSchedule.length > 0 ? sSchedule.length : 3,
        paymentDueDay: parsedDueDay >= 1 && parsedDueDay <= 31 ? parsedDueDay : undefined,
        location: hasPresential && sLocation.trim() ? sLocation.trim() : undefined,
        weeklySchedule: hasPresential && sSchedule.length > 0 ? sSchedule : undefined,
        recurrence: (sBilling === "one_time" ? "ONE_TIME" : "RECURRING") as FinancialRecurrence,
        recurrenceEndDate: sBilling === "period" ? sRecurrenceEndDate.toISOString() : null,
      };
      if (editingStudent) {
        const updated = await runWithAuth(t => financialApi.updateStudent(t, editingStudent.id, payload));
        queryClient.setQueryData<StudentsPageData>(queryKeys.financial.studentsPage(month), (old) =>
          old ? { ...old, students: old.students.map(s => s.id === updated.id ? updated as FinancialStudent : s) } : old
        );
        showToast("Aluno atualizado.", "success");
      } else {
        const newStudent = await runWithAuth(t => financialApi.createStudent(t, payload));
        queryClient.setQueryData<StudentsPageData>(queryKeys.financial.studentsPage(month), (old) =>
          old ? { ...old, students: [...old.students, newStudent as FinancialStudent] } : old
        );
        showToast("Aluno adicionado.", "success");
      }
      setAddStudentModal(false);
      resetStudentForm();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar aluno." });
    } finally { setSaving(false); }
  }

  async function handleDeleteStudent(id: string, name: string) {
    Alert.alert("Remover aluno", `Remover "${name}"?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Remover", style: "destructive", onPress: async () => {
        try {
          await runWithAuth(t => financialApi.deleteStudent(t, id));
          queryClient.setQueryData<StudentsPageData>(queryKeys.financial.studentsPage(month), (old) =>
            old ? { ...old, students: old.students.filter(s => s.id !== id) } : old
          );
        }
        catch { showToast("Falha ao remover.", "error"); }
      }},
    ]);
  }

  async function toggleStudentPaid(s: FinancialStudent) {
    if (togglingStudentId) return;
    setTogglingStudentId(s.id);
    try {
      if (paidStudentIds.has(s.id)) {
        const income = incomes.find(i => i.studentId === s.id);
        if (!income) return;
        await runWithAuth(t => financialApi.deleteIncome(t, income.id));
        queryClient.setQueryData<StudentsPageData>(queryKeys.financial.studentsPage(month), (old) =>
          old ? { ...old, incomes: old.incomes.filter(i => i.id !== income.id) } : old
        );
        showToast("Mensalidade desmarcada.", "success");
      } else {
        if (s.monthlyValueCents === 0) { showToast("Configure o valor mensal do aluno.", "error"); return; }
        const newIncome = await runWithAuth(t => financialApi.createIncome(t, {
          description: `Mensalidade — ${s.name}`,
          amountCents: s.monthlyValueCents,
          studentId: s.id,
          paidAt: `${new Date().toISOString().slice(0, 10)}T12:00:00.000Z`,
        }));
        queryClient.setQueryData<StudentsPageData>(queryKeys.financial.studentsPage(month), (old) =>
          old ? { ...old, incomes: [...old.incomes, newIncome as FinancialIncome] } : old
        );
        showToast("Mensalidade registrada.", "success");
      }
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao atualizar pagamento." });
    } finally {
      setTogglingStudentId(null);
    }
  }

  const hasPresential = sType === "PRESENTIAL" || sType === "BOTH";
  const active   = students.filter(s => s.isActive);
  const inactive = students.filter(s => !s.isActive);
  const pending  = active.filter(s => s.billableThisMonth && !paidStudentIds.has(s.id));
  const pendingAmount = pending.reduce((sum, s) => sum + s.monthlyValueCents, 0);
  const todayDay = new Date().getDate();

  function StudentRow({ s, dim }: { s: FinancialStudent; dim?: boolean }) {
    const slots = (s.weeklySchedule ?? []) as WeeklyScheduleSlot[];
    const dayLabels = sortSchedule(slots).map(sl => DAY_LABELS[sl.dayOfWeek]).join(" · ");
    const timeStr   = slots.length > 0 ? `${slots[0].startTime}–${slots[0].endTime}` : null;
    const typeLabel = s.type === "BOTH" ? "Consultoria e presencial"
      : s.type === "ONLINE" ? "Consultoria"
      : s.type === "PRESENTIAL" ? "Presencial" : "Pelo app";
    const billing = billingOptionOf(s);
    const billingLabel = billing === "one_time" ? "Avulso"
      : billing === "period" && s.recurrenceEndDate ? `Até ${new Date(s.recurrenceEndDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}`
      : null;
    const isPaid = paidStudentIds.has(s.id);
    const daysOverdue = s.paymentDueDay && !isPaid ? Math.max(0, todayDay - s.paymentDueDay) : 0;

    return (
      <MvCard style={{ opacity: dim ? 0.5 : 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <MvText variant="semi3" style={{ flex: 1 }}>{s.name}</MvText>
              <MvText variant="badge" style={{ color: blue }}>{fmtCents(s.monthlyValueCents)}</MvText>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
              <MvText variant="body4" style={{ color: blue, fontSize: 10 }}>{typeLabel}</MvText>
              {billingLabel ? (
                <MvText variant="body4" style={{ color: warnColor, fontSize: 10 }}>· {billingLabel}</MvText>
              ) : null}
            </View>
            {dayLabels ? (
              <MvText variant="body4" color="secondary" style={{ fontSize: 11, marginTop: 2 }}>
                {dayLabels}{timeStr ? ` - ${timeStr}` : ""}{s.location ? ` - ${s.location}` : ""}
              </MvText>
            ) : null}
          </View>
          <PressableScale scale={0.88} onPress={() => openEditStudent(s)} style={{ marginRight: 6 }}>
            <Ionicons name="pencil-outline" size={15} color={theme.text3} />
          </PressableScale>
          <PressableScale scale={0.88} onPress={() => void handleDeleteStudent(s.id, s.name)}>
            <Ionicons name="trash-outline" size={16} color={RED} />
          </PressableScale>
        </View>
        {s.isActive && !dim && s.billableThisMonth ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.border }}>
            {!isPaid && (daysOverdue > 0 || s.paymentDueDay) ? (
              <MvText variant="badge" style={{ fontSize: 10, color: daysOverdue > 0 ? RED : warnColor }}>
                {daysOverdue > 0 ? `Atrasado ${daysOverdue}d` : `Vence dia ${s.paymentDueDay}`}
              </MvText>
            ) : <View />}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <MvText variant="badge" style={{ fontSize: 10, color: isPaid ? green : theme.text3 }}>
                {isPaid ? "Pago" : "Pendente"}
              </MvText>
              <MvToggle
                value={isPaid}
                onValueChange={() => void toggleStudentPaid(s)}
                disabled={togglingStudentId !== null}
              />
            </View>
          </View>
        ) : s.isActive && !dim ? (
          <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.border }}>
            <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>Sem cobrança neste mês</MvText>
          </View>
        ) : null}
      </MvCard>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader
        title="Alunos"
        onBack={() => navigation.goBack()}
        action={{ icon: "add-outline", label: "Novo", onPress: () => setAddStudentModal(true) }}
      />

      {/* Month selector */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 6 }}>
        <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={20} color={theme.text3} />
        </TouchableOpacity>
        <MvText variant="semi2" style={{ fontSize: 14, letterSpacing: -0.3 }}>{monthLabel(month)}</MvText>
        <TouchableOpacity onPress={nextMonth} disabled={month >= currentMonthStr()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ opacity: month >= currentMonthStr() ? 0.3 : 1 }}>
          <Ionicons name="chevron-forward" size={20} color={theme.text3} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40, gap: 6 }} showsVerticalScrollIndicator={false}>
          {/* Resumo de pendências */}
          {active.length > 0 ? (
            pending.length === 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 10, backgroundColor: isDark ? "rgba(0,200,83,0.08)" : "rgba(22,163,74,0.07)", borderWidth: 1, borderColor: isDark ? "rgba(0,200,83,0.18)" : "rgba(22,163,74,0.15)" }}>
                <Ionicons name="checkmark-circle" size={13} color={green} />
                <MvText variant="body4" style={{ color: green, fontSize: 11 }}>Todos os alunos pagaram este mês</MvText>
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 10, backgroundColor: warnBg, borderWidth: 1, borderColor: warnBorder }}>
                <Ionicons name="time-outline" size={13} color={warnColor} />
                <MvText variant="body4" style={{ flex: 1, color: warnColor, fontSize: 11 }}>
                  {pending.length} aluno{pending.length !== 1 ? "s" : ""} pendente{pending.length !== 1 ? "s" : ""} · {fmtCents(pendingAmount)} a receber
                </MvText>
              </View>
            )
          ) : null}

          {/* Clientes do App */}
          {appClients.length > 0 ? (
            <>
              <MvText variant="semi3" style={{ color: green, fontSize: 11, marginTop: 8, marginBottom: 2 }}>
                Pelo App ({appClients.length})
              </MvText>
              {appClients.map(c => {
                const initials = c.name.split(" ").slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase();
                return (
                  <MvCard key={c.clientId}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={{ position: "relative" }}>
                        <MvAvatar initials={initials} size={40} tone="green" />
                        <View style={{ position: "absolute", bottom: -1, right: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: green, borderWidth: 2, borderColor: theme.bgSurface }} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <MvText variant="semi3" style={{ flex: 1, fontSize: 13 }}>{c.name}</MvText>
                          <MvText variant="semi2" style={{ color: green, fontSize: 14, letterSpacing: -0.5 }}>{fmtCents(c.completedCents)}</MvText>
                        </View>
                        <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>
                          {c.sessionCount} sessão{c.sessionCount !== 1 ? "ões" : ""} concluída{c.sessionCount !== 1 ? "s" : ""}
                        </MvText>
                      </View>
                    </View>
                  </MvCard>
                );
              })}
              <View style={{ height: 4 }} />
            </>
          ) : null}

          {/* Alunos manuais */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
            <MvText variant="semi3" style={{ color: blue, fontSize: 11 }}>
              Outros clientes ({active.length})
            </MvText>
            <PressableScale scale={0.92} onPress={() => setAddStudentModal(true)}>
              <MvText variant="body4" style={{ color: blue, fontSize: 11 }}>+ Novo aluno</MvText>
            </PressableScale>
          </View>

          {students.length === 0 && appClients.length === 0 ? (
            <MvText variant="body4" color="secondary" style={{ textAlign: "center", marginTop: 24 }}>
              Nenhum aluno cadastrado.
            </MvText>
          ) : null}

          {active.map(s => <StudentRow key={s.id} s={s} />)}

          {inactive.length > 0 ? (
            <>
              <MvText variant="body4" color="secondary" style={{ marginTop: 8, fontSize: 11 }}>
                Inativos ({inactive.length})
              </MvText>
              {inactive.map(s => <StudentRow key={s.id} s={s} dim />)}
            </>
          ) : null}
        </ScrollView>
      )}

      {/* Add / Edit Student Modal */}
      <MvModalSheet visible={addStudentModal} title={editingStudent ? "Editar aluno" : "Novo aluno"} onClose={() => { setAddStudentModal(false); resetStudentForm(); }}>
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvInput placeholder="Nome do aluno" value={sName} onChangeText={setSName} />
          <View style={{ flexDirection: "row", gap: 6 }}>
            {([{ key: "PRESENTIAL", label: "Presencial" }, { key: "ONLINE", label: "Consultoria" }, { key: "BOTH", label: "Ambos" }] as { key: FinancialStudentType; label: string }[]).map(t => (
              <PressableScale key={t.key} scale={0.95} onPress={() => { setSType(t.key); setSSchedule([]); }} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: sType === t.key ? "rgba(34,197,94,0.12)" : theme.chipBg, borderWidth: 1, borderColor: sType === t.key ? "rgba(34,197,94,0.30)" : theme.border }}>
                <MvText variant="body4" style={{ color: sType === t.key ? theme.primary : theme.text2 }}>{t.label}</MvText>
              </PressableScale>
            ))}
          </View>
          {hasPresential ? (
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: sLocSuggOpen ? "rgba(34,197,94,0.50)" : theme.border, borderRadius: 10, backgroundColor: theme.inputBg, paddingHorizontal: 10, paddingVertical: 8 }}>
                <Ionicons name="location-outline" size={13} color={locationSuggsLoading ? theme.primary : theme.text3} />
                <TextInput
                  value={sLocationQuery}
                  onChangeText={v => { setSLocationQuery(v); setSLocation(v); }}
                  onFocus={() => { if (locBlurRef.current) clearTimeout(locBlurRef.current); setSLocSuggOpen(true); }}
                  onBlur={() => { locBlurRef.current = setTimeout(() => setSLocSuggOpen(false), 400); }}
                  placeholder="Local de atendimento (opcional)"
                  placeholderTextColor={theme.text3}
                  style={{ flex: 1, padding: 0, color: theme.text1, fontSize: 13, fontFamily: "DMSans_400Regular" }}
                />
                {locationSuggsLoading ? <ActivityIndicator size="small" color={theme.primary} /> : null}
              </View>
              {locationSuggs.length > 0 && sLocSuggOpen ? (
                <ScrollView style={{ maxHeight: 160, marginTop: 3, borderWidth: 1, borderColor: theme.border, borderRadius: 9 }} keyboardShouldPersistTaps="always">
                  {locationSuggs.map((s, idx) => (
                    <PressableScale key={s.placeId ?? `ls-${idx}`} scale={0.98}
                      onPressIn={() => { if (locBlurRef.current) clearTimeout(locBlurRef.current); }}
                      onPress={() => {
                        const text = s.address ? `${s.name}, ${s.address.replace(/, Brasil$/, "").replace(/, Brazil$/, "")}` : s.name;
                        setSLocation(text); setSLocationQuery(text); setSLocSuggOpen(false);
                      }}
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: idx > 0 ? 1 : 0, borderColor: theme.borderSub, backgroundColor: theme.cardBg }}
                    >
                      <Ionicons name="location-outline" size={12} color={theme.primary} />
                      <View style={{ flex: 1 }}>
                        <MvText variant="body4" numberOfLines={1} style={{ fontSize: 11 }}>{s.name}</MvText>
                        {s.address ? <MvText variant="body4" color="secondary" numberOfLines={1} style={{ fontSize: 10 }}>{s.address}</MvText> : null}
                      </View>
                    </PressableScale>
                  ))}
                </ScrollView>
              ) : null}
            </View>
          ) : null}
          <MvInput keyboardType="numeric" placeholder="Valor mensal (R$)" value={sValue} onChangeText={v => setSValue(maskPriceInput(v))} />
          <MvInput keyboardType="numeric" placeholder="Dia de vencimento (ex: 5)" value={sPaymentDueDay} onChangeText={v => setSPaymentDueDay(v.replace(/\D/g, "").slice(0, 2))} />
          {hasPresential ? <CompactSchedulePicker schedule={sSchedule} onChange={setSSchedule} theme={theme} /> : null}
          <View style={{ gap: 7 }}>
            <MvText variant="badge" style={{ color: theme.text3, fontSize: 10 }}>Cobrança</MvText>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {BILLING_OPTIONS.map(opt => (
                <PressableScale key={opt.key} scale={0.95} onPress={() => setSBilling(opt.key)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: sBilling === opt.key ? "rgba(34,197,94,0.12)" : theme.chipBg, borderWidth: 1, borderColor: sBilling === opt.key ? "rgba(34,197,94,0.30)" : theme.border }}>
                  <MvText variant="body4" style={{ color: sBilling === opt.key ? theme.primary : theme.text2 }}>{opt.label}</MvText>
                </PressableScale>
              ))}
            </View>
            <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>
              {sBilling === "recurring" ? "Cobra todo mês, sem data pra parar."
                : sBilling === "period" ? "Cobra todo mês até a data de término abaixo."
                : "Vale só para o mês em que o aluno foi cadastrado."}
            </MvText>
            {sBilling === "period" ? <MvDatePicker value={sRecurrenceEndDate} onChange={setSRecurrenceEndDate} /> : null}
          </View>
          <MvButton label={editingStudent ? "Salvar alterações" : "Salvar aluno"} loading={saving} onPress={() => void handleAddStudent()} />
        </View>
      </MvModalSheet>

    </View>
  );
}
