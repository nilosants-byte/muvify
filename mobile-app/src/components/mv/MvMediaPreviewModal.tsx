import React from "react";
import { Modal, Pressable, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ExerciseMediaType } from "../../services/api/client";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvText } from "./MvText";
import { MvMediaViewer } from "./MvMediaViewer";

type Props = {
  visible: boolean;
  onClose: () => void;
  mediaUrl: string | null | undefined;
  mediaType: ExerciseMediaType | null | undefined;
  title?: string;
  // "vertical" pros vídeos de exercício (YouTube Shorts, 9:16). Default
  // "horizontal" preserva o comportamento original deste modal (extraído de
  // ProfessionalTrainingCreationScreen.tsx, onde só existia vídeo 16:9-ish
  // de apresentação/exercício com miniatura horizontal).
  orientation?: "horizontal" | "vertical";
};

// Extraído do modal de preview de mídia que já existia inline em
// ProfessionalTrainingCreationScreen.tsx — centralizado, fecha ao tocar
// fora, não ocupa a tela inteira. Reaproveitado também em
// MyTrainingScreen.tsx (aluno) em vez da expansão inline que existia lá.
export function MvMediaPreviewModal({ visible, onClose, mediaUrl, mediaType, title, orientation = "horizontal" }: Props) {
  const { theme } = useMvTheme();
  const { width: screenWidth } = useWindowDimensions();

  const isVertical = orientation === "vertical";
  const maxWidth = isVertical ? Math.min(340, screenWidth * 0.82) : 480;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <Pressable onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        <View
          style={{
            width: "100%",
            maxWidth,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.bg,
            padding: 14,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <MvText variant="semi2" style={{ flex: 1 }}>
              {title ?? "Mídia"}
            </MvText>
            <TouchableOpacity
              onPress={onClose}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.chipBg,
                borderWidth: 1,
                borderColor: theme.border,
              }}
            >
              <Ionicons name="close" size={16} color={theme.text2} />
            </TouchableOpacity>
          </View>

          {mediaUrl && mediaType ? (
            isVertical ? (
              <MvMediaViewer mediaUrl={mediaUrl} mediaType={mediaType} aspectRatio={9 / 16} borderRadius={10} />
            ) : (
              <MvMediaViewer mediaUrl={mediaUrl} mediaType={mediaType} height={280} borderRadius={10} />
            )
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
