import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { theme } from '../../theme';
import { AppText } from './AppText';
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

type BadgeTone =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'offline'
  | 'primary';

interface AppBadgeProps {
  label: string;
  tone?: BadgeTone;
  accessibilityLabel?: string;
}

export function AppBadge({
  label,
  tone = 'default',
  accessibilityLabel,
}: AppBadgeProps) {
  const { fontScale } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    container: {
      alignSelf: 'flex-start',
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
  }));
  const palettes: Record<
    BadgeTone,
    { backgroundColor: string; borderColor: string; textColor: string }
  > = {
    default: {
      backgroundColor: colors.surfaceStrong,
      borderColor: colors.border,
      textColor: colors.text,
    },
    success: {
      backgroundColor: colors.chipBg,
      borderColor: colors.chipBorder,
      textColor: colors.primarySoft,
    },
    warning: {
      backgroundColor: 'rgba(242, 166, 64, 0.12)',
      borderColor: 'rgba(242, 166, 64, 0.25)',
      textColor: colors.warning,
    },
    danger: {
      backgroundColor: 'rgba(242, 92, 92, 0.12)',
      borderColor: 'rgba(242, 92, 92, 0.25)',
      textColor: colors.danger,
    },
    info: {
      backgroundColor: 'rgba(92, 168, 242, 0.12)',
      borderColor: 'rgba(92, 168, 242, 0.25)',
      textColor: colors.info,
    },
    offline: {
      backgroundColor: 'rgba(124, 138, 129, 0.14)',
      borderColor: 'rgba(124, 138, 129, 0.28)',
      textColor: colors.offline,
    },
    primary: {
      backgroundColor: colors.chipBg,
      borderColor: colors.chipBorder,
      textColor: colors.primary,
    },
  } as const;
  const palette = palettes[tone];

  const dynamicMinHeight = Math.round(26 * Math.min(fontScale, 1.3));
  const dynamicPaddingH = Math.round(theme.spacing.sm * Math.min(fontScale, 1.2));
  const dynamicPaddingV = Math.max(3, Math.round(3 * Math.min(fontScale, 1.3)));

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
          minHeight: dynamicMinHeight,
          paddingHorizontal: dynamicPaddingH,
          paddingVertical: dynamicPaddingV,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
      importantForAccessibility="yes"
    >
      <AppText
        color={palette.textColor}
        variant="captionStrong"
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </AppText>
    </View>
  );
}
