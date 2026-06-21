import React from "react";
import { TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvText } from "../mv";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UrgencyTone = "amber" | "sky" | "red";
export type MetricTone = "green" | "amber" | "sky" | "red";

// ─── Color helpers ────────────────────────────────────────────────────────────

function urgencyColors(tone: UrgencyTone, textGreen: string, danger: string) {
  switch (tone) {
    case "amber":
      return { bg: "rgba(245,166,35,0.10)", border: "rgba(245,166,35,0.28)", accent: "#F5A623" };
    case "red":
      return { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.28)", accent: danger };
    default: // sky
      return { bg: "rgba(56,189,248,0.10)", border: "rgba(56,189,248,0.25)", accent: "#38BDF8" };
  }
}

function metricColors(tone: MetricTone, textGreen: string, danger: string) {
  switch (tone) {
    case "amber": return { text: "#F5A623", border: "rgba(245,166,35,0.25)" };
    case "sky":   return { text: "#38BDF8", border: "rgba(56,189,248,0.25)" };
    case "red":   return { text: danger,    border: "rgba(239,68,68,0.25)" };
    default:      return { text: textGreen, border: "rgba(34,197,94,0.22)" };
  }
}

// ─── UrgencyCard ─────────────────────────────────────────────────────────────
// Substitui banners genéricos por CTAs de ação imediata com tom de cor.
// tone: "amber" = pendências normais, "red" = crítico, "sky" = setup incompleto.

export type UrgencyCardProps = {
  icon: keyof typeof Ionicons.glyphMap;
  tone: UrgencyTone;
  /** Label pequeno acima do título (ex: "configuração incompleta") */
  subtitle: string;
  /** Texto principal do card */
  title: string;
  /** Texto do CTA à direita (ex: "Completar") */
  cta: string;
  onPress: () => void;
};

export function UrgencyCard({ icon, tone, subtitle, title, cta, onPress }: UrgencyCardProps) {
  const { theme } = useMvTheme();
  const c = urgencyColors(tone, theme.textGreen, theme.danger);

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      style={{
        borderRadius: 18,
        padding: 14,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.bg,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      {/* Ícone */}
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: theme.mode === "dark" ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.06)",
          borderWidth: 1,
          borderColor: c.border,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Ionicons name={icon} size={20} color={c.accent} />
      </View>

      {/* Texto */}
      <View style={{ flex: 1, gap: 2 }}>
        <MvText
          variant="caption"
          style={{ color: c.accent, letterSpacing: 0.5, textTransform: "uppercase" }}
        >
          {subtitle}
        </MvText>
        <MvText variant="semi2" style={{ color: theme.text1 }}>{title}</MvText>
      </View>

      {/* CTA */}
      <MvText variant="semi3" style={{ color: c.accent, flexShrink: 0 }}>{cta} →</MvText>
    </TouchableOpacity>
  );
}

// ─── MetricPill ───────────────────────────────────────────────────────────────
// Métrica compacta com valor em Bricolage e borda colorida por tom.
// Usa flex: 1 — deve estar dentro de uma View com flexDirection: "row".

export type MetricPillProps = {
  label: string;
  value: string | number;
  tone?: MetricTone;
};

export function MetricPill({ label, value, tone = "green" }: MetricPillProps) {
  const { theme } = useMvTheme();
  const c = metricColors(tone, theme.textGreen, theme.danger);

  return (
    <View
      style={{
        flex: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 13,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: theme.cardBg,
        minWidth: 0,
        gap: 5,
      }}
    >
      <MvText
        variant="body4"
        color="secondary"
        numberOfLines={1}
        style={{ fontSize: 11 }}
      >
        {label}
      </MvText>
      <MvText
        numberOfLines={1}
        style={{
          fontFamily: "PlusJakartaSans_800ExtraBold",
          fontSize: 18,
          letterSpacing: -0.1,
          color: c.text,
          lineHeight: 23,
        }}
      >
        {String(value)}
      </MvText>
    </View>
  );
}

// ─── StepProgressBar ─────────────────────────────────────────────────────────
// Barra de progresso de N etapas com label abaixo de cada barra.
// Ativa: verde. Anterior: verde 50% opacidade. Próxima: cor de borda.

export type StepProgressBarProps = {
  steps: string[];
  /** Passo atual, começando em 1. */
  currentStep: number;
};

export function StepProgressBar({ steps, currentStep }: StepProgressBarProps) {
  const { theme } = useMvTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        paddingHorizontal: 20,
        paddingVertical: 10,
        gap: 6,
      }}
    >
      {steps.map((label, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === currentStep;
        const isDone   = stepNum < currentStep;

        return (
          <View key={label} style={{ flex: 1, alignItems: "center", gap: 5 }}>
            <View
              style={{
                height: 3,
                width: "100%",
                borderRadius: 99,
                backgroundColor: isDone || isActive ? theme.textGreen : theme.border,
                opacity: isDone ? 0.5 : 1,
              }}
            />
            <MvText
              style={{
                fontSize: 10,
                color: isActive ? theme.textGreen : theme.text3,
                fontFamily: isActive ? "DMSans_700Bold" : "DMSans_400Regular",
              }}
            >
              {label}
            </MvText>
          </View>
        );
      })}
    </View>
  );
}
