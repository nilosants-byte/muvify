import React from "react";
import { TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvText } from "../mv";

interface Action {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
}

interface ProfessionalScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: Action;
}

export function ProfessionalScreenHeader({
  title,
  subtitle,
  onBack,
  action,
}: ProfessionalScreenHeaderProps) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingTop: insets.top + 10,
        paddingHorizontal: 20,
        paddingBottom: 10,
        backgroundColor: theme.headerBg,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: theme.backBtn,
              borderWidth: 1,
              borderColor: theme.border,
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Ionicons name="chevron-back" size={20} color={theme.text1} />
          </TouchableOpacity>
        )}

        <View style={{ flex: 1, minWidth: 0 }}>
          <MvText
            variant="h2"
            numberOfLines={1}
            style={{ letterSpacing: -1.0 }}
          >
            {title}
          </MvText>
          {subtitle ? (
            <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
              {subtitle}
            </MvText>
          ) : null}
        </View>

        {action ? (
          <TouchableOpacity
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingHorizontal: action.label ? 12 : 0,
              height: 40,
              minWidth: 40,
              borderRadius: 20,
              backgroundColor: theme.primarySubtle,
              borderWidth: 1,
              borderColor: theme.primarySubtleBorder,
              justifyContent: "center",
            }}
          >
            <Ionicons name={action.icon} size={16} color={theme.textGreen} />
            {action.label ? (
              <MvText
                style={{
                  color: theme.textGreen,
                  fontFamily: "DMSans_700Bold",
                  fontSize: 11,
                }}
              >
                {action.label}
              </MvText>
            ) : null}
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}
