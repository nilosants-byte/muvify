import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";
import { typography } from "../../theme/MvTypography";
import { MvCard } from "./MvCard";

interface MvExerciseCardProps {
  index: number;
  name: string;
  sets: string;
  reps: string;
  load?: string;
  rest?: string;
  onVideoPress?: () => void;
}

export function MvExerciseCard({ index, name, sets, reps, load, rest: restTime, onVideoPress }: MvExerciseCardProps) {
  const { theme } = useMvTheme();
  const isLight = theme.mode === "light";

  const numBg = isLight ? "rgba(76,175,80,0.08)" : "rgba(76,175,80,0.10)";
  const numBorder = isLight ? "rgba(76,175,80,0.18)" : "rgba(76,175,80,0.20)";
  const numColor = isLight ? "#2E7D32" : "#4CAF50";
  const statBg = isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)";
  const thumbBg = isLight ? "rgba(76,175,80,0.06)" : "rgba(76,175,80,0.08)";
  const thumbBorder = isLight ? "rgba(76,175,80,0.14)" : "rgba(76,175,80,0.15)";
  const playBg = isLight ? "#2E7D32" : "#4CAF50";

  const stats = [
    { label: "Séries", value: sets },
    { label: "Reps", value: reps },
    ...(load ? [{ label: "Carga", value: load }] : []),
    ...(restTime ? [{ label: "Desc.", value: restTime }] : []),
  ];

  return (
    <MvCard style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        {/* Number */}
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            backgroundColor: numBg,
            borderWidth: 1,
            borderColor: numBorder,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={[typography.badge, { color: numColor, fontSize: 11 }]}>{index}</Text>
        </View>

        {/* Info */}
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[typography.semi2, { color: theme.text1 }]}>{name}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {stats.map((s) => (
              <View
                key={s.label}
                style={{
                  backgroundColor: statBg,
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  minWidth: 38,
                  alignItems: "center",
                }}
              >
                <Text style={[typography.semi3, { color: theme.text1, fontSize: 12 }]}>{s.value}</Text>
                <Text style={[typography.badge, { color: theme.text3, textTransform: "uppercase", letterSpacing: 0.5 }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Video thumb */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={onVideoPress}
          style={{
            width: 50,
            height: 50,
            borderRadius: 10,
            backgroundColor: thumbBg,
            borderWidth: 1,
            borderColor: thumbBorder,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: playBg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#FFF", fontSize: 9 }}>▶</Text>
          </View>
        </TouchableOpacity>
      </View>
    </MvCard>
  );
}
