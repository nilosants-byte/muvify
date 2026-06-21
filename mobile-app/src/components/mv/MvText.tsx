import React from "react";
import { Text, TextProps, TextStyle } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";
import { typography } from "../../theme/MvTypography";

type Variant =
  | "hero"
  | "display"
  | "h1" | "h2" | "h3" | "h4"
  | "body1" | "body2" | "body3" | "body4"
  | "semi1" | "semi2" | "semi3"
  | "eyebrow" | "caption" | "label" | "badge" | "navLabel";

type ColorName = "primary" | "secondary" | "tertiary" | "green" | "danger" | "warning" | string;

interface MvTextProps extends TextProps {
  variant?: Variant;
  color?: ColorName;
  style?: TextProps["style"];
}

export function MvText({ variant = "body1", color, style, children, ...rest }: MvTextProps) {
  const { theme } = useMvTheme();

  const resolvedColor = (() => {
    if (!color) return theme.text1;
    switch (color) {
      case "primary": return theme.text1;
      case "secondary": return theme.text2;
      case "tertiary": return theme.text3;
      case "green": return theme.textGreen;
      case "danger": return theme.mode === "dark" ? "#EF5350" : "#c62828";
      case "warning": return theme.mode === "dark" ? "#FF9800" : "#9a4e00";
      default: return color;
    }
  })();

  const baseStyle = (typography[variant] ?? typography.body3) as TextStyle;

  return (
    <Text {...rest} style={[baseStyle, { color: resolvedColor }, style]}>
      {children}
    </Text>
  );
}
