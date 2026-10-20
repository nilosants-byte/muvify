import React from "react";
import { ActivityIndicator, Modal, Text, View } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";
import { S } from "../../theme/v2tokens";

interface MvProcessingModalProps {
  visible: boolean;
  title: string;
  message?: string;
}

// Achado no teste manual do checklist (C6.3): em ações que deixam o usuário
// esperando (agendar, contratar, cancelar...), só o texto do botão mudava —
// dava a impressão de que nada tinha acontecido, levando a sair da tela ou
// tocar de novo (pedido duplicado). Janela no centro, por cima de tudo, que
// também bloqueia toques até a ação terminar. Mesmo visual da que já existia
// no detalhe do agendamento.
export function MvProcessingModal({ visible, title, message = "Aguarde um instante, não feche o app." }: MvProcessingModalProps) {
  const { theme } = useMvTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={title}
          style={{ backgroundColor: theme.cardBg, borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, padding: 24, alignItems: "center", gap: 14, width: "100%", maxWidth: 320 }}
        >
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, textAlign: "center" }}>{title}</Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center" }}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
}
