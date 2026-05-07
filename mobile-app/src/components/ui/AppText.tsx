import React, { useMemo } from "react";
import {
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  TextProps,
  TextStyle,
} from "react-native";
import { theme } from "../../theme";
import { useTheme } from "../../theme/useTheme";

type AppTextVariant =
  | "display"
  | "title"
  | "subtitle"
  | "body"
  | "bodyStrong"
  | "caption"
  | "captionStrong"
  | "button"
  | "label";

interface AppTextProps extends TextProps {
  variant?: AppTextVariant;
  color?: string;
  align?: TextStyle["textAlign"];
  style?: StyleProp<TextStyle>;
}

const displayFontFamilyByWeight: Record<string, string> = {
  [theme.fontWeight.regular]: "DMSans-Regular",
  [theme.fontWeight.medium]: "DMSans-Medium",
  [theme.fontWeight.semibold]: "Outfit-SemiBold",
  [theme.fontWeight.bold]: "Outfit-Bold",
  [theme.fontWeight.extrabold]: "Outfit-ExtraBold",
};

const bodyFontFamilyByWeight: Record<string, string> = {
  [theme.fontWeight.regular]: "DMSans-Regular",
  [theme.fontWeight.medium]: "DMSans-Medium",
  [theme.fontWeight.semibold]: "DMSans-SemiBold",
  [theme.fontWeight.bold]: "DMSans-Bold",
  [theme.fontWeight.extrabold]: "DMSans-ExtraBold",
};

const systemFontFamily = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "System",
});

function getFontFamily(weight: string, variant: AppTextVariant): string {
  const isDisplay = variant === "display" || variant === "title";
  const source = isDisplay ? displayFontFamilyByWeight : bodyFontFamilyByWeight;
  return source[weight] ?? systemFontFamily ?? "System";
}

const maxFontSizeMultiplierByVariant: Record<AppTextVariant, number> = {
  display: 1.3,
  title: 1.4,
  subtitle: 1.5,
  body: 1.5,
  bodyStrong: 1.5,
  caption: 1.6,
  captionStrong: 1.6,
  button: 1.3,
  label: 1.6,
};

export function AppText({
  variant = "body",
  color,
  align,
  style,
  children,
  ...rest
}: AppTextProps) {
  const { colors } = useTheme();
  const variantStyles = useMemo(
    () =>
      StyleSheet.create({
        display: {
          fontSize: theme.fontSize["3xl"],
          lineHeight: theme.fontSize["3xl"] * 1.12,
          fontFamily: getFontFamily(theme.fontWeight.extrabold, "display"),
          color: colors.text,
          letterSpacing: -0.4,
        },
        title: {
          fontSize: theme.fontSize["2xl"],
          lineHeight: theme.fontSize["2xl"] * 1.2,
          fontFamily: getFontFamily(theme.fontWeight.bold, "title"),
          color: colors.text,
          letterSpacing: -0.2,
        },
        subtitle: {
          fontSize: theme.fontSize.md,
          lineHeight: theme.fontSize.md * 1.5,
          fontFamily: getFontFamily(theme.fontWeight.regular, "subtitle"),
          color: colors.textSecondary,
        },
        body: {
          fontSize: theme.fontSize.md,
          lineHeight: theme.fontSize.md * 1.5,
          fontFamily: getFontFamily(theme.fontWeight.regular, "body"),
          color: colors.text,
        },
        bodyStrong: {
          fontSize: theme.fontSize.md,
          lineHeight: theme.fontSize.md * 1.5,
          fontFamily: getFontFamily(theme.fontWeight.semibold, "bodyStrong"),
          color: colors.text,
        },
        caption: {
          fontSize: theme.fontSize.sm,
          lineHeight: theme.fontSize.sm * 1.45,
          fontFamily: getFontFamily(theme.fontWeight.regular, "caption"),
          color: colors.textSecondary,
        },
        captionStrong: {
          fontSize: theme.fontSize.sm,
          lineHeight: theme.fontSize.sm * 1.45,
          fontFamily: getFontFamily(theme.fontWeight.semibold, "captionStrong"),
          color: colors.text,
        },
        button: {
          fontSize: theme.fontSize.md,
          lineHeight: theme.fontSize.md * 1.33,
          fontFamily: getFontFamily(theme.fontWeight.semibold, "button"),
          color: colors.textInverse,
          letterSpacing: 0.1,
        },
        label: {
          fontSize: theme.fontSize.xs,
          lineHeight: theme.fontSize.xs * 1.45,
          fontFamily: getFontFamily(theme.fontWeight.medium, "label"),
          color: colors.textSecondary,
          letterSpacing: 1,
          textTransform: "uppercase",
        },
      }),
    [colors]
  );
  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={maxFontSizeMultiplierByVariant[variant]}
      {...rest}
      style={[
        variantStyles[variant],
        align ? { textAlign: align } : undefined,
        color ? { color } : undefined,
        style,
      ]}
    >
      {children}
    </Text>
  );
}
