import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../theme/MvThemeContext";

// Sugestão do Danilo (teste manual C11.2, 22/10/2026): depois de contratar,
// o perfil do personal ficava escondido (a Home travada some com a
// descoberta de propósito). Todo card de profissional que o aluno vê ganha
// este atalho pro perfil. navigate() sobe sozinho até o stack que conhece
// "ProfessionalDetail", então funciona tanto de aba quanto de tela.
export function ViewProviderProfileButton({ providerId }: { providerId?: string | null }) {
  const navigation = useNavigation<any>();
  const { theme } = useMvTheme();
  if (!providerId) return null;
  return (
    <TouchableOpacity
      onPress={() => navigation.navigate("ProfessionalDetail", { professionalId: providerId })}
      activeOpacity={0.75}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Ver perfil do personal"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        alignSelf: "center",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 99,
        borderWidth: 1,
        borderColor: theme.primarySubtleBorder,
        backgroundColor: theme.primarySubtle,
        flexShrink: 0,
      }}
    >
      <Ionicons name="person-circle-outline" size={13} color={theme.primary} />
      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary }}>Ver perfil</Text>
    </TouchableOpacity>
  );
}
