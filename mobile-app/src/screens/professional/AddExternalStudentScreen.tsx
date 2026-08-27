import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { consultancyApi, ExternalStudentInviteChannel } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useAuthMutation } from "../../hooks/useAuthQuery";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { MvButton, MvInput, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { useMvTheme } from "../../theme/MvThemeContext";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "AddExternalStudent">;

export function AddExternalStudentScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { showToast } = useAppState();
  const [studentName, setStudentName] = useState("");
  const [channel, setChannel] = useState<ExternalStudentInviteChannel>("WHATSAPP");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const createInvite = useAuthMutation(
    (token) =>
      consultancyApi.createExternalStudentInvite(token, {
        studentName: studentName.trim(),
        channel,
        phone: channel === "WHATSAPP" ? phone.trim() : undefined,
        email: channel === "EMAIL" ? email.trim() : undefined
      }),
    {
      onSuccess: (result) => {
        navigation.replace("ExternalStudentInviteCreated", {
          inviteId: result.invite.id,
          studentName: result.invite.studentName,
          inviteToken: result.inviteToken,
          channel: result.invite.channel
        });
      },
      onError: (error) => handleScreenError({ error, showToast, fallbackMessage: "Falha ao gerar o convite." })
    }
  );

  function handleSubmit() {
    if (studentName.trim().length < 2) {
      showToast("Informe o nome do aluno.", "error");
      return;
    }
    if (channel === "WHATSAPP" && phone.trim().length < 8) {
      showToast("Informe o WhatsApp do aluno.", "error");
      return;
    }
    if (channel === "EMAIL" && !email.trim().includes("@")) {
      showToast("Informe um e-mail válido.", "error");
      return;
    }
    createInvite.mutate();
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: theme.bg }}
      testID="screen.professional.add-external-student"
    >
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader
        title="Adicionar aluno"
        subtitle="Já é seu aluno fora do Muvify? Cadastre aqui."
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, paddingTop: 8, gap: 20 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: theme.primarySubtleBorder,
            backgroundColor: theme.primarySubtle,
            flexDirection: "row",
            gap: 10,
            alignItems: "flex-start"
          }}
        >
          <Ionicons name="people-outline" size={18} color={theme.primary} style={{ marginTop: 1 }} />
          <MvText variant="body4" color="secondary" style={{ flex: 1, lineHeight: 19 }}>
            <MvText variant="semi3" style={{ color: theme.text1 }}>Sem cobrança, sem comissão.</MvText>
            {" "}Esse aluno já é seu — o Muvify só disponibiliza a ferramenta pra você criar e enviar a ficha de treino dele.
          </MvText>
        </View>

        <MvInput
          label="NOME DO ALUNO"
          value={studentName}
          onChangeText={setStudentName}
          placeholder="Ex: Mariana Costa"
          testID="input.add-external-student.name"
        />

        <View style={{ gap: 6 }}>
          <MvText variant="caption" style={{ color: theme.labelColor }}>COMO VAMOS AVISAR ELE?</MvText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["WHATSAPP", "EMAIL"] as const).map((option) => {
              const active = channel === option;
              return (
                <PressableScale
                  key={option}
                  scale={0.97}
                  onPress={() => setChannel(option)}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 11,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: active ? theme.primarySubtleBorder : theme.inputBorder,
                    backgroundColor: active ? theme.primarySubtle : theme.inputBg
                  }}
                  testID={`button.add-external-student.channel-${option.toLowerCase()}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <MvText variant="semi3" style={{ fontSize: 13, color: active ? theme.primary : theme.text2 }}>
                    {option === "WHATSAPP" ? "WhatsApp" : "E-mail"}
                  </MvText>
                </PressableScale>
              );
            })}
          </View>
        </View>

        {channel === "WHATSAPP" ? (
          <MvInput
            label="NÚMERO DE WHATSAPP"
            value={phone}
            onChangeText={setPhone}
            placeholder="(11) 90000-0000"
            keyboardType="phone-pad"
            testID="input.add-external-student.phone"
          />
        ) : (
          <MvInput
            label="E-MAIL"
            value={email}
            onChangeText={setEmail}
            placeholder="aluno@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            testID="input.add-external-student.email"
          />
        )}

        <MvButton
          label={createInvite.isPending ? "Gerando..." : "Gerar convite"}
          icon="share-outline"
          loading={createInvite.isPending}
          disabled={createInvite.isPending}
          onPress={handleSubmit}
          testID="button.add-external-student.submit"
        />
        <MvText variant="caption" style={{ color: theme.text3, textAlign: "center", lineHeight: 16 }}>
          Ele vai confirmar o vínculo antes de qualquer coisa ser liberada — nada acontece automaticamente.
        </MvText>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
