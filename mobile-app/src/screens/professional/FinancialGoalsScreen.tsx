import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  ScrollView, StatusBar, TouchableOpacity, View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { FinancialDashboard, FinancialGoal, financialApi, providersApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvInput, MvModalSheet, MvText } from "../../components/mv";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { formatCurrencyBRL, maskPriceInput } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "FinancialGoals">;

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

function GoalBar({
  label, current, target, formatFn, color, isDark,
}: {
  label: string; current: number; target: number;
  formatFn: (v: number) => string; color: string; isDark: boolean;
}) {
  const pct = Math.min(1, target > 0 ? current / target : 0);
  const pctInt = Math.round(pct * 100);
  return (
    <View style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <MvText variant="semi3" style={{ fontSize: 14 }}>{label}</MvText>
        <MvText variant="body4" style={{ fontSize: 12, color: pctInt >= 100 ? color : undefined }}>
          {pctInt}%
        </MvText>
      </View>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)", overflow: "hidden" }}>
        <View style={{ height: 10, borderRadius: 5, width: `${pctInt}%`, backgroundColor: color }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
        <MvText variant="body4" style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.35)" }}>
          {formatFn(current)}
        </MvText>
        <MvText variant="body4" style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.35)" }}>
          meta: {formatFn(target)}
        </MvText>
      </View>
    </View>
  );
}

export function FinancialGoalsScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const isDark = theme.mode === "dark";
  const green = isDark ? theme.primary : "#16A34A";
  const queryClient = useQueryClient();

  // Épico de Frentes, Frente 7, Lote 13: tela de Metas não tinha seletor de
  // mês (única entre as telas financeiras sem esse controle) - profissional
  // não conseguia conferir a meta de um mês passado ou já planejar a de um
  // mês futuro.
  const [month, setMonth] = useState(currentMonthStr());

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

  const goalsQuery = useAuthQuery(
    queryKeys.financial.goal(month),
    async (token) => {
      const [gl, dash, studs, incs] = await Promise.all([
        financialApi.getGoal(token, month),
        financialApi.dashboard(token, month),
        financialApi.listStudents(token),
        financialApi.listIncomes(token, month),
      ]);
      return { goal: gl as FinancialGoal | null, dashboard: dash as FinancialDashboard, students: studs, incomes: incs };
    },
  );

  const goal = goalsQuery.data?.goal ?? null;
  const dashboard = goalsQuery.data?.dashboard ?? null;

  // Épico de Frentes, Frente 6, Lote 8: "alunos ativos" usa a mesma fonte de
  // verdade da Home/Gestão de Alunos (dashboardStudents, considera
  // presencial + consultoria de vendas reais pelo app), não mais
  // FinancialStudent (lista manual do profissional, sem relação com ofertas
  // reais) - profissional que só vende pelo app via dashboard.activeStudents
  // sempre via 0.
  const studentsQuery = useAuthQuery(
    queryKeys.providers.dashboardStudents(),
    (token) => providersApi.dashboardStudents(token),
    { retry: false },
  );
  // Épico de Frentes, Frente 7, Lote 10: `loading` só considerava
  // goalsQuery - como "alunos ativos" vem de studentsQuery (query
  // separada), a barra de progresso podia renderizar com current=0 por um
  // instante (ou pra sempre, se studentsQuery falhasse) mesmo com o resto
  // da tela já carregado, sem nenhum aviso.
  const loading = goalsQuery.isLoading || studentsQuery.isLoading;
  const activeStudentsCount = useMemo(
    () => studentsQuery.data?.students.filter((s) => s.active).length ?? 0,
    [studentsQuery.data]
  );

  const effectiveRevenue = useMemo(() => {
    const d = goalsQuery.data;
    if (!d) return 0;
    // Épico de Frentes, Frente 7, Lote 5: stuRev já soma o valor mensal do
    // aluno manual; marcar esse aluno como "pago" cria uma FinancialIncome
    // com studentId apontando pra ele, que manRev também somava — contando
    // a mesma receita duas vezes. manRev agora só soma receita manual
    // avulsa de verdade (sem studentId). billableThisMonth (não isActive)
    // evita contar aluno fora do período de cobrança (ex: recorrência já
    // encerrada) indefinidamente.
    const stuRev = d.students.filter(s => s.billableThisMonth).reduce((s, st) => s + st.monthlyValueCents, 0);
    const manRev = d.incomes.filter(i => !i.studentId).reduce((s, i) => s + i.amountCents, 0);
    // Épico de Frentes, Frente 7, Lote 12: appRev trocava de fórmula
    // silenciosamente (somava appClients quando havia algum, senão caía pro
    // dashboard) — appClients não inclui renovação de ficha, então o
    // faturamento da tela de Metas podia ficar mais baixo que o mesmo mês no
    // dashboard/extrato dependendo de qual ramo rodava. dashboard.appRevenueCents
    // já cobre todos os tipos de receita pelo app, sempre.
    const appRev = d.dashboard?.appRevenueCents ?? 0;
    return appRev + stuRev + manRev;
  }, [goalsQuery.data]);

  const [saving, setSaving] = useState(false);
  const [editModal, setEditModal] = useState(false);

  const [gRevenue, setGRevenue] = useState("");
  const [gStudents, setGStudents] = useState("");
  const [gClasses, setGClasses] = useState("");

  useEffect(() => {
    const gl = goalsQuery.data?.goal;
    if (!gl) return;
    setGRevenue(gl.targetRevenueCents ? maskPriceInput(String(gl.targetRevenueCents)) : "");
    setGStudents(gl.targetStudents ? String(gl.targetStudents) : "");
    setGClasses(gl.targetWeeklyClasses ? String(gl.targetWeeklyClasses) : "");
  }, [goalsQuery.data?.goal]);

  useEffect(() => {
    if (goalsQuery.error) {
      handleScreenError({ error: goalsQuery.error, showToast, fallbackMessage: "Falha ao carregar metas.", navigation });
    }
  }, [goalsQuery.error, showToast, navigation]);

  // Épico de Frentes, Frente 7, Lote 10: studentsQuery (retry: false) tinha
  // erro só ignorado silenciosamente - "Alunos ativos" ficava travado em 0
  // pra sempre sem nenhum aviso de que era uma falha, não o valor real.
  useEffect(() => {
    if (studentsQuery.error) {
      showToast("Falha ao carregar alunos ativos.", "error");
    }
  }, [studentsQuery.error, showToast]);

  // Épico de Frentes, Frente 7, Lote 10: tela de Metas não recarregava ao
  // voltar de outra tela (ex: registrar um pagamento em Alunos Financeiros)
  // - só dashboard e Home tinham esse padrão de useFocusEffect.
  useFocusEffect(useCallback(() => {
    void goalsQuery.refetch();
    void studentsQuery.refetch();
  }, [goalsQuery.refetch, studentsQuery.refetch]));

  async function handleSave() {
    try {
      setSaving(true);
      // Épico de Frentes, Frente 7, Lote 11: envia `null` (não `undefined`)
      // quando o campo fica vazio - o texto da tela promete "deixe em
      // branco pra não monitorar", mas undefined faz o backend só "não
      // mexer" na meta antiga, nunca removê-la de fato.
      const savedGoal = await runWithAuth(t => financialApi.upsertGoal(t, {
        month,
        targetRevenueCents: gRevenue ? parseCents(gRevenue) : null,
        targetStudents: gStudents ? Number(gStudents) : null,
        targetWeeklyClasses: gClasses ? Number(gClasses) : null,
      }));
      queryClient.setQueryData<typeof goalsQuery.data>(queryKeys.financial.goal(month), (old) =>
        old ? { ...old, goal: savedGoal as FinancialGoal } : old
      );
      setEditModal(false);
      showToast("Meta salva.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar meta." });
    } finally { setSaving(false); }
  }

  const hasGoal = Boolean(goal && (goal.targetRevenueCents || goal.targetStudents || goal.targetWeeklyClasses));
  const d = dashboard;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader
        title="Metas"
        onBack={() => navigation.goBack()}
        action={{ icon: "pencil-outline", label: "Editar", onPress: () => setEditModal(true) }}
      />

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
      ) : !hasGoal ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Ionicons name="flag-outline" size={44} color={theme.text3} />
          <MvText variant="semi2" style={{ textAlign: "center" }}>Nenhuma meta definida</MvText>
          <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
            Defina metas mensais para acompanhar seu progresso.
          </MvText>
          <MvButton label="Definir metas" onPress={() => setEditModal(true)} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <MvCard>
            {goal?.targetRevenueCents && d ? (
              <GoalBar label="Faturamento" current={effectiveRevenue} target={goal.targetRevenueCents} formatFn={fmtCents} color={green} isDark={isDark} />
            ) : null}
            {goal?.targetStudents && d ? (
              <GoalBar label="Alunos ativos" current={activeStudentsCount} target={goal.targetStudents} formatFn={v => `${v} aluno${v !== 1 ? "s" : ""}`} color="#42A5F5" isDark={isDark} />
            ) : null}
            {goal?.targetWeeklyClasses && d ? (
              <GoalBar label="Aulas por semana" current={d.weeklyClasses} target={goal.targetWeeklyClasses} formatFn={v => `${v} aula${v !== 1 ? "s" : ""}`} color="#FF9800" isDark={isDark} />
            ) : null}
          </MvCard>
        </ScrollView>
      )}

      <MvModalSheet visible={editModal} title={hasGoal ? "Editar metas" : "Definir metas"} onClose={() => setEditModal(false)}>
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvText variant="body4" color="secondary">
            Configure as metas para {monthLabel(month)}. Deixe em branco para não monitorar.
          </MvText>
          <MvInput placeholder="Meta de faturamento (R$)" keyboardType="numeric" value={gRevenue} onChangeText={v => setGRevenue(maskPriceInput(v))} />
          <MvInput placeholder="Meta de alunos ativos (ex: 15)" keyboardType="number-pad" value={gStudents} onChangeText={v => setGStudents(v.replace(/\D/g, ""))} />
          <MvInput placeholder="Meta de aulas por semana (ex: 12)" keyboardType="number-pad" value={gClasses} onChangeText={v => setGClasses(v.replace(/\D/g, ""))} />
          <MvButton label="Salvar metas" loading={saving} onPress={() => void handleSave()} />
          <MvButton variant="ghost" label="Cancelar" onPress={() => setEditModal(false)} />
        </View>
      </MvModalSheet>
    </View>
  );
}
