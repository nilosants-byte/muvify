import React, { useEffect } from "react";
import { Text, View } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withSpring,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { MvText } from "../mv";
import { PressableScale } from "../polish/PressableScale";

// ─── Mini bar chart ───────────────────────────────────────────────────────────

export function AnimatedBar({
  barH,
  chartH,
  barW,
  fillColor,
  bgColor,
  delay,
}: {
  barH: number;
  chartH: number;
  barW: number;
  fillColor: string;
  bgColor: string;
  delay: number;
}) {
  const animH = useSharedValue(0);

  useEffect(() => {
    animH.value = withDelay(delay, withSpring(barH, { damping: 14, stiffness: 90, mass: 0.8 }));
  }, [barH, delay]);

  const animStyle = useAnimatedStyle(() => ({ height: animH.value }));

  return (
    <View
      style={{
        width: barW,
        height: chartH,
        borderRadius: 5,
        backgroundColor: bgColor,
        justifyContent: "flex-end",
        overflow: "hidden",
      }}
    >
      <ReAnimated.View style={[{ width: barW, borderRadius: 5, backgroundColor: fillColor }, animStyle]} />
    </View>
  );
}

export function WeeklyBarChart({
  data,
  primaryColor,
  barBg,
}: {
  data: { label: string; revenue: number; isToday: boolean }[];
  primaryColor: string;
  barBg: string;
}) {
  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);
  const chartH = 52;
  const barW = 18;
  const gap = 10;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap, marginTop: 8 }}>
      {data.map((d, i) => {
        const barH = Math.max(4, Math.round((d.revenue / maxRevenue) * chartH));
        return (
          <View key={i} style={{ alignItems: "center", gap: 4 }}>
            <AnimatedBar
              barH={barH}
              chartH={chartH}
              barW={barW}
              fillColor={d.isToday ? primaryColor : `${primaryColor}80`}
              bgColor={barBg}
              delay={i * 40}
            />
            <Text
              style={{
                fontSize: 10,
                color: d.isToday ? primaryColor : "#6B7280",
                fontFamily: "DMSans_500Medium",
                lineHeight: 12,
              }}
            >
              {d.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Activity timeline item ───────────────────────────────────────────────────

export function ActivityItem({
  iconName,
  iconColor,
  iconBg,
  title,
  subtitle,
  timeLabel,
  valueLabel,
  onPress,
  borderColor,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle?: string;
  timeLabel: string;
  valueLabel?: string;
  onPress?: () => void;
  borderColor: string;
}) {
  const { theme } = useMvTheme();
  const inner = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor,
        backgroundColor: iconBg,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: `${iconColor}22`,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Ionicons name={iconName} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <MvText variant="semi3" numberOfLines={1}>{title}</MvText>
        {subtitle ? (
          <MvText variant="body4" color="secondary" numberOfLines={1}>{subtitle}</MvText>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        {valueLabel ? (
          <MvText variant="semi3" style={{ color: theme.primary }}>{valueLabel}</MvText>
        ) : null}
        <MvText variant="body4" color="secondary">{timeLabel}</MvText>
      </View>
    </View>
  );

  if (onPress) {
    return (
      <PressableScale onPress={onPress} scale={0.97}>
        {inner}
      </PressableScale>
    );
  }
  return inner;
}

// ─── Greeting helper ──────────────────────────────────────────────────────────

export function getProfessionalGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: "Bom dia", icon: "sunny-outline" as const };
  if (h < 18) return { text: "Boa tarde", icon: "partly-sunny-outline" as const };
  return { text: "Boa noite", icon: "moon-outline" as const };
}
