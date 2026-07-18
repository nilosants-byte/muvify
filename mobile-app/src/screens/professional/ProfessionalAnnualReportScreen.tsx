import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Share,
  StatusBar,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { financialApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvText } from "../../components/mv";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { PressableScale } from "../../components/polish/PressableScale";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "AnnualReport">;

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTH_FULL  = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function fmtCents(cents: number) { return formatCurrencyBRL(cents / 100); }
function fmtCentsShort(cents: number): string {
  const v = cents / 100;
  if (v >= 1000) return `R$${(v / 1000).toFixed(1)}k`;
  return `R$${Math.round(v)}`;
}

type MonthEntry = {
  month: string;
  revenueCents: number;
  appRevenueCents: number;
  expensesCents: number;
  netCents: number;
};

export function ProfessionalAnnualReportScreen({ navigation }: Props) {
  const { showToast, user } = useAppState();
  const { theme } = useMvTheme();
  const isDark = theme.mode === "dark";

  const reportQuery = useAuthQuery(
    queryKeys.financial.report(36),
    (token) => financialApi.report(token, 36),
  );

  const allMonths = (reportQuery.data?.months ?? []) as MonthEntry[];
  const loading = reportQuery.isLoading;

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (reportQuery.error) {
      handleScreenError({ error: reportQuery.error, showToast, fallbackMessage: "Falha ao carregar relatório.", navigation });
    }
  }, [reportQuery.error, showToast, navigation]);

  const availableYears = [...new Set(allMonths.map(m => Number(m.month.split("-")[0])))].sort((a, b) => b - a);
  if (!availableYears.includes(new Date().getFullYear())) availableYears.unshift(new Date().getFullYear());

  const yearMonths = allMonths.filter(m => m.month.startsWith(String(selectedYear)));

  const now = new Date();
  const monthsElapsed = selectedYear === now.getFullYear() ? now.getMonth() + 1 : 12;

  const allYearSlots: (MonthEntry | null)[] = Array.from({ length: monthsElapsed }, (_, i) => {
    const key = `${selectedYear}-${String(i + 1).padStart(2, "0")}`;
    return yearMonths.find(m => m.month === key) ?? null;
  });

  const totalRevenue  = yearMonths.reduce((s, m) => s + m.revenueCents + m.appRevenueCents, 0);
  const totalExpenses = yearMonths.reduce((s, m) => s + m.expensesCents, 0);
  const totalNet      = totalRevenue - totalExpenses;
  const avgMonthly    = monthsElapsed > 0 ? Math.round(totalRevenue / monthsElapsed) : 0;

  const emptyMonths = allYearSlots.filter(m => m === null).length;
  const completeness = monthsElapsed > 0 ? Math.round(((monthsElapsed - emptyMonths) / monthsElapsed) * 100) : 100;

  const GREEN  = theme.textGreen;
  const RED    = theme.danger;
  const YELLOW = theme.warning;

  async function handleShare() {
    try {
      setSharing(true);
      const lines: string[] = [
        `📊 RELATÓRIO ANUAL ${selectedYear} — MUVIFY`,
        ``,
        `💰 RESUMO FINANCEIRO`,
        `Faturamento total: ${fmtCents(totalRevenue)}`,
        `Total de despesas: ${fmtCents(totalExpenses)}`,
        `Lucro líquido:     ${fmtCents(totalNet)}`,
        `Média mensal:      ${fmtCents(avgMonthly)}`,
        ``,
        `📅 HISTÓRICO MENSAL`,
      ];

      allYearSlots.forEach((m, i) => {
        const name = MONTH_NAMES[i] ?? String(i + 1);
        if (!m) {
          lines.push(`${name}  ⚠️ sem registros`);
        } else {
          const rev = m.revenueCents + m.appRevenueCents;
          lines.push(`${name}  Rec: ${fmtCentsShort(rev)}  Desp: ${fmtCentsShort(m.expensesCents)}  Lucro: ${fmtCentsShort(m.netCents)}`);
        }
      });

      if (emptyMonths > 0) {
        lines.push(``);
        lines.push(`⚠️ ${emptyMonths} mês${emptyMonths !== 1 ? "es" : ""} sem registros em ${selectedYear}`);
      }

      lines.push(``);
      lines.push(`Gerado pelo MUVIFY em ${now.toLocaleDateString("pt-BR")}`);

      await Share.share({ message: lines.join("\n") });
    } catch {
      showToast("Não foi possível compartilhar.", "error");
    } finally {
      setSharing(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader title="Relatório Anual" onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>

          {/* Seletor de ano */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 4 }}>
            <PressableScale scale={0.88} onPress={() => {
              const idx = availableYears.indexOf(selectedYear);
              if (idx < availableYears.length - 1) setSelectedYear(availableYears[idx + 1]);
            }}>
              <Ionicons name="chevron-back" size={20} color={theme.text3} />
            </PressableScale>
            <MvText variant="semi2" style={{ fontSize: 20, letterSpacing: -0.5 }}>{selectedYear}</MvText>
            <PressableScale scale={0.88} onPress={() => {
              const idx = availableYears.indexOf(selectedYear);
              if (idx > 0) setSelectedYear(availableYears[idx - 1]);
            }}>
              <Ionicons name="chevron-forward" size={20} color={theme.text3} />
            </PressableScale>
          </View>

          {/* Completude do ano */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, backgroundColor: completeness >= 80 ? (isDark ? "rgba(74,222,128,0.07)" : "rgba(22,163,74,0.06)") : (isDark ? "rgba(252,211,77,0.08)" : "rgba(180,83,9,0.07)"), borderWidth: 1, borderColor: completeness >= 80 ? (isDark ? "rgba(74,222,128,0.18)" : "rgba(22,163,74,0.15)") : (isDark ? "rgba(252,211,77,0.18)" : "rgba(180,83,9,0.15)") }}>
            <Ionicons name={completeness >= 80 ? "checkmark-circle-outline" : "warning-outline"} size={14} color={completeness >= 80 ? GREEN : YELLOW} />
            <MvText variant="body4" style={{ flex: 1, fontSize: 11, color: completeness >= 80 ? GREEN : YELLOW }}>
              {emptyMonths === 0
                ? `${monthsElapsed} de ${monthsElapsed} meses com registros — organização completa`
                : `${monthsElapsed - emptyMonths} de ${monthsElapsed} meses com registros (${completeness}%)`}
            </MvText>
          </View>

          {/* Resumo do ano */}
          <MvCard>
            <MvText variant="semi2" style={{ marginBottom: 10 }}>Resumo de {selectedYear}</MvText>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1, gap: 10 }}>
                <View>
                  <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>Faturamento total</MvText>
                  <MvText variant="semi2" style={{ color: GREEN, fontSize: 18, letterSpacing: -0.5 }}>{fmtCents(totalRevenue)}</MvText>
                </View>
                <View>
                  <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>Lucro líquido</MvText>
                  <MvText variant="semi2" style={{ color: totalNet >= 0 ? GREEN : RED, fontSize: 16, letterSpacing: -0.4 }}>{fmtCents(totalNet)}</MvText>
                </View>
              </View>
              <View style={{ flex: 1, gap: 10 }}>
                <View>
                  <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>Total de despesas</MvText>
                  <MvText variant="semi2" style={{ color: RED, fontSize: 18, letterSpacing: -0.5 }}>{fmtCents(totalExpenses)}</MvText>
                </View>
                <View>
                  <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>Média mensal</MvText>
                  <MvText variant="semi2" style={{ fontSize: 16, letterSpacing: -0.4 }}>{fmtCents(avgMonthly)}</MvText>
                </View>
              </View>
            </View>
          </MvCard>

          {/* Mês a mês */}
          <MvCard>
            <MvText variant="semi2" style={{ marginBottom: 10 }}>Mês a mês</MvText>
            {allYearSlots.length === 0 ? (
              <MvText variant="body4" color="secondary">Nenhum dado disponível para {selectedYear}.</MvText>
            ) : (
              allYearSlots.map((m, i) => {
                const rev = m ? m.revenueCents + m.appRevenueCents : 0;
                const isEmpty = m === null;
                const isCurrentMonth = selectedYear === now.getFullYear() && i === now.getMonth();
                return (
                  <View
                    key={i}
                    style={{
                      flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: isCurrentMonth ? 8 : 0,
                      marginHorizontal: isCurrentMonth ? -8 : 0,
                      borderRadius: isCurrentMonth ? 10 : 0,
                      backgroundColor: isCurrentMonth ? theme.primarySubtle : "transparent",
                      borderBottomWidth: isCurrentMonth ? 0 : (i < allYearSlots.length - 1 ? 1 : 0), borderBottomColor: theme.border,
                    }}
                  >
                    <View style={{ width: 36 }}>
                      <MvText variant="semi3" style={{ fontSize: 12, color: isCurrentMonth ? theme.textGreen : isEmpty ? theme.text3 : theme.text1 }}>{MONTH_NAMES[i]}</MvText>
                    </View>
                    {isEmpty ? (
                      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <Ionicons name="warning-outline" size={11} color={YELLOW} />
                        <MvText variant="body4" style={{ color: YELLOW, fontSize: 11 }}>sem registros</MvText>
                      </View>
                    ) : (
                      <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between" }}>
                        <View>
                          <MvText variant="body4" style={{ fontSize: 10, color: theme.text3 }}>Receita</MvText>
                          <MvText variant="semi3" style={{ fontSize: 12, color: GREEN }}>{fmtCentsShort(rev)}</MvText>
                        </View>
                        <View>
                          <MvText variant="body4" style={{ fontSize: 10, color: theme.text3 }}>Despesas</MvText>
                          <MvText variant="semi3" style={{ fontSize: 12, color: RED }}>{fmtCentsShort(m!.expensesCents)}</MvText>
                        </View>
                        <View>
                          <MvText variant="body4" style={{ fontSize: 10, color: theme.text3 }}>Lucro</MvText>
                          <MvText variant="semi3" style={{ fontSize: 12, color: m!.netCents >= 0 ? GREEN : RED }}>{fmtCentsShort(m!.netCents)}</MvText>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </MvCard>

          {/* Situação para IR */}
          <MvCard>
            <MvText variant="semi2" style={{ marginBottom: 10 }}>Situação para o Imposto de Renda</MvText>
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <MvText variant="body4" color="secondary">Receitas registradas</MvText>
                <MvText variant="semi3" style={{ color: GREEN }}>{fmtCents(totalRevenue)}</MvText>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <MvText variant="body4" color="secondary">Despesas profissionais</MvText>
                <MvText variant="semi3" style={{ color: RED }}>{fmtCents(totalExpenses)}</MvText>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <MvText variant="body4" color="secondary">Meses com dados completos</MvText>
                <MvText variant="semi3" style={{ color: emptyMonths === 0 ? GREEN : YELLOW }}>
                  {monthsElapsed - emptyMonths} de {monthsElapsed}
                </MvText>
              </View>
              {emptyMonths > 0 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  <MvText variant="body4" style={{ color: YELLOW, fontSize: 11 }}>Meses sem registros: </MvText>
                  <MvText variant="body4" style={{ color: YELLOW, fontSize: 11 }}>
                    {allYearSlots.map((m, i) => m === null ? MONTH_FULL[i] : null).filter(Boolean).join(", ")}
                  </MvText>
                </View>
              ) : null}
              <View style={{ marginTop: 6, padding: 9, borderRadius: 8, backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}>
                <MvText variant="body4" style={{ fontSize: 10, color: theme.text3, lineHeight: 15 }}>
                  Este relatório é um resumo dos dados registrados no app. Para fins de declaração, sempre confirme os valores com seu contador.
                </MvText>
              </View>
            </View>
          </MvCard>

          {/* Botão de compartilhar */}
          <MvButton
            label={sharing ? "Gerando relatório..." : "Compartilhar relatório"}
            loading={sharing}
            onPress={() => void handleShare()}
          />
          <MvText variant="body4" color="secondary" style={{ textAlign: "center", fontSize: 11 }}>
            O relatório é enviado como texto formatado — ideal para WhatsApp ou e-mail para o contador.
          </MvText>

        </ScrollView>
      )}
    </View>
  );
}
