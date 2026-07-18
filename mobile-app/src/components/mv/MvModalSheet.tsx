import React from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../theme/MvThemeContext";
import { PressableScale } from "../polish/PressableScale";
import { MvText } from "./MvText";

interface MvModalSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

// Folha modal full-screen usada pelos formulários de lançamento/edição das
// telas financeiras (Controle Financeiro, Alunos, Histórico, Metas) — um
// único componente reaproveitado em vez de 4 cópias quase idênticas.
export function MvModalSheet({ visible, title, onClose, children }: MvModalSheetProps) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 16, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 10 }}>
            <PressableScale scale={0.92} onPress={onClose} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={18} color={theme.text1} />
            </PressableScale>
            <MvText variant="semi2">{title}</MvText>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
