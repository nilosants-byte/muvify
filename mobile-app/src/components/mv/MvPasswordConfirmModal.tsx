import React, { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";
import { radius } from "../../theme/MvTypography";
import { MvButton } from "./MvButton";
import { MvInput } from "./MvInput";
import { MvText } from "./MvText";

interface MvPasswordConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (password: string) => void;
}

// Cross-platform replacement for Alert.prompt, which only exists on iOS —
// on Android it silently does nothing, leaving the caller with no way to
// collect a password confirmation.
export function MvPasswordConfirmModal({
  visible,
  title,
  message,
  confirmLabel = "Confirmar",
  loading = false,
  onCancel,
  onConfirm,
}: MvPasswordConfirmModalProps) {
  const { theme } = useMvTheme();
  const [password, setPassword] = useState("");

  function handleCancel() {
    setPassword("");
    onCancel();
  }

  function handleConfirm() {
    if (!password) return;
    onConfirm(password);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 }}
        onPress={handleCancel}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View
              style={{
                width: "100%",
                borderRadius: radius.xl,
                padding: 20,
                backgroundColor: theme.cardBg,
                borderWidth: 1,
                borderColor: theme.border,
                gap: 14,
              }}
            >
              <View style={{ gap: 4 }}>
                <MvText variant="semi2">{title}</MvText>
                <MvText variant="body4" color="secondary">{message}</MvText>
              </View>

              <MvInput
                placeholder="Sua senha"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoFocus
                autoCapitalize="none"
              />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <MvButton variant="ghost" label="Cancelar" onPress={handleCancel} style={{ flex: 1 }} />
                <MvButton
                  variant="danger"
                  label={confirmLabel}
                  onPress={handleConfirm}
                  loading={loading}
                  disabled={!password}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
