import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { ScrollView, Text, TouchableOpacity } from "react-native";
import { ProviderServiceMode } from "../../../services/api/client";
import { C, S } from "../../../theme/v2tokens";
import { useMvTheme } from "../../../theme/MvThemeContext";

const MODE_OPTIONS: { label: string; value: ProviderServiceMode }[] = [
  { label: "Presencial", value: "PRESENTIAL_ONLY" },
  { label: "A domicílio", value: "HOME_VISIT_ONLY" },
  { label: "Ambos", value: "BOTH" },
];

const QUICK_SPECIALTIES = ["Funcional", "Hipertrofia"] as const;

type Props = {
  filterMode: ProviderServiceMode | undefined;
  onToggleMode: (mode: ProviderServiceMode) => void;
  selectedSpecialties: string[];
  onToggleSpecialty: (spec: string) => void;
};

export function ClientHomeFilters({ filterMode, onToggleMode, selectedSpecialties, onToggleSpecialty }: Props) {
  const { theme, isDark } = useMvTheme();
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: S.px, paddingVertical: 4, gap: 8, alignItems: "center" }}
    >
      {MODE_OPTIONS.map((opt) => {
        const active = filterMode === opt.value;
        const iconName: React.ComponentProps<typeof Ionicons>["name"] =
          opt.value === "PRESENTIAL_ONLY" ? "barbell-outline" :
          opt.value === "HOME_VISIT_ONLY" ? "home-outline" : "git-merge-outline";
        return (
          <TouchableOpacity
            key={opt.label}
            onPress={() => onToggleMode(opt.value)}
            style={{
              height: 40, paddingHorizontal: 14, borderRadius: S.chipR,
              backgroundColor: active ? theme.primarySubtle : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"),
              borderWidth: 1, borderColor: active ? theme.primarySubtleBorder : theme.border,
              flexDirection: "row", alignItems: "center", gap: 7, minWidth: S.touchMin,
            }}
          >
            <Ionicons name={iconName} size={14} color={active ? theme.primary : theme.text2} />
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: active ? theme.primary : theme.text2, letterSpacing: -0.2 }}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
      {QUICK_SPECIALTIES.map((spec) => {
        const active = selectedSpecialties.includes(spec);
        return (
          <TouchableOpacity
            key={spec}
            onPress={() => onToggleSpecialty(spec)}
            style={{
              height: 40, paddingHorizontal: 14, borderRadius: S.chipR,
              backgroundColor: active ? theme.primarySubtle : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"),
              borderWidth: 1, borderColor: active ? theme.primarySubtleBorder : theme.border,
              flexDirection: "row", alignItems: "center", gap: 7, minWidth: S.touchMin,
            }}
          >
            <Ionicons
              name={spec === "Funcional" ? "flame-outline" : "barbell-outline"}
              size={14}
              color={active ? theme.primary : theme.text2}
            />
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: active ? theme.primary : theme.text2, letterSpacing: -0.2 }}>
              {spec}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}
