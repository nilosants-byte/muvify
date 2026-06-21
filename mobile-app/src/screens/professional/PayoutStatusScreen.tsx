import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue, useAnimatedStyle,
  withTiming, withDelay, Easing,
} from "react-native-reanimated";
import { ScrollView, StatusBar, TextInput, TouchableOpacity, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Booking, ProviderBankAccount, bookingsApi, userApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvCard, MvRefreshControl, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { AnimatedNumber } from "../../components/polish/AnimatedNumber";
import { AnimatedBar } from "../../components/professional/HomeWidgets";
import { formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "PayoutStatus">;
type RevenueMonth = { key: string; label: string; gross: number };

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(date: Date) {
  return date.toLocaleDateString("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" }).replace(".", "");
}

const MONTHLY_GOAL_KEY = "@muvify:provider_monthly_goal";

// ─── SVG Line Chart ─────────────────────────────────────────────────────────
function buildLinePath(values: number[], w: number, h: number, padding = 12): string {
  if (values.length === 0) return "";
  // Com apenas 1 ponto, duplica para gerar uma linha horizontal
  const normalized = values.length === 1 ? [values[0], values[0]] : values;
  const max = Math.max(...normalized, 1);
  const pts = normalized.map((v, i) => ({
    x: padding + (i / (normalized.length - 1)) * (w - padding * 2),
    y: padding + (1 - v / max) * (h - padding * 2),
  }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const cpx = (pts[i - 1].x + pts[i].x) / 2;
    d += ` C ${cpx} ${pts[i - 1].y}, ${cpx} ${pts[i].y}, ${pts[i].x} ${pts[i].y}`;
  }
  return d;
}

function buildAreaPath(values: number[], w: number, h: number, padding = 12): string {
  const line = buildLinePath(values, w, h, padding);
  if (!line) return "";
  const lastX = padding + (w - padding * 2);
  const firstX = padding;
  return `${line} L ${lastX} ${h} L ${firstX} ${h} Z`;
}

function LineChart({
  data,
  green,
  width = 300,
  height = 110,
}: {
  data: RevenueMonth[];
  green: string;
  width?: number;
  height?: number;
}) {
  const values = data.map((d) => d.gross);
  const max = Math.max(...values, 1);
  const padding = 12;
  const linePath = buildLinePath(values, width, height, padding);
  const areaPath = buildAreaPath(values, width, height, padding);

  const pts = values.map((v, i) => ({
    x: padding + (i / (values.length - 1)) * (width - padding * 2),
    y: padding + (1 - v / max) * (height - padding * 2),
    v,
  }));

  const areaFill = green.startsWith("#")
    ? green + "28"
    : "rgba(34,197,94,0.16)";

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {areaPath ? <Path d={areaPath} fill={areaFill} /> : null}
      {linePath ? (
        <Path d={linePath} stroke={green} strokeWidth={2} fill="none" strokeLinejoin="round" />
      ) : null}
      {pts.map((pt, i) => (
        <Circle key={i} cx={pt.x} cy={pt.y} r={3.5} fill={green} />
      ))}
    </Svg>
  );
}

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
  green,
  cardBg,
  border,
  text1,
  highlight = false,
}: {
  label: string;
  value: string;
  green: string;
  cardBg: string;
  border: string;
  text1: string;
  highlight?: boolean;
}) {
  return (
    <View style={{ flex: 1, borderRadius: 16, padding: 14, borderWidth: 1, backgroundColor: cardBg, borderColor: border }}>
      <MvText variant="semi2" style={{ color: highlight ? green : text1, fontSize: 15 }} numberOfLines={1}>
        {value}
      </MvText>
      <MvText variant="body4" color="secondary" style={{ marginTop: 3 }} numberOfLines={1}>
        {label}
      </MvText>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export function PayoutStatusScreen({ navigation }: Props) {
  const { runWithAuth, showToast, user } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const isLight = theme.mode === "light";

  const [account, setAccount] = useState<ProviderBankAccount | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [firstPaymentBannerVisible, setFirstPaymentBannerVisible] = useState(false);
  const [monthlyGoal, setMonthlyGoal] = useState(0);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const chartContainerRef = useRef<View>(null);
  const [chartWidth, setChartWidth] = useState(300);

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

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [accountResponse, bookingsResponse] = await Promise.all([
        runWithAuth((token) => userApi.providerBankAccount(token)).catch(() => null),
        runWithAuth((token) => bookingsApi.me(token)),
      ]);
      setAccount(accountResponse);
      setBookings(bookingsResponse);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao consultar status financeiro.",
        navigation,
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await load();
    setRefreshing(false);
  }, [load]);

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
  const estimatedNet = estimatedGross * 0.9;
  const commission = estimatedGross * 0.1;

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

  useEffect(() => {
    AsyncStorage.getItem(MONTHLY_GOAL_KEY).then((val) => {
      if (val) setMonthlyGoal(Number(val));
    }).catch(() => {});
  }, []);

  // ── Cores ─────────────────────────────────────────────────────────────────
  const bg = theme.bg;
  const cardBg = theme.cardBg;
  const border = theme.border;
  const green = theme.textGreen;
  const text1 = theme.text1;
  const text2 = theme.text2;
  const text3 = theme.text3;
  const heroBg = isLight ? "rgba(34,197,94,0.05)" : "#0F1A12";
  const heroBorder = isLight ? "rgba(34,197,94,0.18)" : "rgba(34,197,94,0.18)";
  const barBg = isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)";

  return (
    <View style={{ flex: 1, backgroundColor: bg }} testID="screen.professional.finance">
      <StatusBar barStyle={isLight ? "dark-content" : "light-content"} backgroundColor={bg} />

      {/* ── Header ── */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={text2} />
        </TouchableOpacity>
        <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 24, color: theme.text1, letterSpacing: -0.3, flex: 1 }}>Financeiro</MvText>
        {loading ? (
          <MvText variant="body4" color="secondary">Atualizando...</MvText>
        ) : null}
      </View>

      <ScreenEntrance>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, gap: 14 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <MvRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        {/* ── BANNER PRIMEIRO PAGAMENTO (exibido uma única vez) ── */}
        {firstPaymentBannerVisible ? (
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 10,
            borderRadius: 14, padding: 14,
            backgroundColor: "rgba(34,197,94,0.10)",
            borderWidth: 1, borderColor: "rgba(34,197,94,0.25)",
          }}>
            <Ionicons name="star-outline" size={20} color={green} />
            <View style={{ flex: 1 }}>
              <MvText variant="semi3" style={{ color: green }}>Seu primeiro pagamento está chegando!</MvText>
              <MvText variant="body4" color="secondary">Continue confirmando suas sessões para liberar o saldo.</MvText>
            </View>
          </View>
        ) : null}

        {/* ── CTA CONTA MP (quando conta não configurada) ── */}
        {!account ? (
          <TouchableOpacity
            onPress={() => navigation.navigate("ConnectPayoutAccount")}
            style={{
              flexDirection: "row", alignItems: "center", gap: 10,
              borderRadius: 14, padding: 14,
              backgroundColor: "rgba(245,158,11,0.08)",
              borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
            }}
          >
            <Ionicons name="alert-circle-outline" size={20} color="#F59E0B" />
            <View style={{ flex: 1 }}>
              <MvText variant="semi3" style={{ color: "#F59E0B" }}>Conecte sua conta para receber</MvText>
              <MvText variant="body4" color="secondary">Cadastre sua conta bancária para liberar saques do seu saldo.</MvText>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#F59E0B" />
          </TouchableOpacity>
        ) : null}

        {/* ── CARD PRINCIPAL — ESTIMATIVA LÍQUIDA ── */}
        <View style={{ borderRadius: 16, padding: 20, borderWidth: 1, backgroundColor: heroBg, borderColor: heroBorder }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <MvText variant="caption" color="secondary">ESTIMATIVA LÍQUIDA</MvText>
                <View style={{
                  paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
                  backgroundColor: "rgba(161,161,170,0.12)",
                }}>
                  <MvText style={{ fontSize: 9, color: text3, fontFamily: "DMSans_500Medium" }}>
                    sessões concluídas
                  </MvText>
                </View>
              </View>
              <AnimatedNumber
                value={estimatedNet}
                format={formatCurrencyBRL}
                style={{
                  fontFamily: "PlusJakartaSans_800ExtraBold",
                  fontSize: 38,
                  letterSpacing: -0.6,
                  color: theme.primary,
                  marginTop: 4,
                  lineHeight: 46,
                }}
              />
              <View style={{ marginTop: 8, gap: 3 }}>
                <MvText variant="body4" color="secondary">
                  Bruto: {formatCurrencyBRL(estimatedGross)}
                </MvText>
                <MvText variant="body4" color="secondary">
                  Comissão app (10%): -{formatCurrencyBRL(commission)}
                </MvText>
              </View>
            </View>
            <View style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: "rgba(34,197,94,0.12)",
              borderWidth: 1, borderColor: "rgba(34,197,94,0.22)",
              alignItems: "center", justifyContent: "center",
              marginTop: 4,
            }}>
              <Ionicons name="wallet-outline" size={20} color={green} />
            </View>
          </View>

          <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
            <MvBadge
              label={account ? "Conta ativa" : "Conta pendente"}
              variant={account ? "green" : "orange"}
            />
            <MvBadge label="Últimos 6 meses" variant="gray" />
          </View>
        </View>

        {/* ── CONTROLE FINANCEIRO PESSOAL ── */}
        <PressableScale
          onPress={() => navigation.navigate("PersonalFinance")}
          scale={0.97}
          style={{
            flexDirection: "row", alignItems: "center", gap: 14,
            borderRadius: 16, borderWidth: 1.5,
            borderColor: "rgba(34,197,94,0.35)",
            backgroundColor: "rgba(34,197,94,0.07)",
            padding: 16,
          }}
        >
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: "rgba(34,197,94,0.18)", borderWidth: 1, borderColor: "rgba(34,197,94,0.30)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="stats-chart" size={24} color={green} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <MvText variant="semi1" style={{ color: green }}>Controle Financeiro</MvText>
            <MvText variant="body3" color="secondary">Alunos, receitas, despesas e metas</MvText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={green} />
        </PressableScale>

        {/* ── META MENSAL ── */}
        <View style={{ borderRadius: 14, padding: 14, borderWidth: 1, backgroundColor: cardBg, borderColor: border, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <MvText variant="semi3">Meta mensal</MvText>
            {!editingGoal ? (
              <TouchableOpacity onPress={() => { setGoalInput(monthlyGoal > 0 ? String(monthlyGoal) : ""); setEditingGoal(true); }}>
                <MvText variant="body4" style={{ color: green, fontSize: 12 }}>
                  {monthlyGoal > 0 ? "Editar" : "+ Definir"}
                </MvText>
              </TouchableOpacity>
            ) : null}
          </View>
          {editingGoal ? (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput
                value={goalInput}
                onChangeText={setGoalInput}
                keyboardType="numeric"
                placeholder="Ex: 5000"
                placeholderTextColor={text3}
                style={{ flex: 1, borderWidth: 1, borderColor: border, borderRadius: 8, backgroundColor: isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.06)", paddingHorizontal: 10, paddingVertical: 7, color: text1, fontSize: 14 }}
              />
              <TouchableOpacity
                onPress={() => {
                  const v = Number(goalInput.replace(",", "."));
                  if (!isNaN(v) && v > 0) {
                    void AsyncStorage.setItem(MONTHLY_GOAL_KEY, String(v));
                    setMonthlyGoal(v);
                  } else {
                    void AsyncStorage.removeItem(MONTHLY_GOAL_KEY);
                    setMonthlyGoal(0);
                  }
                  setEditingGoal(false);
                }}
                style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: green }}
              >
                <MvText style={{ color: "#fff", fontFamily: "DMSans_700Bold", fontSize: 13 }}>Salvar</MvText>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditingGoal(false)}>
                <Ionicons name="close-outline" size={18} color={text3} />
              </TouchableOpacity>
            </View>
          ) : null}
          {monthlyGoal > 0 && !editingGoal ? (
            <>
              <View style={{ height: 6, borderRadius: 99, backgroundColor: `${green}28`, overflow: "hidden" }}>
                <View
                  style={{
                    height: 6,
                    borderRadius: 99,
                    backgroundColor: green,
                    width: `${Math.min(100, Math.round((currentMonthGross / monthlyGoal) * 100))}%`,
                  }}
                />
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>
                  {Math.round((currentMonthGross / monthlyGoal) * 100)}% atingido
                </MvText>
                <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>
                  {formatCurrencyBRL(currentMonthGross)} / {formatCurrencyBRL(monthlyGoal)}
                </MvText>
              </View>
            </>
          ) : null}
          {monthlyGoal === 0 && !editingGoal ? (
            <MvText variant="body4" color="secondary" style={{ fontSize: 12 }}>
              Defina uma meta para acompanhar seu progresso mensal.
            </MvText>
          ) : null}
        </View>

        {/* ── GRID DE MÉTRICAS 2 linhas × 3 ── */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <MetricCard label="Alunos únicos" value={String(uniqueStudents)} green={green} cardBg={cardBg} border={border} text1={text1} />
            <MetricCard label="Sessões concluídas" value={String(completedCount)} green={green} cardBg={cardBg} border={border} text1={text1} />
            <MetricCard label="Pendentes" value={String(pendingCount)} green={green} cardBg={cardBg} border={border} text1={text1} highlight={pendingCount > 0} />
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <MetricCard label="Este mês" value={formatCurrencyBRL(currentMonthGross)} green={green} cardBg={cardBg} border={border} text1={text1} highlight />
            <MetricCard label="Bruto total" value={formatCurrencyBRL(estimatedGross)} green={green} cardBg={cardBg} border={border} text1={text1} />
            <MetricCard label="Líquido total" value={formatCurrencyBRL(estimatedNet)} green={green} cardBg={cardBg} border={border} text1={text1} highlight />
          </View>
        </View>

        {/* ── GRÁFICO COMPARATIVO MENSAL ── */}
        <View style={{ borderRadius: 16, padding: 18, borderWidth: 1, backgroundColor: cardBg, borderColor: border }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <MvText variant="semi2">Comparativo mensal</MvText>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: "rgba(34,197,94,0.10)", borderWidth: 1, borderColor: "rgba(34,197,94,0.20)" }}>
              <MvText variant="body4" style={{ color: green, fontSize: 11 }}>Últimos 6 meses</MvText>
            </View>
          </View>

          {hasRevenue ? (
            <Animated.View style={[{ width: "100%", paddingHorizontal: 4 }, chartAnimStyle]}>
              <MonthlyBarChart data={revenueByMonth} primaryColor={green} barBg={barBg} />
            </Animated.View>
          ) : (
            <View style={{ paddingVertical: 28, alignItems: "center", gap: 8 }}>
              <Ionicons name="bar-chart-outline" size={28} color={text3} />
              <MvText variant="body4" color="secondary">Nenhuma receita registrada ainda</MvText>
              <MvText variant="body4" color="secondary" style={{ textAlign: "center", fontSize: 12 }}>
                Quando suas sessões forem concluídas, seus ganhos aparecerão aqui.
              </MvText>
            </View>
          )}
        </View>

        {/* ── CONTA BANCÁRIA ── */}
        <View style={{ borderRadius: 16, borderWidth: 1, backgroundColor: cardBg, borderColor: border, overflow: "hidden" }}>
          <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: account ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.10)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="card-outline" size={18} color={account ? green : "#F59E0B"} />
              </View>
              <View>
                <MvText variant="semi3">Conta de recebimento</MvText>
                <MvText variant="body4" color="secondary" numberOfLines={1} style={{ maxWidth: 200 }}>
                  {account
                    ? `${account.bankName} · ag ${account.agency} · cc ${account.accountNumber}-${account.accountDigit}`
                    : "Cadastre sua conta para receber repasses"}
                </MvText>
              </View>
            </View>
            <MvBadge label={account ? "Configurada" : "Pendente"} variant={account ? "green" : "orange"} />
          </View>

          {/* CTA */}
          <TouchableOpacity
            onPress={() => navigation.navigate("ConnectPayoutAccount")}
            style={{
              marginHorizontal: 16,
              marginBottom: 16,
              paddingVertical: 13,
              borderRadius: 12,
              backgroundColor: account ? "transparent" : green,
              borderWidth: account ? 1 : 0,
              borderColor: border,
              alignItems: "center",
            }}
          >
            <MvText variant="semi3" style={{ color: account ? text2 : "#fff" }}>
              {account ? "Gerenciar conta bancária" : "Cadastrar conta bancária"}
            </MvText>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </ScreenEntrance>

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
