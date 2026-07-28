import React, { useCallback, useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../../theme/MvThemeContext";
import { C, S } from "../../../theme/v2tokens";

const ONBOARDING_KEY = "@muvify/professionalOnboardingDone";

type Step = {
  id: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  description: string;
  actionLabel: string;
};

const STEPS: Step[] = [
  {
    id: "profile",
    icon: "person-circle-outline",
    title: "Complete seu perfil",
    description: "Adicione foto, bio e especialidades para atrair alunos.",
    actionLabel: "Editar perfil",
  },
  {
    id: "availability",
    icon: "calendar-outline",
    title: "Configure sua disponibilidade",
    description: "Defina os dias e horários em que você atende.",
    actionLabel: "Definir horários",
  },
  {
    id: "cref",
    icon: "document-text-outline",
    title: "Envie seu CREF",
    description: "Valide suas credenciais para desbloquear todos os recursos.",
    actionLabel: "Enviar CREF",
  },
  // Raio-X de pagamentos, Rodada 4, Lote 10: conectar o Mercado Pago já era
  // pré-requisito silencioso pra aparecer na busca (booking.service.ts exige
  // provider.mpAccountId) — sem isso, tudo o resto do onboarding fica sem
  // sentido, porque o profissional nunca recebe agendamento nenhum.
  {
    id: "mercadopago",
    icon: "card-outline",
    title: "Conecte seu Mercado Pago",
    description: "Sem isso você não recebe pelos seus atendimentos, mesmo com o resto do perfil pronto.",
    actionLabel: "Conectar Mercado Pago",
  },
];

interface Props {
  onNavigateProfile: () => void;
  onNavigateAvailability: () => void;
  onNavigateCref: () => void;
  onNavigateMercadoPago: () => void;
}

export function ProfessionalOnboardingWizard({ onNavigateProfile, onNavigateAvailability, onNavigateCref, onNavigateMercadoPago }: Props) {
  const { theme } = useMvTheme();
  const [visible, setVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((done) => { if (!done) setVisible(true); })
      .catch(() => {});
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    void AsyncStorage.setItem(ONBOARDING_KEY, "1").catch(() => {});
  }, []);

  const handleAction = useCallback(() => {
    const step = STEPS[currentStep];
    if (!step) return;
    if (step.id === "profile") onNavigateProfile();
    else if (step.id === "availability") onNavigateAvailability();
    else if (step.id === "cref") onNavigateCref();
    else if (step.id === "mercadopago") onNavigateMercadoPago();
  }, [currentStep, onNavigateCref, onNavigateAvailability, onNavigateProfile, onNavigateMercadoPago]);

  const advance = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      dismiss();
    }
  }, [currentStep, dismiss]);

  if (!visible) return null;

  const step = STEPS[currentStep]!;
  const isLast = currentStep === STEPS.length - 1;

  return (
    <View style={{
      borderRadius: S.cardR, borderWidth: 1,
      borderColor: theme.primarySubtleBorder,
      backgroundColor: "rgba(36,230,109,0.06)",
      padding: 16, gap: 12,
    }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="sparkles-outline" size={14} color={theme.primary} />
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary, letterSpacing: 0.8, textTransform: "uppercase" }}>
            Primeiros passos
          </Text>
        </View>
        <TouchableOpacity
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Dispensar onboarding"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={18} color={theme.text3} />
        </TouchableOpacity>
      </View>

      {/* Step indicators */}
      <View style={{ flexDirection: "row", gap: 6 }}>
        {STEPS.map((s, i) => (
          <View
            key={s.id}
            style={{
              flex: 1, height: 3, borderRadius: 99,
              backgroundColor: i <= currentStep ? theme.primary : (theme.mode === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)"),
            }}
          />
        ))}
      </View>

      {/* Step content */}
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View style={{
          width: 44, height: 44, borderRadius: 14,
          backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder,
          alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <Ionicons name={step.icon} size={20} color={theme.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>
            {`Passo ${currentStep + 1}/${STEPS.length}: ${step.title}`}
          </Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
            {step.description}
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TouchableOpacity
          onPress={handleAction}
          accessibilityRole="button"
          accessibilityLabel={step.actionLabel}
          style={{
            flex: 1, height: 40, borderRadius: 12,
            backgroundColor: theme.primary,
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>
            {step.actionLabel}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={advance}
          accessibilityRole="button"
          accessibilityLabel={isLast ? "Concluir" : "Próximo passo"}
          style={{
            height: 40, paddingHorizontal: 14, borderRadius: 12,
            borderWidth: 1, borderColor: theme.primarySubtleBorder,
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>
            {isLast ? "Concluir" : "Próximo"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
