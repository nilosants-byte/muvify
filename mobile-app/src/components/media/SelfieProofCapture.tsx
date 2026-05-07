import React, { useMemo, useState } from "react";
import {
  Image,
  Platform,
  View,
  useWindowDimensions,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { CompletionProofInput } from "../../services/api/client";
import { theme } from "../../theme";
import { AppButton } from "../ui/AppButton";
import { AppCard } from "../ui/AppCard";
import { AppText } from "../ui/AppText";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

const SELFIE_ASPECT_RATIO = 3 / 4;
const PREVIEW_MAX_WIDTH = 320;

type Props = {
  value: CompletionProofInput | null;
  disabled?: boolean;
  onChange: (value: CompletionProofInput) => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
};

function normalizeMimeType(mimeType?: string | null) {
  if (!mimeType) return "image/jpeg";
  const lower = mimeType.toLowerCase();
  if (["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(lower)) {
    return lower as CompletionProofInput["mimeType"];
  }
  return "image/jpeg";
}

export function SelfieProofCapture({
  value,
  disabled = false,
  onChange,
  showToast,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    wrapper: {
      gap: theme.spacing.sm,
      alignItems: "center",
    },
    inlineActions: {
      alignItems: "center",
    },
    captureCtaWrap: {
      alignItems: "center",
    },
    statusText: {
      marginTop: theme.spacing.xs,
    },
    previewWrap: {
      marginTop: theme.spacing.xs,
      alignItems: "center",
      gap: theme.spacing.sm,
      width: "100%",
    },
    preview: {
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: palette.border,
    },
    previewActions: {
      width: "100%",
    },
    previewActionsRow: {
      flexDirection: "row",
      gap: theme.spacing.sm,
    },
    previewActionsStacked: {
      flexDirection: "column",
      gap: theme.spacing.sm,
    },
    actionFlex: {
      flex: 1,
    },
  }));
  const [cameraFacing, setCameraFacing] =
    useState<CompletionProofInput["cameraFacing"]>("FRONT");
  const [draftProof, setDraftProof] = useState<CompletionProofInput | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const { width: screenWidth } = useWindowDimensions();

  // Largura responsiva com base na tela, respeitando padding e máximo
  const previewWidth = Math.min(
    screenWidth - theme.layout.screenHorizontalPadding * 2 - theme.spacing.lg * 2,
    PREVIEW_MAX_WIDTH
  );
  const previewHeight = Math.round(previewWidth / SELFIE_ASPECT_RATIO);
  const useStackedActions = screenWidth <= 360;

  const savedLabel = useMemo(() => {
    if (draftProof) return "Selfie pronta para salvar";
    if (!value) return "Selfie obrigatória ainda não salva";
    return "Selfie salva como evidência";
  }, [draftProof, value]);

  async function captureProof() {
    try {
      setBusy(true);
      if (Platform.OS !== "web") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (permission.status !== "granted") {
          showToast("Permissão de câmera negada.", "error");
          return;
        }
      }
      const result =
        Platform.OS === "web"
          ? await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.5,
              base64: true,
            })
          : await ImagePicker.launchCameraAsync({
              cameraType:
                cameraFacing === "FRONT"
                  ? ImagePicker.CameraType.front
                  : ImagePicker.CameraType.back,
              allowsEditing: false,
              quality: 0.5,
              base64: true,
            });

      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) {
        showToast("Falha ao capturar selfie.", "error");
        return;
      }
      setPreviewUri(asset.uri ?? null);
      setDraftProof({
        imageBase64: asset.base64,
        mimeType: normalizeMimeType(asset.mimeType),
        cameraFacing,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha ao abrir a câmera.";
      showToast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draftProof) {
      showToast("Tire uma selfie antes de salvar.", "error");
      return;
    }
    try {
      setSaving(true);
      await Promise.resolve(onChange(draftProof));
      showToast("Selfie salva como evidência.", "success");
    } catch {
      showToast("Erro ao salvar a selfie. Tente novamente.", "error");
    } finally {
      setSaving(false);
    }
  }

  const hasPreview = Boolean(previewUri);

  return (
    <AppCard elevated style={styles.wrapper}>
      <AppText align="center" variant="bodyStrong">
        Confirmação por selfie
      </AppText>

      {Platform.OS === "web" ? (
        <AppText
          align="center"
          color={colors.textSecondary}
          variant="caption"
        >
          No navegador, selecione uma foto da galeria
        </AppText>
      ) : null}

      {/* Botão de alternar câmera (só quando não há preview) */}
      {!hasPreview && Platform.OS !== "web" ? (
        <View style={styles.inlineActions}>
          <AppButton
            disabled={disabled || busy}
            fullWidth={false}
            iconLeft="flip-camera-ios"
            title={`Câmera ${cameraFacing === "FRONT" ? "frontal" : "traseira"}`}
            variant="ghost"
            onPress={() =>
              setCameraFacing((c) => (c === "FRONT" ? "BACK" : "FRONT"))
            }
          />
        </View>
      ) : null}

      {/* CTA de captura */}
      {!hasPreview ? (
        <View style={styles.captureCtaWrap}>
          <AppButton
            disabled={disabled || busy}
            fullWidth={false}
            loading={busy}
            title="Tá pago! Tirar selfie"
            variant="secondary"
            onPress={() => void captureProof()}
          />
        </View>
      ) : null}

      {/* Label de status */}
      <AppText
        align="center"
        color={draftProof || value ? colors.primary : colors.warning}
        style={styles.statusText}
        variant="captionStrong"
      >
        {savedLabel}
      </AppText>

      {/* Preview + ações */}
      {hasPreview && previewUri ? (
        <View style={styles.previewWrap}>
          <Image
            accessibilityLabel="Prévia da selfie capturada"
            accessibilityRole="image"
            resizeMode="cover"
            source={{ uri: previewUri }}
            style={[styles.preview, { width: previewWidth, height: previewHeight }]}
          />
          <View
            style={[
              styles.previewActions,
              useStackedActions
                ? styles.previewActionsStacked
                : styles.previewActionsRow,
            ]}
          >
            <AppButton
              accessibilityLabel="Salvar"
              disabled={disabled || busy || saving || !draftProof}
              fullWidth={useStackedActions}
              loading={saving}
              style={useStackedActions ? undefined : styles.actionFlex}
              title="Salvar selfie"
              onPress={saveDraft}
            />
            <AppButton
              disabled={disabled || busy || saving}
              fullWidth={useStackedActions}
              loading={busy}
              style={useStackedActions ? undefined : styles.actionFlex}
              title="Tentar novamente"
              variant="secondary"
              onPress={() => {
                setDraftProof(null);
                setPreviewUri(null);
                void captureProof();
              }}
            />
          </View>
        </View>
      ) : null}
    </AppCard>
  );
}
