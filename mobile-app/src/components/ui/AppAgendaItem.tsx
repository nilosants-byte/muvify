import React from "react";
import { View } from "react-native";
import { AppBadge } from "./AppBadge";
import { AppText } from "./AppText";
import { theme } from "../../theme";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

type StatusTone = "success" | "warning" | "danger" | "info";

interface AppAgendaItemProps {
  time: string;
  name: string;
  subtitle?: string;
  status?: string;
  statusTone?: StatusTone;
  dotColor?: string;
}

export function AppAgendaItem({
  time,
  name,
  subtitle,
  status,
  statusTone = "success",
  dotColor,
}: AppAgendaItemProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(() => ({
    container: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
    },
    timeCol: {
      width: 70,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 999,
    },
    content: {
      flex: 1,
    },
  }));
  const resolvedDot = dotColor ?? colors.primary;
  return (
    <View style={styles.container}>
      <View style={styles.timeCol}>
        <View style={[styles.dot, { backgroundColor: resolvedDot }]} />
        <AppText variant="captionStrong">{time}</AppText>
      </View>
      <View style={styles.content}>
        <AppText variant="bodyStrong">{name}</AppText>
        {subtitle ? <AppText variant="caption">{subtitle}</AppText> : null}
      </View>
      {status ? <AppBadge label={status} tone={statusTone} /> : null}
    </View>
  );
}
