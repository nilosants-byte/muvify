import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle, Line as SvgLine, Path, Text as SvgText } from "react-native-svg";
import { useGooglePlacesSearch } from "../../hooks/useGooglePlacesSearch";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import {
  FinancialAppClient,
  FinancialDashboard,
  FinancialExpense,
  FinancialExpenseCategory,
  FinancialGoal,
  FinancialIncome,
  FinancialReport,
  FinancialStudent,
  FinancialStudentType,
  WeeklyScheduleSlot,
  financialApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { formatCurrencyBRL, maskPriceInput } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "PersonalFinance">;
type Tab = "alunos" | "receitas" | "despesas" | "metas";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "alunos",   label: "Alunos",   icon: "people-outline" },
  { key: "receitas", label: "Receitas", icon: "arrow-up-circle-outline" },
  { key: "despesas", label: "Despesas", icon: "arrow-down-circle-outline" },
  { key: "metas",    label: "Metas",    icon: "flag-outline" },
];

function parseCentsFromInput(v: string) {
  return Number(v.replace(/\D/g, ""));
}
function fmtCents(cents: number) {
  return formatCurrencyBRL(cents / 100);
}
function fmtCentsShort(cents: number): string {
  const v = cents / 100;
  if (v >= 1000) return `R$${(v / 1000).toFixed(1)}k`;
  return `R$${Math.round(v)}`;
}
function currentMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(m: string) {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("pt-BR", {
    month: "long", year: "numeric",
  });
}

type MvThemeValue = ReturnType<typeof import("../../theme/MvThemeContext").useMvTheme>["theme"];

// Chart types & helpers
type ChartFilter = "geral" | "app" | "fora-app" | "lucro" | "despesas";
type ChartPeriod = "d" | "s" | "m" | "a";
interface SparkPoint { label: string; app: number; offApp: number; expenses: number; net: number; }

function daysInMonthFn(year: number, month: number): number { return new Date(year, month, 0).getDate(); }
function getWeekDatesFn(year: number, month: number, weekNum: number): string[] {
  const dim = daysInMonthFn(year, month);
  const start = (weekNum - 1) * 7 + 1;
  const end   = Math.min(start + 6, dim);
  return Array.from({ length: end - start + 1 }, (_, i) => {
    const d = start + i;
    return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  });
}
function getMonthAbbr(m: string): string {
  const mo = Number(m.split("-")[1]);
  return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][mo - 1] ?? "";
}
const FILTER_OPTS: { key: ChartFilter; label: string }[] = [
  { key: "geral",    label: "Geral"    },
  { key: "app",      label: "Pelo App" },
  { key: "fora-app", label: "Fora App" },
  { key: "lucro",    label: "Lucro"    },
  { key: "despesas", label: "Despesas" },
];

// Stat card with colored top border
function StatCard({ label, value, color, theme }: {
  label: string; value: string; color: string; theme: MvThemeValue;
}) {
  return (
    <View style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgSurface, overflow: "hidden" }}>
      <View style={{ height: 3, backgroundColor: color }} />
      <View style={{ padding: 8 }}>
        <MvText variant="body4" color="secondary" style={{ fontSize: 8.5, marginBottom: 2 }}>{label}</MvText>
        <MvText variant="semi3" style={{ color, fontSize: 12, letterSpacing: -0.3 }}>{value}</MvText>
      </View>
    </View>
  );
}

// Donut chart (SVG)
// Verde = ganhos pelo app (alunos gerenciados no app)
// Azul  = ganhos fora do app (receitas manuais)
// Vermelho = despesas
const D_SIZE = 92;
const D_R = 34;
const D_CX = 46;
const D_CY = 46;
const D_SW = 9;
const D_C = 2 * Math.PI * D_R; // ~213.6
const D_GAP = 5; // px de espaco visual entre segmentos

function DonutChart({ app, offApp, expenses, filter, isDark }: {
  app: number; offApp: number; expenses: number;
  filter: ChartFilter; isDark: boolean;
}) {
  const green  = isDark ? "#00C853" : "#16A34A";
  const blue   = isDark ? "#38BDF8" : "#0284C7";
  const red    = isDark ? "#F87171" : "#E53935";
  const track  = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
  const tSub   = isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.38)";

  const profit = Math.max(0, app + offApp - expenses);
  const [centerVal, centerLabel, centerColor] = ((): [number, string, string] => {
    switch (filter) {
      case "app":      return [app,      "pelo app",    green];
      case "fora-app": return [offApp,   "fora app",    blue];
      case "lucro":    return [profit,   "lucro",       profit >= 0 ? green : red];
      case "despesas": return [expenses, "despesas",    red];
      default:         return [app + offApp, "faturamento", green];
    }
  })();

  function seg(stroke: string, arc: number, offset: number) {
    if (arc <= 0) return null;
    return (
      <Circle cx={D_CX} cy={D_CY} r={D_R} fill="none"
        stroke={stroke} strokeWidth={D_SW} strokeLinecap="butt"
        strokeDasharray={[arc, D_C - arc]}
        strokeDashoffset={D_C - offset}
        transform={`rotate(-90, ${D_CX}, ${D_CY})`}
      />
    );
  }
  function fullCircle(stroke: string) {
    return <Circle cx={D_CX} cy={D_CY} r={D_R} fill="none"
      stroke={stroke} strokeWidth={D_SW}
      transform={`rotate(-90, ${D_CX}, ${D_CY})`}
    />;
  }

  let segments: React.ReactNode = null;
  const total3 = app + offApp + expenses;

  if (filter === "app")      { segments = fullCircle(green); }
  else if (filter === "fora-app") { segments = fullCircle(blue); }
  else if (filter === "despesas") { segments = fullCircle(red); }
  else if (filter === "lucro") {
    const t2 = profit + expenses;
    if (t2 > 0) {
      const USABLE = D_C - 2 * D_GAP;
      const aP = (profit / t2) * USABLE;
      const aE = (expenses / t2) * USABLE;
      segments = <>{seg(green, aP, 0)}{seg(red, aE, aP + D_GAP)}</>;
    }
  } else if (total3 > 0) {
    // geral: 3 segmentos com espacos
    const USABLE = D_C - 3 * D_GAP;
    const aApp = (app      / total3) * USABLE;
    const aOff = (offApp   / total3) * USABLE;
    const aExp = (expenses / total3) * USABLE;
    segments = (
      <>
        {seg(green, aApp, 0)}
        {seg(blue,  aOff, aApp + D_GAP)}
        {seg(red,   aExp, aApp + D_GAP + aOff + D_GAP)}
      </>
    );
  }

  return (
    <Svg width={D_SIZE} height={D_SIZE} viewBox={`0 0 ${D_SIZE} ${D_SIZE}`}>
      <Circle cx={D_CX} cy={D_CY} r={D_R} fill="none" stroke={track} strokeWidth={D_SW} />
      {segments}
      <SvgText x={D_CX} y={D_CY - 4} textAnchor="middle" fill={centerColor}
        fontSize={9.5} fontWeight="700" fontFamily="DMSans-Bold">
        {fmtCentsShort(centerVal)}
      </SvgText>
      <SvgText x={D_CX} y={D_CY + 9} textAnchor="middle" fill={tSub}
        fontSize={6.5} fontFamily="DMSans-Regular">
        {centerLabel}
      </SvgText>
    </Svg>
  );
}

// Multi-line sparkline (SVG)
const SPARK_H = 62;

function curvePath(vals: number[], maxV: number, W: number, H: number): string {
  if (vals.length < 2) return "";
  const step = W / (vals.length - 1);
  const pts = vals.map((v, i) => ({
    x: i * step,
    y: H - Math.max(4, (maxV > 0 ? v / maxV : 0) * (H - 8) + 4),
  }));
  return pts.map((p, i) => {
    if (i === 0) return `M ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    const prev = pts[i - 1];
    const cpx  = ((prev.x + p.x) / 2).toFixed(1);
    return `C ${cpx},${prev.y.toFixed(1)} ${cpx},${p.y.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");
}
function areaPath(vals: number[], maxV: number, W: number, H: number): string {
  const line = curvePath(vals, maxV, W, H);
  if (!line) return "";
  const lastX = (W).toFixed(1);
  return `${line} L ${lastX},${H} L 0,${H} Z`;
}

function SparklineChart({ points, chartWidth, isDark, filter, highlightIdx }: {
  points: SparkPoint[]; chartWidth: number; isDark: boolean;
  filter: ChartFilter; highlightIdx?: number;
}) {
  const green  = isDark ? "#00C853" : "#16A34A";
  const blue   = isDark ? "#38BDF8" : "#0284C7";
  const profitColor = isDark ? "#FACC15" : "#CA8A04";
  const red    = isDark ? "#F87171" : "#E53935";
  const grid   = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
  const hiLine = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.10)";

  if (points.length < 2 || chartWidth <= 0) return <View style={{ height: SPARK_H }} />;

  const W = chartWidth;
  const H = SPARK_H;

  // Total revenue per point = app + offApp (historico usa revenueCents total)
  const greenVals = points.map(p => p.app + p.offApp);
  const blueVals  = points.map(p => Math.max(0, p.net));
  const redVals   = points.map(p => p.expenses);
  const maxV = Math.max(...greenVals, ...redVals, 1);

  const ptX = (i: number) => (i * W / (points.length - 1));
  const ptY = (v: number) => H - Math.max(4, (v / maxV) * (H - 8) + 4);

  const showGreen = filter === "geral" || filter === "app"  || filter === "fora-app";
  const showProfit  = filter === "geral" || filter === "lucro";
  const showRed   = filter === "geral" || filter === "despesas";
  const dimGreen  = filter !== "geral" && filter !== "app"  && filter !== "fora-app";
  const dimProfit = filter !== "geral" && filter !== "lucro";
  const dimRed    = filter !== "geral" && filter !== "despesas";

  const gPath = curvePath(greenVals, maxV, W, H);
  const bPath = curvePath(blueVals,  maxV, W, H);
  const rPath = curvePath(redVals,   maxV, W, H);
  const gArea = areaPath(greenVals,  maxV, W, H);

  const last = points.length - 1;

  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map(r => (
        <SvgLine key={r} x1={0} y1={(H * (1 - r)).toFixed(1)} x2={W} y2={(H * (1 - r)).toFixed(1)}
          stroke={grid} strokeWidth={0.5} strokeDasharray="3 5" />
      ))}

      {/* Area fill under revenue line */}
      {showGreen && <Path d={gArea} fill={isDark ? "rgba(0,200,83,0.08)" : "rgba(22,163,74,0.06)"} />}

      {/* Profit (dashed) */}
      {showProfit && <Path d={bPath} fill="none" stroke={profitColor}
        strokeWidth={dimProfit ? 1.2 : 1.7} strokeLinecap="round" strokeDasharray="4 3"
        opacity={dimProfit ? 0.3 : 0.9} />}

      {/* Red expenses */}
      {showRed && <Path d={rPath} fill="none" stroke={red}
        strokeWidth={dimRed ? 1.2 : 1.7} strokeLinecap="round"
        opacity={dimRed ? 0.3 : 1} />}

      {/* Green revenue (on top) */}
      {showGreen && <Path d={gPath} fill="none" stroke={green}
        strokeWidth={dimGreen ? 1.2 : 2} strokeLinecap="round"
        opacity={dimGreen ? 0.3 : 1} />}

      {/* Dots at last data point */}
      {showGreen && <Circle cx={ptX(last)} cy={ptY(greenVals[last])} r={3.5} fill={green} opacity={dimGreen ? 0.3 : 1} />}
      {showRed   && <Circle cx={ptX(last)} cy={ptY(redVals[last])}   r={2.5} fill={red}   opacity={dimRed ? 0.3 : 1} />}
      {showProfit  && <Circle cx={ptX(last)} cy={ptY(blueVals[last])}  r={2}   fill={profitColor}  opacity={dimProfit ? 0.3 : 1} />}

      {/* Period highlight (D/S) */}
      {highlightIdx !== undefined && highlightIdx >= 0 && highlightIdx < points.length && (
        <>
          <SvgLine x1={ptX(highlightIdx).toFixed(1)} y1={0} x2={ptX(highlightIdx).toFixed(1)} y2={H}
            stroke={hiLine} strokeWidth={1} strokeDasharray="3 3" />
          {showGreen && <Circle cx={ptX(highlightIdx)} cy={ptY(greenVals[highlightIdx])} r={4.5} fill={green} />}
        </>
      )}
    </Svg>
  );
}

// Radar chart section (periodo + filtro + donut + sparkline)
function RadarChartSection({ app, offApp, expenses, report, dashboard, isDark, theme, month, onPrevMonth, onNextMonth }: {
  app: number; offApp: number; expenses: number;
  report: FinancialReport | null;
  dashboard: FinancialDashboard | null;
  isDark: boolean; theme: MvThemeValue;
  month: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const [filter,     setFilter]     = useState<ChartFilter>("geral");
  const [period,     setPeriod]     = useState<ChartPeriod>("m");
  const [sparkWidth, setSparkWidth] = useState(0);

  const [y, mo] = month.split("-").map(Number);
  const dim = daysInMonthFn(y, mo);
  const today = new Date();
  const isCurMonth = y === today.getFullYear() && mo === today.getMonth() + 1;
  const defDay  = isCurMonth ? today.getDate() : dim;

  const [dayNum,  setDayNum]  = useState(defDay);
  const [weekNum, setWeekNum] = useState(Math.ceil(defDay / 7));

  // Reset quando mes muda
  useEffect(() => {
    const [ny, nm] = month.split("-").map(Number);
    const ndim = daysInMonthFn(ny, nm);
    const nisCur = ny === today.getFullYear() && nm === today.getMonth() + 1;
    const nDef = nisCur ? today.getDate() : ndim;
    setDayNum(nDef);
    setWeekNum(Math.ceil(nDef / 7));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const dailyRevenue = dashboard?.dailyRevenue ?? {};
  const green = isDark ? "#00C853" : "#16A34A";
  const blue  = isDark ? "#38BDF8" : "#0284C7";
  const profitColor = isDark ? "#FACC15" : "#CA8A04";
  const red   = isDark ? "#F87171" : "#E53935";

  // Dados do donut por periodo
  const donutApp = period === "m" ? app
    : period === "a" ? app
    : period === "d" ? Math.round(app / dim)
    : Math.round(app / Math.max(1, dim / 7));

  const donutOffApp = (() => {
    if (period === "m") return offApp;
    if (period === "a") {
      return (report?.months.filter(m2 => m2.month.startsWith(String(y))) ?? [])
        .reduce((s, m2) => s + m2.revenueCents, 0);
    }
    if (period === "d") {
      const dateStr = `${y}-${String(mo).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      return dailyRevenue[dateStr] ?? 0;
    }
    return getWeekDatesFn(y, mo, weekNum).reduce((s, d) => s + (dailyRevenue[d] ?? 0), 0);
  })();

  const donutExp = period === "m" ? expenses
    : period === "a"
      ? (report?.months.filter(m2 => m2.month.startsWith(String(y))) ?? []).reduce((s, m2) => s + m2.expensesCents, 0)
    : period === "d" ? Math.round(expenses / dim)
    : Math.round(expenses / Math.max(1, dim / 7));
  const donutProfit = donutApp + donutOffApp - donutExp;

  // Pontos do sparkline por periodo
  const sparkPoints: SparkPoint[] = (() => {
    if (period === "m" || period === "a") {
      const mths = period === "a"
        ? (report?.months.filter(m2 => m2.month.startsWith(String(y))) ?? [])
        : (report?.months.slice(-6) ?? []);
      const total = app + offApp;
      return mths.map(m2 => ({
        label:    getMonthAbbr(m2.month),
        app:      total > 0 ? Math.round(m2.revenueCents * (app / total)) : 0,
        offApp:   total > 0 ? Math.round(m2.revenueCents * (offApp / total)) : m2.revenueCents,
        expenses: m2.expensesCents,
        net:      m2.netCents,
      }));
    }
    if (period === "d") {
      return Array.from({ length: dim }, (_, i) => {
        const d       = i + 1;
        const dateStr = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const rev     = dailyRevenue[dateStr] ?? 0;
        return { label: String(d), app: 0, offApp: rev, expenses: 0, net: rev };
      });
    }
    // semana
    return getWeekDatesFn(y, mo, weekNum).map(dateStr => {
      const rev = dailyRevenue[dateStr] ?? 0;
      const [,,dd] = dateStr.split("-");
      return { label: dd ?? "", app: 0, offApp: rev, expenses: 0, net: rev };
    });
  })();

  const highlightIdx = period === "d" ? dayNum - 1
    : period === "s" ? sparkPoints.length - 1 : undefined;

  // Label de navega??o
  const navLabel = (() => {
    if (period === "a") return String(y);
    if (period === "d") return `${String(dayNum).padStart(2, "0")} ${getMonthAbbr(month)}`;
    if (period === "s") {
      const dates = getWeekDatesFn(y, mo, weekNum);
      return `${dates[0]?.slice(8) ?? "1"}-${dates[dates.length - 1]?.slice(8) ?? "7"} ${getMonthAbbr(month)}`;
    }
    return monthLabel(month);
  })();

  const maxWeek = Math.ceil(dim / 7);

  function handlePrev() {
    if (period === "m") { onPrevMonth(); return; }
    if (period === "a") return;
    if (period === "d") {
      if (dayNum > 1) setDayNum(n => n - 1); else { onPrevMonth(); setDayNum(dim); }
    }
    if (period === "s") {
      if (weekNum > 1) setWeekNum(n => n - 1); else { onPrevMonth(); setWeekNum(maxWeek); }
    }
  }
  function handleNext() {
    if (period === "m") { onNextMonth(); return; }
    if (period === "a") return;
    if (period === "d") {
      if (dayNum < dim) setDayNum(n => n + 1); else { onNextMonth(); setDayNum(1); }
    }
    if (period === "s") {
      if (weekNum < maxWeek) setWeekNum(n => n + 1); else { onNextMonth(); setWeekNum(1); }
    }
  }

  // X-axis labels reduzidos (max 4 pontos visiveis)
  const xLabels = sparkPoints.length <= 7
    ? sparkPoints
    : [0, Math.floor(sparkPoints.length / 3), Math.floor((2 * sparkPoints.length) / 3), sparkPoints.length - 1]
        .map(i => sparkPoints[i]);

  // Legend rows com valores reais do periodo selecionado
  const legendRows = [
    { color: green, label: "Pelo app",  value: donutApp,    key: "app"      as ChartFilter },
    { color: blue,  label: "Fora app",  value: donutOffApp, key: "fora-app" as ChartFilter },
    { color: profitColor,  label: "Lucro",  value: donutProfit, key: "lucro" as ChartFilter },
    { color: red,   label: "Despesas",  value: donutExp,    key: "despesas" as ChartFilter },
  ];

  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
      {/* Periodo + navegacao */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {period !== "a" && (
            <TouchableOpacity onPress={handlePrev} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={16} color={theme.text3} />
            </TouchableOpacity>
          )}
          <MvText variant="semi3" style={{ fontSize: 12, minWidth: 80, textAlign: "center" }}>{navLabel}</MvText>
          {period !== "a" && (
            <TouchableOpacity onPress={handleNext} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-forward" size={16} color={theme.text3} />
            </TouchableOpacity>
          )}
        </View>
        {/* Pills D/S/M/A */}
        <View style={{ flexDirection: "row", gap: 2, backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)", borderRadius: 10, padding: 2 }}>
          {(["d","s","m","a"] as ChartPeriod[]).map(p => {
            const sel = period === p;
            return (
              <TouchableOpacity key={p} onPress={() => setPeriod(p)} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: sel ? (isDark ? "#00C853" : "#16A34A") : "transparent" }}>
                <MvText variant="badge" style={{ fontSize: 10, fontWeight: sel ? "700" : "500", color: sel ? (isDark ? "#030d03" : "#fff") : theme.text3 }}>
                  {p.toUpperCase()}
                </MvText>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Graficos */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        {/* Donut */}
        <DonutChart app={donutApp} offApp={donutOffApp} expenses={donutExp} filter={filter} isDark={isDark} />

        {/* Sparkline + eixo X + legenda */}
        <View style={{ flex: 1 }}>
          <View onLayout={e => setSparkWidth(e.nativeEvent.layout.width)} style={{ height: SPARK_H }}>
            {sparkWidth > 0 && sparkPoints.length >= 2 && (
              <SparklineChart points={sparkPoints} chartWidth={sparkWidth} isDark={isDark} filter={filter} highlightIdx={highlightIdx} />
            )}
          </View>
          {/* Eixo X */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2, paddingHorizontal: 1 }}>
            {xLabels.map((p, i) => (
              <MvText key={i} variant="body4" style={{ fontSize: 6.5, opacity: 0.38 }}>{p.label}</MvText>
            ))}
          </View>
          {/* Legenda clicavel - toque filtra o grafico */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            {legendRows.map(row => {
              const active = filter === "geral" || filter === row.key;
              return (
                <TouchableOpacity key={row.key} onPress={() => setFilter(f => f === row.key ? "geral" : row.key)} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: row.color, opacity: active ? 1 : 0.3 }} />
                  <MvText variant="body4" style={{ fontSize: 7.5, opacity: active ? 0.72 : 0.32 }}>
                    {row.label} {fmtCentsShort(row.value)}
                  </MvText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      {/* Filtros */}
      <View style={{ flexDirection: "row", gap: 5, marginTop: 10, flexWrap: "wrap" }}>
        {FILTER_OPTS.map(opt => {
          const sel = filter === opt.key;
          return (
            <TouchableOpacity key={opt.key} onPress={() => setFilter(f => f === opt.key ? "geral" : opt.key)} style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: sel ? (isDark ? "rgba(0,200,83,0.4)" : "rgba(22,163,74,0.3)") : theme.border, backgroundColor: sel ? (isDark ? "rgba(0,200,83,0.12)" : "rgba(22,163,74,0.09)") : "transparent" }}>
              <MvText variant="badge" style={{ fontSize: 9.5, color: sel ? (isDark ? "#00C853" : "#16A34A") : theme.text3, fontWeight: sel ? "700" : "500" }}>
                {opt.label}
              </MvText>
            </TouchableOpacity>
          );
        })}
      </View>

      {period === "d" || period === "s" ? (
        <MvText variant="body4" style={{ fontSize: 9, opacity: 0.38, marginTop: 4 }}>
          * Receitas do app estimadas com base na media mensal.
        </MvText>
      ) : null}
    </View>
  );
}

function GoalProgress({ label, current, target, formatFn, color }: {
  label: string; current: number; target: number; formatFn: (v: number) => string; color: string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
        <MvText variant="body4">{label}</MvText>
        <MvText variant="body4" style={{ color }}>
          {pct}% — {formatFn(current)} / {formatFn(target)}
        </MvText>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.08)", overflow: "hidden" }}>
        <View style={{ width: `${pct}%`, height: 8, borderRadius: 4, backgroundColor: color }} />
      </View>
    </View>
  );
}

function ModalSheet({ visible, title, onClose, children, theme, topInset }: {
  visible: boolean; title: string; onClose: () => void;
  children: React.ReactNode; theme: MvThemeValue; topInset: number;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: topInset + 16, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 10 }}>
            <TouchableOpacity
              onPress={onClose}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="close" size={18} color={theme.text1} />
            </TouchableOpacity>
            <MvText variant="semi2">{title}</MvText>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Schedule helpers
const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const GRN = "#22C55E";

function normalizeTimeInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}
function timeToMinutes(value: string) {
  if (!isValidTime(value)) return -1;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
function sortSchedule(schedule: WeeklyScheduleSlot[]) {
  return [...schedule].sort((a, b) => {
    const ai = WEEK_ORDER.indexOf(a.dayOfWeek as (typeof WEEK_ORDER)[number]);
    const bi = WEEK_ORDER.indexOf(b.dayOfWeek as (typeof WEEK_ORDER)[number]);
    return ai - bi;
  });
}
function groupScheduleByTime(schedule?: WeeklyScheduleSlot[] | null) {
  const groups = new Map<string, number[]>();
  const sorted = sortSchedule((schedule ?? []).filter(s => isValidTime(s.startTime) && isValidTime(s.endTime)));
  sorted.forEach(slot => {
    const key = `${slot.startTime}-${slot.endTime}`;
    groups.set(key, [...(groups.get(key) ?? []), slot.dayOfWeek]);
  });
  return Array.from(groups.entries()).map(([timeRange, days]) => ({
    key: `${timeRange}-${days.join("-")}`,
    label: `${sortSchedule(days.map(day => ({ dayOfWeek: day, startTime: "00:00", endTime: "00:01" }))).map(s => DAY_LABELS[s.dayOfWeek]).join(", ")} - ${timeRange}`
  }));
}

function WeeklyScheduleCalendarPicker({ schedule, onChange, theme }: {
  schedule: WeeklyScheduleSlot[]; onChange: (s: WeeklyScheduleSlot[]) => void; theme: MvThemeValue;
}) {
  const [templateStartTime, setTemplateStartTime] = useState("07:00");
  const [templateEndTime, setTemplateEndTime] = useState("08:00");
  const [replicateDays, setReplicateDays] = useState<number[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedStartTime, setSelectedStartTime] = useState("07:00");
  const [selectedEndTime, setSelectedEndTime] = useState("08:00");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (schedule.length === 0) return;
    const first = sortSchedule(schedule)[0];
    setTemplateStartTime(first.startTime);
    setTemplateEndTime(first.endTime);
  }, [schedule.length]);

  useEffect(() => {
    if (selectedDay === null) return;
    const current = schedule.find(s => s.dayOfWeek === selectedDay);
    setSelectedStartTime(current?.startTime ?? templateStartTime);
    setSelectedEndTime(current?.endTime ?? templateEndTime);
  }, [schedule, selectedDay, templateEndTime, templateStartTime]);

  function validateRange(start: string, end: string) {
    if (!isValidTime(start) || !isValidTime(end)) return "Use horário no formato HH:MM.";
    if (timeToMinutes(start) >= timeToMinutes(end)) return "Horário final deve ser maior que o inicial.";
    return null;
  }
  function toggleReplicateDay(day: number) {
    setReplicateDays(c => c.includes(day) ? c.filter(d => d !== day) : [...c, day]);
  }
  function applyTemplateToDays() {
    if (replicateDays.length === 0) { setLocalError("Selecione ao menos um dia para replicar."); return; }
    const err = validateRange(templateStartTime, templateEndTime);
    if (err) { setLocalError(err); return; }
    const next = new Map<number, WeeklyScheduleSlot>(schedule.map(s => [s.dayOfWeek, s]));
    replicateDays.forEach(day => next.set(day, { dayOfWeek: day, startTime: templateStartTime, endTime: templateEndTime }));
    onChange(sortSchedule(Array.from(next.values())));
    setLocalError(null);
    setSelectedDay(replicateDays[0] ?? null);
  }
  function saveSelectedDay() {
    if (selectedDay === null) return;
    const err = validateRange(selectedStartTime, selectedEndTime);
    if (err) { setLocalError(err); return; }
    onChange(sortSchedule([...schedule.filter(s => s.dayOfWeek !== selectedDay), { dayOfWeek: selectedDay, startTime: selectedStartTime, endTime: selectedEndTime }]));
    setLocalError(null);
  }
  function removeSelectedDay() {
    if (selectedDay === null) return;
    onChange(sortSchedule(schedule.filter(s => s.dayOfWeek !== selectedDay)));
    setSelectedDay(null);
    setLocalError(null);
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={{ padding: 10, borderWidth: 1, borderColor: theme.border, borderRadius: 12, backgroundColor: theme.bgSurface }}>
        <MvText variant="semi3">Calendário semanal de aulas</MvText>
        <MvText variant="body4" color="secondary">Toque em um dia para ajustar. Use o botao de replicar para preencher varios dias com o mesmo horario.</MvText>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {WEEK_ORDER.map(day => {
          const slot = schedule.find(s => s.dayOfWeek === day);
          const isSel = selectedDay === day;
          const has = Boolean(slot);
          return (
            <TouchableOpacity key={`cal-${day}`} onPress={() => setSelectedDay(day)} style={{ width: "31%", minWidth: 92, borderRadius: 12, borderWidth: 1, borderColor: isSel ? "rgba(34,197,94,0.55)" : has ? "rgba(34,197,94,0.25)" : theme.border, backgroundColor: isSel ? "rgba(34,197,94,0.16)" : has ? "rgba(34,197,94,0.08)" : theme.inputBg, paddingHorizontal: 8, paddingVertical: 10, alignItems: "center", gap: 2 }}>
              <MvText variant="badge" style={{ fontSize: 11, color: theme.text2 }}>{DAY_LABELS[day]}</MvText>
              <MvText variant="body4" style={{ fontSize: 11, color: has ? GRN : theme.text3, textAlign: "center" }} numberOfLines={2}>
                {slot ? `${slot.startTime} - ${slot.endTime}` : "Sem aula"}
              </MvText>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={{ gap: 8, padding: 10, borderWidth: 1, borderColor: theme.border, borderRadius: 12, backgroundColor: theme.inputBg }}>
        <MvText variant="semi3">Horário base</MvText>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TextInput value={templateStartTime} onChangeText={v => setTemplateStartTime(normalizeTimeInput(v))} placeholder="07:00" placeholderTextColor={theme.text3} keyboardType="numbers-and-punctuation" maxLength={5} style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 8, backgroundColor: theme.cardBg, paddingHorizontal: 10, paddingVertical: 8, color: theme.text2, fontSize: 14, textAlign: "center" }} />
          <MvText variant="body4" color="secondary">às</MvText>
          <TextInput value={templateEndTime} onChangeText={v => setTemplateEndTime(normalizeTimeInput(v))} placeholder="08:00" placeholderTextColor={theme.text3} keyboardType="numbers-and-punctuation" maxLength={5} style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 8, backgroundColor: theme.cardBg, paddingHorizontal: 10, paddingVertical: 8, color: theme.text2, fontSize: 14, textAlign: "center" }} />
        </View>
        <MvText variant="body4" color="secondary">Replicar horário base para dias específicos</MvText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {WEEK_ORDER.map(day => {
            const picked = replicateDays.includes(day);
            return (
              <TouchableOpacity key={`rep-${day}`} onPress={() => toggleReplicateDay(day)} style={{ borderRadius: 16, borderWidth: 1, borderColor: picked ? "rgba(34,197,94,0.45)" : theme.border, backgroundColor: picked ? "rgba(34,197,94,0.16)" : theme.chipBg, paddingHorizontal: 10, paddingVertical: 6 }}>
                <MvText variant="badge" style={{ fontSize: 11, color: picked ? GRN : theme.text2 }}>{DAY_LABELS[day]}</MvText>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity onPress={applyTemplateToDays} style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: "rgba(34,197,94,0.40)", backgroundColor: "rgba(34,197,94,0.14)", paddingVertical: 9, alignItems: "center" }}>
            <MvText variant="semi3" style={{ color: GRN }}>Replicar horário</MvText>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setReplicateDays([])} style={{ borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, paddingHorizontal: 12, justifyContent: "center" }}>
            <MvText variant="body4" color="secondary">Limpar</MvText>
          </TouchableOpacity>
        </View>
      </View>
      {selectedDay !== null ? (
        <View style={{ gap: 6, padding: 10, borderWidth: 1, borderColor: "rgba(34,197,94,0.30)", borderRadius: 12, backgroundColor: "rgba(34,197,94,0.06)" }}>
          <MvText variant="semi3">Ajuste individual — {DAY_LABELS[selectedDay]}</MvText>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TextInput value={selectedStartTime} onChangeText={v => setSelectedStartTime(normalizeTimeInput(v))} placeholder="07:00" placeholderTextColor={theme.text3} keyboardType="numbers-and-punctuation" maxLength={5} style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 8, backgroundColor: theme.inputBg, paddingHorizontal: 10, paddingVertical: 8, color: theme.text2, fontSize: 14, textAlign: "center" }} />
          <MvText variant="body4" color="secondary">às</MvText>
            <TextInput value={selectedEndTime} onChangeText={v => setSelectedEndTime(normalizeTimeInput(v))} placeholder="08:00" placeholderTextColor={theme.text3} keyboardType="numbers-and-punctuation" maxLength={5} style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 8, backgroundColor: theme.inputBg, paddingHorizontal: 10, paddingVertical: 8, color: theme.text2, fontSize: 14, textAlign: "center" }} />
            <TouchableOpacity onPress={saveSelectedDay} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: GRN, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="checkmark" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={removeSelectedDay} style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="trash-outline" size={16} color={theme.text3} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {localError ? <MvText variant="body4" style={{ color: "#d32f2f" }}>{localError}</MvText> : null}
      {schedule.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {groupScheduleByTime(schedule).map(item => (
            <View key={item.key} style={{ borderRadius: 14, borderWidth: 1, borderColor: "rgba(34,197,94,0.25)", backgroundColor: "rgba(34,197,94,0.10)", paddingHorizontal: 8, paddingVertical: 5 }}>
              <MvText variant="badge" style={{ color: GRN, fontSize: 10 }}>{item.label}</MvText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ─── Compact schedule picker ─────────────────────────────────────────────────
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
            <TouchableOpacity key={`csp-${day}`} onPress={() => toggleDay(day)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: active ? "rgba(34,197,94,0.45)" : theme.border, backgroundColor: active ? "rgba(34,197,94,0.14)" : theme.chipBg }}>
              <MvText variant="badge" style={{ fontSize: 11, color: active ? GRN : theme.text2 }}>{DAY_LABELS[day]}</MvText>
            </TouchableOpacity>
          );
        })}
      </View>
      {selectedDays.length > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput value={startTime} onChangeText={onChangeStart} placeholder="07:00" placeholderTextColor={theme.text3} keyboardType="numbers-and-punctuation" maxLength={5} style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 8, backgroundColor: theme.inputBg, paddingHorizontal: 10, paddingVertical: 7, color: theme.text2, fontSize: 13, textAlign: "center" }} />
          <MvText variant="body4" color="secondary">às</MvText>
          <TextInput value={endTime} onChangeText={onChangeEnd} placeholder="08:00" placeholderTextColor={theme.text3} keyboardType="numbers-and-punctuation" maxLength={5} style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 8, backgroundColor: theme.inputBg, paddingHorizontal: 10, paddingVertical: 7, color: theme.text2, fontSize: 13, textAlign: "center" }} />
        </View>
      ) : null}
    </View>
  );
}

// Main screen
export function ProfessionalPersonalFinanceScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>("alunos");
  const [month, setMonth] = useState(currentMonthStr());
  const [loading, setLoading] = useState(false);

  const [dashboard, setDashboard] = useState<FinancialDashboard | null>(null);
  const [students,  setStudents]  = useState<FinancialStudent[]>([]);
  const [incomes,   setIncomes]   = useState<FinancialIncome[]>([]);
  const [expenses,  setExpenses]  = useState<FinancialExpense[]>([]);
  const [goal,      setGoal]      = useState<FinancialGoal | null>(null);
  const [report,     setReport]     = useState<FinancialReport | null>(null);
  const [appClients, setAppClients] = useState<FinancialAppClient[]>([]);

  const [addStudentModal, setAddStudentModal] = useState(false);
  const [addIncomeModal,  setAddIncomeModal]  = useState(false);
  const [addExpenseModal, setAddExpenseModal] = useState(false);
  const [editGoalModal,   setEditGoalModal]   = useState(false);

  const [sName, setSName] = useState("");
  const [sValue, setSValue] = useState("100,00");
  const [sType, setSType] = useState<FinancialStudentType>("PRESENTIAL");
  const [sFreq, setSFreq] = useState("3");
  const [sSchedule, setSSchedule] = useState<WeeklyScheduleSlot[]>([]);
  const [sLocation, setSLocation] = useState("");
  const [sLocationQuery, setSLocationQuery] = useState("");
  const [sLocSuggOpen, setSLocSuggOpen] = useState(false);
  const locBlurRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [iDesc, setIDesc] = useState("");
  const [iValue, setIValue] = useState("100,00");
  const [iDate, setIDate] = useState(new Date().toISOString().slice(0, 10));

  const [eDesc, setEDesc] = useState("");
  const [eValue, setEValue] = useState("50,00");
  const [eCat, setECat] = useState<FinancialExpenseCategory>("OTHER");
  const [eDate, setEDate] = useState(new Date().toISOString().slice(0, 10));

  const [gRevenue, setGRevenue] = useState("");
  const [gStudents, setGStudents] = useState("");
  const [gClasses, setGClasses] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (sSchedule.length > 0) setSFreq(String(sSchedule.length));
  }, [sSchedule.length]);

  const { suggestions: locationSuggs, loading: locationSuggsLoading } = useGooglePlacesSearch(
    sLocationQuery, 0, 0, 50, sLocSuggOpen, ""
  );

  const studentRevenueCents = useMemo(
    () => students.filter(s => s.isActive).reduce((sum, s) => sum + s.monthlyValueCents, 0),
    [students]
  );
  const manualIncomeCents = useMemo(
    () => incomes.reduce((sum, income) => sum + income.amountCents, 0),
    [incomes]
  );
  const manualExpensesCents = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amountCents, 0),
    [expenses]
  );
  const appCompletedRevenueCents = useMemo(
    () => appClients.reduce((sum, client) => sum + client.completedCents, 0),
    [appClients]
  );
  // Verde = ganhos pelo app: agendamentos completados no app (bookings)
  // Azul  = ganhos fora do app: alunos manuais (mensalidades) + receitas manuais (aba Receitas)
  const appRevenueCents = appClients.length > 0
    ? appCompletedRevenueCents
    : (dashboard?.appRevenueCents ?? 0);
  const offAppRevenueCents = studentRevenueCents + manualIncomeCents;
  const totalExpensesCents = manualExpensesCents;
  const effectiveRevenueCents = appRevenueCents + offAppRevenueCents;
  const effectiveProfitCents  = effectiveRevenueCents - totalExpensesCents;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [dash, studs, incs, exps, gl, rep, appCl] = await Promise.all([
        runWithAuth(t => financialApi.dashboard(t, month)),
        runWithAuth(t => financialApi.listStudents(t)),
        runWithAuth(t => financialApi.listIncomes(t, month)),
        runWithAuth(t => financialApi.listExpenses(t, month)),
        runWithAuth(t => financialApi.getGoal(t, month)),
        runWithAuth(t => financialApi.report(t, 12)),
        runWithAuth(t => financialApi.listAppClients(t, month)),
      ]);
      setDashboard(dash);
      setStudents(studs);
      setIncomes(incs);
      setExpenses(exps);
      setGoal(gl);
      setReport(rep);
      setAppClients(appCl);
      if (gl) {
        setGRevenue(gl.targetRevenueCents ? maskPriceInput(String(gl.targetRevenueCents)) : "");
        setGStudents(gl.targetStudents ? String(gl.targetStudents) : "");
        setGClasses(gl.targetWeeklyClasses ? String(gl.targetWeeklyClasses) : "");
      }
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar financeiro.", navigation });
    } finally {
      setLoading(false);
    }
  }, [month, navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

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

  const hasPresential = sType === "PRESENTIAL" || sType === "BOTH";

  function resetStudentForm() {
    setSName(""); setSValue("100,00"); setSType("PRESENTIAL"); setSFreq("3");
    setSSchedule([]); setSLocation(""); setSLocationQuery(""); setSLocSuggOpen(false);
  }

  async function handleAddStudent() {
    if (!sName.trim()) { showToast("Informe o nome.", "error"); return; }
    try {
      setSaving(true);
      await runWithAuth(t => financialApi.createStudent(t, {
        name: sName.trim(),
        monthlyValueCents: parseCentsFromInput(sValue),
        type: sType,
        weeklyFrequency: sSchedule.length > 0 ? sSchedule.length : (Number(sFreq) || 3),
        location: hasPresential && sLocation.trim() ? sLocation.trim() : undefined,
        weeklySchedule: hasPresential && sSchedule.length > 0 ? sSchedule : undefined,
      }));
      setAddStudentModal(false);
      resetStudentForm();
      await load();
      showToast("Aluno adicionado.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar aluno." });
    } finally { setSaving(false); }
  }

  async function handleDeleteStudent(id: string, name: string) {
    Alert.alert("Remover aluno", `Remover "${name}"?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Remover", style: "destructive", onPress: async () => {
        try { await runWithAuth(t => financialApi.deleteStudent(t, id)); await load(); }
        catch { showToast("Falha ao remover.", "error"); }
      }},
    ]);
  }

  async function handleAddIncome() {
    if (!iDesc.trim()) { showToast("Informe a descrição.", "error"); return; }
    try {
      setSaving(true);
      await runWithAuth(t => financialApi.createIncome(t, {
        description: iDesc.trim(),
        amountCents: parseCentsFromInput(iValue),
        paidAt: new Date(`${iDate}T12:00:00.000Z`).toISOString(),
      }));
      setAddIncomeModal(false);
      setIDesc(""); setIValue("100,00"); setIDate(new Date().toISOString().slice(0, 10));
      await load();
      showToast("Receita registrada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar receita." });
    } finally { setSaving(false); }
  }

  async function handleDeleteIncome(id: string) {
    try { await runWithAuth(t => financialApi.deleteIncome(t, id)); await load(); }
    catch { showToast("Falha ao remover.", "error"); }
  }

  async function handleAddExpense() {
    if (!eDesc.trim()) { showToast("Informe a descrição.", "error"); return; }
    try {
      setSaving(true);
      await runWithAuth(t => financialApi.createExpense(t, {
        description: eDesc.trim(),
        amountCents: parseCentsFromInput(eValue),
        category: eCat,
        paidAt: new Date(`${eDate}T12:00:00.000Z`).toISOString(),
      }));
      setAddExpenseModal(false);
      setEDesc(""); setEValue("50,00"); setECat("OTHER"); setEDate(new Date().toISOString().slice(0, 10));
      await load();
      showToast("Despesa registrada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar despesa." });
    } finally { setSaving(false); }
  }

  async function handleDeleteExpense(id: string) {
    try { await runWithAuth(t => financialApi.deleteExpense(t, id)); await load(); }
    catch { showToast("Falha ao remover.", "error"); }
  }

  async function handleSaveGoal() {
    try {
      setSaving(true);
      await runWithAuth(t => financialApi.upsertGoal(t, {
        month,
        targetRevenueCents: gRevenue ? parseCentsFromInput(gRevenue) : undefined,
        targetStudents: gStudents ? Number(gStudents) : undefined,
        targetWeeklyClasses: gClasses ? Number(gClasses) : undefined,
      }));
      setEditGoalModal(false);
      await load();
      showToast("Meta salva.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar meta." });
    } finally { setSaving(false); }
  }

  const RED = "#e57373";
  const isDark = theme.mode === "dark";

  // Tab renders
  function renderStudents() {
    const active   = students.filter(s => s.isActive);
    const inactive = students.filter(s => !s.isActive);
    const appGreen = isDark ? "#00C853" : "#16A34A";
    const offBlue  = isDark ? "#38BDF8" : "#0284C7";

    function StudentRow({ s, dim }: { s: FinancialStudent; dim?: boolean }) {
      const slots = (s.weeklySchedule ?? []) as WeeklyScheduleSlot[];
      const dayLabels = sortSchedule(slots).map((sl) => DAY_LABELS[sl.dayOfWeek]).join(" · ");
      const timeStr = slots.length > 0 ? `${slots[0].startTime}–${slots[0].endTime}` : null;
      const serviceTypeLabel =
        s.type === "BOTH"
          ? "Consultoria e presencial"
          : s.type === "ONLINE"
            ? "Consultoria"
            : s.type === "PRESENTIAL"
              ? "Presencial"
              : "Pelo app";
      return (
        <MvCard style={{ opacity: dim ? 0.5 : 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <MvText variant="semi3" style={{ flex: 1 }}>{s.name}</MvText>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: isDark ? "rgba(56,189,248,0.12)" : "rgba(2,132,199,0.10)" }}>
                    <MvText variant="badge" style={{ fontSize: 9, color: offBlue }}>Fora App</MvText>
                  </View>
                  <MvText variant="badge" style={{ color: offBlue }}>{fmtCents(s.monthlyValueCents)}</MvText>
                </View>
              </View>
              <MvText variant="body4" style={{ color: offBlue, fontSize: 10, marginTop: 2 }}>
                {serviceTypeLabel}
              </MvText>
              {dayLabels ? (
                <MvText variant="body4" color="secondary" style={{ fontSize: 11, marginTop: 2 }}>
                  {dayLabels}{timeStr ? ` - ${timeStr}` : ""}{s.location ? ` - ${s.location}` : ""}
                </MvText>
              ) : null}
            </View>
            <TouchableOpacity onPress={() => void handleDeleteStudent(s.id, s.name)}>
              <Ionicons name="trash-outline" size={16} color={RED} />
            </TouchableOpacity>
          </View>
        </MvCard>
      );
    }

    function AppClientRow({ c }: { c: FinancialAppClient }) {
      const hasPending  = c.confirmedSessionCount > 0;
      const hasComplete = c.sessionCount > 0;
      const pendingColor = isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.38)";
      return (
        <MvCard>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <MvText variant="semi3" style={{ flex: 1 }}>{c.name}</MvText>
                <View style={{ alignItems: "flex-end", gap: 2 }}>
                  {hasComplete ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: isDark ? "rgba(0,200,83,0.14)" : "rgba(22,163,74,0.10)" }}>
                        <MvText variant="badge" style={{ fontSize: 8, color: appGreen }}>Concluido</MvText>
                      </View>
                      <MvText variant="badge" style={{ color: appGreen }}>{fmtCents(c.completedCents)}</MvText>
                    </View>
                  ) : null}
                  {hasPending ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, borderWidth: 1, borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)" }}>
                        <MvText variant="badge" style={{ fontSize: 8, color: pendingColor }}>Agendado</MvText>
                      </View>
                      <MvText variant="badge" style={{ color: pendingColor }}>{fmtCents(c.confirmedCents)}</MvText>
                    </View>
                  ) : null}
                </View>
              </View>
              <MvText variant="body4" color="secondary" style={{ fontSize: 11, marginTop: 2 }}>
                {hasComplete ? `${c.sessionCount} concluida${c.sessionCount !== 1 ? "s" : ""}` : ""}
                {hasComplete && hasPending ? " - " : ""}
                {hasPending ? `${c.confirmedSessionCount} agendada${c.confirmedSessionCount !== 1 ? "s" : ""}` : ""}
                {c.services.length > 0 ? ` - ${c.services.join(", ")}` : ""}
              </MvText>
            </View>
          </View>
        </MvCard>
      );
    }

    return (
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40, gap: 6 }} showsVerticalScrollIndicator={false}>
        {/* Clientes que compraram pelo app (gerado automaticamente) */}
        {appClients.length > 0 ? (
          <>
            <MvText variant="semi3" style={{ color: appGreen, fontSize: 11, marginBottom: 2 }}>
              Pelo App ({appClients.length})
            </MvText>
            {appClients.map(c => <AppClientRow key={c.clientId} c={c} />)}
            <View style={{ height: 8 }} />
          </>
        ) : null}

        {/* Alunos adicionados manualmente */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <MvText variant="semi3" style={{ color: offBlue, fontSize: 11 }}>
            Fora do App ({active.length})
          </MvText>
          <TouchableOpacity onPress={() => setAddStudentModal(true)}>
            <MvText variant="body4" style={{ color: offBlue, fontSize: 11 }}>+ Novo aluno</MvText>
          </TouchableOpacity>
        </View>

        {students.length === 0 && appClients.length === 0 ? (
          <MvText variant="body4" color="secondary" style={{ textAlign: "center", marginTop: 24 }}>Nenhum aluno cadastrado.</MvText>
        ) : null}
        {students.length === 0 && appClients.length > 0 ? (
          <MvText variant="body4" color="secondary" style={{ fontSize: 11, opacity: 0.5 }}>Nenhum aluno fora do app este mes.</MvText>
        ) : null}

        {active.map(s => <StudentRow key={s.id} s={s} />)}
        {inactive.length > 0 ? (
          <>
            <MvText variant="body4" color="secondary" style={{ marginTop: 6, fontSize: 11 }}>Inativos ({inactive.length})</MvText>
            {inactive.map(s => <StudentRow key={s.id} s={s} dim />)}
          </>
        ) : null}
      </ScrollView>
    );
  }

  function renderIncomes() {
    const total = incomes.reduce((s, i) => s + i.amountCents, 0);
    return (
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40, gap: 8 }} showsVerticalScrollIndicator={false}>
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: "rgba(34,197,94,0.10)", borderWidth: 1, borderColor: "rgba(34,197,94,0.20)" }}>
          <MvText variant="body4" color="secondary">Total em {monthLabel(month)}</MvText>
          <MvText variant="h3" style={{ color: GRN }}>{fmtCents(total)}</MvText>
        </View>
        <MvButton label="+ Registrar receita" onPress={() => setAddIncomeModal(true)} />
        {incomes.length === 0 ? (
          <MvText variant="body4" color="secondary" style={{ textAlign: "center", marginTop: 24 }}>Nenhuma receita registrada.</MvText>
        ) : null}
        {incomes.map(inc => (
          <MvCard key={inc.id}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="arrow-up-circle-outline" size={20} color={GRN} />
              <View style={{ flex: 1 }}>
                <MvText variant="semi2">{inc.description}</MvText>
                {inc.student ? <MvText variant="body4" color="secondary">{inc.student.name}</MvText> : null}
                <MvText variant="body4" color="secondary">{new Date(inc.paidAt).toLocaleDateString("pt-BR")}</MvText>
              </View>
              <MvText variant="semi2" style={{ color: GRN }}>{fmtCents(inc.amountCents)}</MvText>
              <TouchableOpacity onPress={() => void handleDeleteIncome(inc.id)}>
                <Ionicons name="trash-outline" size={16} color={theme.text3} />
              </TouchableOpacity>
            </View>
          </MvCard>
        ))}
      </ScrollView>
    );
  }

  function renderExpenses() {
    const total = expenses.reduce((s, e) => s + e.amountCents, 0);
    const catLabel: Record<FinancialExpenseCategory, string> = {
      GYM: "Academia", TRANSPORT: "Transporte", EQUIPMENT: "Equipamento", MARKETING: "Marketing", OTHER: "Outros",
    };
    return (
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40, gap: 8 }} showsVerticalScrollIndicator={false}>
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: "rgba(229,115,115,0.10)", borderWidth: 1, borderColor: "rgba(229,115,115,0.20)" }}>
          <MvText variant="body4" color="secondary">Total em {monthLabel(month)}</MvText>
          <MvText variant="h3" style={{ color: RED }}>{fmtCents(total)}</MvText>
        </View>
        <MvButton label="+ Registrar despesa" onPress={() => setAddExpenseModal(true)} />
        {expenses.length === 0 ? (
          <MvText variant="body4" color="secondary" style={{ textAlign: "center", marginTop: 24 }}>Nenhuma despesa registrada.</MvText>
        ) : null}
        {expenses.map(exp => (
          <MvCard key={exp.id}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="arrow-down-circle-outline" size={20} color={RED} />
              <View style={{ flex: 1 }}>
                <MvText variant="semi2">{exp.description}</MvText>
                <MvText variant="body4" color="secondary">{catLabel[exp.category]} · {new Date(exp.paidAt).toLocaleDateString("pt-BR")}</MvText>
              </View>
              <MvText variant="semi2" style={{ color: RED }}>{fmtCents(exp.amountCents)}</MvText>
              <TouchableOpacity onPress={() => void handleDeleteExpense(exp.id)}>
                <Ionicons name="trash-outline" size={16} color={theme.text3} />
              </TouchableOpacity>
            </View>
          </MvCard>
        ))}
      </ScrollView>
    );
  }

  function renderGoals() {
    const d = dashboard;
    return (
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>
        <MvButton label="Definir metas" onPress={() => setEditGoalModal(true)} />
        {!goal ? (
          <MvText variant="body4" color="secondary" style={{ textAlign: "center", marginTop: 24 }}>
            Nenhuma meta definida para {monthLabel(month)}.
          </MvText>
        ) : (
          <MvCard>
            <MvText variant="semi2" style={{ marginBottom: 10 }}>Metas — {monthLabel(month)}</MvText>
            {goal.targetRevenueCents && d ? (
              <GoalProgress label="Faturamento" current={effectiveRevenueCents} target={goal.targetRevenueCents} formatFn={fmtCents} color={GRN} />
            ) : null}
            {goal.targetStudents && d ? (
              <GoalProgress label="Alunos ativos" current={d.activeStudents} target={goal.targetStudents} formatFn={v => `${v} alunos`} color="#42A5F5" />
            ) : null}
            {goal.targetWeeklyClasses && d ? (
              <GoalProgress label="Aulas por semana" current={d.weeklyClasses} target={goal.targetWeeklyClasses} formatFn={v => `${v} aulas`} color="#FF9800" />
            ) : null}
            <View style={{ marginTop: 12, gap: 4, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10 }}>
              {goal.targetRevenueCents ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <MvText variant="body4" color="secondary">Meta de faturamento</MvText>
                  <MvText variant="body4">{fmtCents(goal.targetRevenueCents)}</MvText>
                </View>
              ) : null}
              {goal.targetStudents ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <MvText variant="body4" color="secondary">Meta de alunos</MvText>
                  <MvText variant="body4">{goal.targetStudents} alunos</MvText>
                </View>
              ) : null}
              {goal.targetWeeklyClasses ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <MvText variant="body4" color="secondary">Meta de aulas/semana</MvText>
                  <MvText variant="body4">{goal.targetWeeklyClasses} aulas</MvText>
                </View>
              ) : null}
            </View>
          </MvCard>
        )}
      </ScrollView>
    );
  }

  const TypeChip = ({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: selected ? "rgba(34,197,94,0.12)" : theme.chipBg, borderWidth: 1, borderColor: selected ? "rgba(34,197,94,0.30)" : theme.border }}>
      <MvText variant="body4" style={{ color: selected ? GRN : theme.text2 }}>{label}</MvText>
    </TouchableOpacity>
  );

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Fixed top section */}
      <View style={{ paddingTop: insets.top + 8 }}>
        {/* Header: back + title */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingBottom: 8, gap: 10 }}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="chevron-back" size={20} color={theme.text2} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <MvText variant="semi1">Controle Financeiro</MvText>
            <MvText variant="body4" color="secondary">Gestão completa da sua carreira</MvText>
          </View>
        </View>

        {/* Stats strip: bento cards com borda colorida superior */}
        {dashboard ? (
          <View style={{ gap: 6, paddingHorizontal: 14, marginBottom: 10 }}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <StatCard label="Faturamento" value={fmtCents(effectiveRevenueCents)} color={isDark ? "#00C853" : "#16A34A"} theme={theme} />
              <StatCard label="Despesas"    value={fmtCents(totalExpensesCents)} color={isDark ? "#F87171" : "#E53935"} theme={theme} />
              <StatCard label="Lucro"       value={fmtCents(effectiveProfitCents)} color={effectiveProfitCents >= 0 ? (isDark ? "#00C853" : "#16A34A") : (isDark ? "#F87171" : "#E53935")} theme={theme} />
            </View>
            {dashboard.confirmedRevenueCents > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)", borderStyle: "dashed" }}>
                <Ionicons name="time-outline" size={13} color={theme.text3} />
                <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>
                  Receita prevista (agendada): <MvText variant="semi3" style={{ fontSize: 11, color: theme.text2 }}>{fmtCents(dashboard.confirmedRevenueCents)}</MvText>
                </MvText>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Radar chart: periodo + filtros + donut + sparkline */}
        {dashboard ? (
          <RadarChartSection
            app={appRevenueCents}
            offApp={offAppRevenueCents}
            expenses={totalExpensesCents}
            report={report}
            dashboard={dashboard}
            isDark={isDark}
            theme={theme}
            month={month}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
          />
        ) : null}

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: theme.border, marginHorizontal: 14 }} />
      </View>

      {/* Sidebar + content */}
      <View style={{ flex: 1, flexDirection: "row" }}>
        {/* Left icon navigation */}
        <View style={{
          width: 56,
          paddingVertical: 10,
          paddingHorizontal: 6,
          gap: 4,
          alignItems: "center",
          borderRightWidth: 1,
          borderRightColor: theme.border,
        }}>
          {TABS.map(t => {
            const sel = t.key === tab;
            return (
              <TouchableOpacity
                key={t.key}
                onPress={() => setTab(t.key)}
                style={{
                  width: 44, height: 44,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: sel ? (isDark ? "rgba(0,200,83,0.15)" : "rgba(22,163,74,0.12)") : "transparent",
                }}
              >
                <Ionicons
                  name={t.icon as any}
                  size={22}
                  color={sel ? (isDark ? "#00C853" : "#16A34A") : theme.text3}
                />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Tab content */}
        <View style={{ flex: 1 }}>
          {loading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={isDark ? "#00C853" : "#16A34A"} />
            </View>
          ) : (
            <>
              {tab === "alunos"   ? renderStudents() : null}
              {tab === "receitas" ? renderIncomes()  : null}
              {tab === "despesas" ? renderExpenses() : null}
              {tab === "metas"    ? renderGoals()    : null}
            </>
          )}
        </View>
      </View>

      {/* Add Student Modal */}
      <ModalSheet visible={addStudentModal} title="Novo aluno" onClose={() => { setAddStudentModal(false); resetStudentForm(); }} theme={theme} topInset={insets.top}>
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvInput placeholder="Nome do aluno" value={sName} onChangeText={setSName} />
          <View style={{ flexDirection: "row", gap: 6 }}>
            {([{ key: "PRESENTIAL", label: "Presencial" }, { key: "ONLINE", label: "Consultoria" }, { key: "BOTH", label: "Ambos" }] as { key: FinancialStudentType; label: string }[]).map(t => (
              <TypeChip key={t.key} selected={sType === t.key} label={t.label} onPress={() => { setSType(t.key); setSSchedule([]); }} />
            ))}
          </View>
          {hasPresential ? (
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: sLocSuggOpen ? "rgba(34,197,94,0.50)" : theme.border, borderRadius: 10, backgroundColor: theme.inputBg, paddingHorizontal: 10, paddingVertical: 8 }}>
                <Ionicons name="location-outline" size={13} color={locationSuggsLoading ? GRN : theme.text3} />
                <TextInput value={sLocationQuery} onChangeText={v => { setSLocationQuery(v); setSLocation(v); }} onFocus={() => { if (locBlurRef.current) clearTimeout(locBlurRef.current); setSLocSuggOpen(true); }} onBlur={() => { locBlurRef.current = setTimeout(() => setSLocSuggOpen(false), 400); }} placeholder="Local de atendimento (opcional)" placeholderTextColor={theme.text3} style={{ flex: 1, padding: 0, color: theme.text2, fontSize: 13 }} />
                {locationSuggsLoading ? <ActivityIndicator size="small" color={GRN} /> : null}
              </View>
              {locationSuggs.length > 0 && sLocSuggOpen ? (
                <ScrollView style={{ maxHeight: 160, marginTop: 3, borderWidth: 1, borderColor: theme.border, borderRadius: 9 }} keyboardShouldPersistTaps="always">
                  {locationSuggs.map((s, idx) => (
                    <TouchableOpacity key={s.placeId ?? `ls-${idx}`} onPressIn={() => { if (locBlurRef.current) clearTimeout(locBlurRef.current); }} onPress={() => { const text = s.address ? `${s.name}, ${s.address.replace(/, Brasil$/, "").replace(/, Brazil$/, "")}` : s.name; setSLocation(text); setSLocationQuery(text); setSLocSuggOpen(false); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: idx > 0 ? 1 : 0, borderColor: theme.borderSub, backgroundColor: theme.cardBg }}>
                      <Ionicons name="location-outline" size={12} color={GRN} />
                      <View style={{ flex: 1 }}>
                        <MvText variant="body4" numberOfLines={1} style={{ fontSize: 11 }}>{s.name}</MvText>
                        {s.address ? <MvText variant="body4" color="secondary" numberOfLines={1} style={{ fontSize: 10 }}>{s.address}</MvText> : null}
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : null}
            </View>
          ) : null}
          <MvInput keyboardType="numeric" placeholder="Valor mensal (R$)" value={sValue} onChangeText={v => setSValue(maskPriceInput(v))} />
          {hasPresential ? <CompactSchedulePicker schedule={sSchedule} onChange={setSSchedule} theme={theme} /> : null}
          <MvButton label="Salvar aluno" loading={saving} onPress={() => void handleAddStudent()} />
        </View>
      </ModalSheet>

      {/* Add Income Modal */}
      <ModalSheet visible={addIncomeModal} title="Registrar receita" onClose={() => setAddIncomeModal(false)} theme={theme} topInset={insets.top}>
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvInput placeholder="Descrição (Ex: João — mensalidade)" value={iDesc} onChangeText={setIDesc} />
          <MvInput keyboardType="numeric" placeholder="Valor (R$)" value={iValue} onChangeText={v => setIValue(maskPriceInput(v))} />
          <MvText variant="body4" color="secondary">Data de recebimento (AAAA-MM-DD)</MvText>
          <MvInput placeholder="Ex: 2026-04-05" value={iDate} onChangeText={setIDate} />
          <MvButton label="Salvar receita" loading={saving} onPress={() => void handleAddIncome()} />
        </View>
      </ModalSheet>

      {/* Add Expense Modal */}
      <ModalSheet visible={addExpenseModal} title="Registrar despesa" onClose={() => setAddExpenseModal(false)} theme={theme} topInset={insets.top}>
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvInput placeholder="Descrição (Ex: Mensalidade academia)" value={eDesc} onChangeText={setEDesc} />
          <MvInput keyboardType="numeric" placeholder="Valor (R$)" value={eValue} onChangeText={v => setEValue(maskPriceInput(v))} />
          <MvText variant="semi3">Categoria</MvText>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {([{ key: "GYM", label: "Academia" }, { key: "TRANSPORT", label: "Transporte" }, { key: "EQUIPMENT", label: "Equipamento" }, { key: "MARKETING", label: "Marketing" }, { key: "OTHER", label: "Outros" }] as { key: FinancialExpenseCategory; label: string }[]).map(c => (
              <TypeChip key={c.key} selected={eCat === c.key} label={c.label} onPress={() => setECat(c.key)} />
            ))}
          </View>
          <MvText variant="body4" color="secondary">Data do pagamento (AAAA-MM-DD)</MvText>
          <MvInput placeholder="Ex: 2026-04-01" value={eDate} onChangeText={setEDate} />
          <MvButton label="Salvar despesa" loading={saving} onPress={() => void handleAddExpense()} />
        </View>
      </ModalSheet>

      {/* Edit Goal Modal */}
      <ModalSheet visible={editGoalModal} title={`Metas - ${monthLabel(month)}`} onClose={() => setEditGoalModal(false)} theme={theme} topInset={insets.top}>
        <View style={{ gap: 10, paddingBottom: 40 }}>
          <MvText variant="body4" color="secondary">Defina o que quer atingir este mês.</MvText>
          <MvInput keyboardType="numeric" placeholder="R$ 0,00" value={gRevenue} onChangeText={v => setGRevenue(maskPriceInput(v))} />
          <MvInput keyboardType="numeric" placeholder="Meta de alunos ativos" value={gStudents} onChangeText={setGStudents} />
          <MvInput keyboardType="numeric" placeholder="Meta de aulas por semana" value={gClasses} onChangeText={setGClasses} />
          <MvButton label="Salvar metas" loading={saving} onPress={() => void handleSaveGoal()} />
        </View>
      </ModalSheet>
    </View>
  );
}
