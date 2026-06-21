/**
 * primitives.tsx - ARQUIVO DE COMPATIBILIDADE
 *
 * Este arquivo existia como implementacao legada de componentes base.
 * Foi substituido pelos componentes corrigidos em src/components/ui/.
 *
 * Em vez de reescrever os primitivos aqui (o que criaria uma terceira versao
 * dos mesmos componentes e aumentaria a confusao), este arquivo agora re-exporta
 * os componentes da pasta ui/ com os nomes que as telas legadas ja usam.
 */

import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Text, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";
import { useTheme } from "../theme/useTheme";
import { useMvTheme } from "../theme/MvThemeContext";
import { C } from "../theme/v2tokens";
import { useThemedStyles } from "../theme/useThemedStyles";
import { AppButton as AppButtonUI } from "./ui/AppButton";
import { AppCard as AppCardUI } from "./ui/AppCard";
import { AppInput } from "./ui/AppInput";
import { AppChip } from "./ui/AppChip";
import { AppBadge } from "./ui/AppBadge";
import { AppText as AppTextUI } from "./ui/AppText";
import { AppModal as AppModalNew } from "./ui/AppModal";

export { AppInput, AppChip, AppBadge };
export { AppTextUI as AppText };

type LegacyButtonProps = Omit<React.ComponentProps<typeof AppButtonUI>, "title"> & {
  label: string;
};

export function AppButton({ label, ...rest }: LegacyButtonProps) {
  return <AppButtonUI title={label} {...rest} />;
}

type LegacyCardProps = {
  title?: string;
  description?: string;
  rightElement?: React.ReactNode;
  children?: React.ReactNode;
  selected?: boolean;
  elevated?: boolean;
  style?: React.ComponentProps<typeof AppCardUI>["style"];
  contentStyle?: React.ComponentProps<typeof AppCardUI>["contentStyle"];
  disabled?: boolean;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  testID?: string;
  onPress?: () => void;
  onLongPress?: () => void;
};

export function AppCard({
  title,
  description,
  rightElement,
  children,
  onPress,
  onLongPress,
  ...rest
}: LegacyCardProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(() => ({
    legacyCardRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing.sm,
    },
    legacyCardTexts: {
      flex: 1,
      gap: 4,
    },
  }));
  const content = children ?? (
    <View style={styles.legacyCardRow}>
      <View style={styles.legacyCardTexts}>
        {title ? <AppTextUI variant="bodyStrong">{title}</AppTextUI> : null}
        {description ? (
          <AppTextUI variant="caption" color={colors.textSecondary}>
            {description}
          </AppTextUI>
        ) : null}
      </View>
      {rightElement}
    </View>
  );

  if (onPress) {
    return (
      <AppCardUI {...rest} onPress={onPress} onLongPress={onLongPress}>
        {content}
      </AppCardUI>
    );
  }

  return (
    <AppCardUI {...rest}>
      {content}
    </AppCardUI>
  );
}

export function AppModal({
  visible,
  title,
  message,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel: () => void;
}) {
  return (
    <AppModalNew
      visible={visible}
      title={title}
      description={description ?? message}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export function AppSkeleton({ height = 22 }: { height?: number }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  const { themeMode } = useTheme();
  const skeletonStyles = useThemedStyles(() => ({
    base: {
      width: "100%",
      borderRadius: theme.radius.md,
      backgroundColor:
        themeMode === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)",
    },
  }));

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return <Animated.View style={[skeletonStyles.base, { height, opacity }]} />;
}

export function StateBlock({
  title,
  description,
  tone = "default",
}: {
  title: string;
  description: string;
  tone?: "default" | "error" | "success" | "offline";
}) {
  const { fontScale } = useWindowDimensions();
  const { colors } = useTheme();
  const stateStyles = useThemedStyles((palette) => ({
    block: {
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      backgroundColor: palette.surface,
      gap: theme.spacing.xs,
    },
  }));
  const dynamicPadding = Math.round(theme.spacing.md * Math.min(fontScale, 1.3));

  const borderColor =
    tone === "error"
      ? colors.danger
      : tone === "success"
        ? colors.primary
        : tone === "offline"
          ? colors.warning
          : colors.border;

  return (
    <View style={[stateStyles.block, { borderColor, padding: dynamicPadding }]}>
      <AppTextUI variant="bodyStrong">{title}</AppTextUI>
      <AppTextUI variant="caption">{description}</AppTextUI>
    </View>
  );
}

export function HeroOverlay({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(() => ({
    absoluteFill: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
  }));
  return (
    <LinearGradient
      colors={["rgba(0,0,0,0.15)", "rgba(7,11,8,0.55)", "rgba(25,180,80,0.35)"]}
      style={styles.absoluteFill}
    >
      {children}
    </LinearGradient>
  );
}

export function FullScreenLoader({ label }: { label: string }) {
  const insets = (() => {
    try {
      return useSafeAreaInsets();
    } catch {
      return { top: 0, bottom: 0, left: 0, right: 0 };
    }
  })();
  const { colors } = useTheme();
  const loaderStyles = useThemedStyles((palette) => ({
    wrap: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: palette.background,
      gap: theme.spacing.sm,
    },
  }));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[
        loaderStyles.wrap,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <ActivityIndicator color={colors.primary} size="large" />
      <AppTextUI variant="caption" color={colors.textSecondary}>
        {label}
      </AppTextUI>
    </View>
  );
}

export function ToastHost({
  message,
  type = "info",
}: {
  message: string;
  type?: "info" | "success" | "error";
}) {
  const insets = useSafeAreaInsets();
  const { theme: mvTheme } = useMvTheme();

  const bg =
    type === "success" ? mvTheme.primary
    : type === "error"  ? mvTheme.danger
    : C.surface1;
  const textColor = type === "success" ? mvTheme.textOnPrimary : C.white;
  const hasBorder = type === "info";

  return (
    <View
      style={{
        position: "absolute",
        alignSelf: "center",
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 999,
        zIndex: 9999,
        maxWidth: 480,
        bottom: Math.max(24, insets.bottom + 16),
        backgroundColor: bg,
        borderWidth: hasBorder ? 1 : 0,
        borderColor: "rgba(255,255,255,0.14)",
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
      }}
      accessibilityLiveRegion="polite"
      accessibilityRole={type === "error" ? "alert" : "text"}
    >
      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: textColor, textAlign: "center" }}>
        {message}
      </Text>
    </View>
  );
}
