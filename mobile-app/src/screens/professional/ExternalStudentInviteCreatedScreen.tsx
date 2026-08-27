import React from "react";
import { Share, StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { MvButton, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { useMvTheme } from "../../theme/MvThemeContext";
import { hapticCta } from "../../utils/haptics";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ExternalStudentInviteCreated">;

function inviteDeepLink(inviteToken: string) {
  return `muvify://convite/${inviteToken}`;
}

export function ExternalStudentInviteCreatedScreen({ navigation, route }: Props) {
  const { theme } = useMvTheme();
  const { showToast } = useAppState();
  const { studentName, inviteToken, channel } = route.params;

  async function handleShare() {
    hapticCta();
    try {
      await Share.share({
        message: [
          `${studentName}, você foi convidado(a) para o Muvify!`,
          "",
          "Se já tem o app instalado, abra este link:",
          inviteDeepLink(inviteToken),
          "",
          "Se ainda não tem, baixe o Muvify e use este código de convite ao entrar:",
          inviteToken
        ].join("\n"),
        title: "Convite Muvify"
      });
    } catch {
      showToast("Não foi possível abrir o compartilhamento.", "error");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.external-student-invite-created">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <View style={{ paddingTop: 64, paddingHorizontal: 20, alignItems: "center", gap: 16 }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: theme.primarySubtle,
            borderWidth: 1,
            borderColor: theme.primarySubtleBorder,
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Ionicons name="checkmark-circle" size={34} color={theme.primary} />
        </View>
        <MvText variant="display" style={{ textAlign: "center" }}>Convite criado!</MvText>
        <MvText variant="body3" color="secondary" style={{ textAlign: "center", lineHeight: 20, maxWidth: 280 }}>
          Envie o link pra {studentName}. Assim que ela confirmar, a ficha de treino já fica liberada pra você entregar.
        </MvText>

        <View
          style={{
            width: "100%",
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.cardBg,
            gap: 12
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: theme.primarySubtle,
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <MvText variant="semi3" style={{ color: theme.primary }}>
                {studentName.trim().slice(0, 2).toUpperCase()}
              </MvText>
            </View>
            <View>
              <MvText variant="semi3">{studentName}</MvText>
              <MvText variant="caption" style={{ color: theme.text3, marginTop: 1 }}>
                {channel === "WHATSAPP" ? "Convite por WhatsApp" : "Convite por e-mail"}
              </MvText>
            </View>
          </View>
          <View
            style={{
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: theme.inputBorder,
              borderRadius: 11,
              backgroundColor: theme.inputBg,
              paddingVertical: 11,
              alignItems: "center"
            }}
          >
            <MvText variant="caption" style={{ color: theme.text3 }}>CÓDIGO DO CONVITE</MvText>
            <MvText variant="h3" style={{ letterSpacing: 3, marginTop: 2 }}>{inviteToken}</MvText>
          </View>
        </View>

        <MvButton
          label="Compartilhar convite"
          icon="share-outline"
          onPress={() => void handleShare()}
          style={{ width: "100%" }}
          testID="button.external-student-invite-created.share"
        />
        <PressableScale
          scale={0.98}
          onPress={() => navigation.navigate("ProfessionalStudents")}
          style={{
            width: "100%",
            borderRadius: 16,
            paddingVertical: 14,
            alignItems: "center",
            borderWidth: 1,
            borderColor: theme.borderMid
          }}
          testID="button.external-student-invite-created.view-students"
        >
          <MvText variant="semi2">Ver meus alunos</MvText>
        </PressableScale>

        <View
          style={{
            width: "100%",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            borderRadius: 16,
            padding: 12,
            borderWidth: 1,
            borderColor: theme.warningSubtleBorder,
            backgroundColor: theme.warningSubtle
          }}
        >
          <Ionicons name="time-outline" size={14} color={theme.warning} />
          <MvText variant="caption" style={{ color: theme.warning, flex: 1 }}>
            Aguardando {studentName} confirmar o vínculo
          </MvText>
        </View>
      </View>
    </View>
  );
}
