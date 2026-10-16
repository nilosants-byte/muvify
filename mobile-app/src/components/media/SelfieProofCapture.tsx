import React, { useMemo, useState } from "react";
import { Image, Platform, View, useWindowDimensions } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { CompletionProofInput } from "../../services/api/client";
import { MvButton } from "../mv/MvButton";
import { MvCard } from "../mv/MvCard";
import { MvText } from "../mv/MvText";
import { C, S } from "../../theme/v2tokens";
import { useMvTheme } from "../../theme/MvThemeContext";
import { captureException } from "../../observability/sentry";

const SELFIE_ASPECT_RATIO = 3 / 4;
const PREVIEW_MAX_WIDTH = 320;
const SCREEN_H_PAD = 24;

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
  const { theme } = useMvTheme();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<CompletionProofInput["cameraFacing"]>("FRONT");
  const [draftProof, setDraftProof] = useState<CompletionProofInput | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const { width: screenWidth } = useWindowDimensions();

  const previewWidth = Math.min(screenWidth - SCREEN_H_PAD * 2, PREVIEW_MAX_WIDTH);
  const previewHeight = Math.round(previewWidth / SELFIE_ASPECT_RATIO);
  // Sempre empilhado: lado a lado, "Tentar novamente" (rótulo mais longo que
  // "Salvar selfie") era cortado pelo numberOfLines={1} do MvButton em
  // qualquer largura de tela comum — só telas bem estreitas (<=360) tinham
  // espaço reservado pra isso antes, mas o problema também aparecia em
  // telas maiores.
  const useStackedActions = true;

  const savedLabel = useMemo(() => {
    if (draftProof) return "Selfie pronta para salvar";
    if (!value) return "Selfie obrigatória ainda não salva";
    return "Selfie salva como evidência";
  }, [draftProof, value]);

  const statusColor = draftProof || value ? theme.primary : "#F59E0B";

  async function captureProof() {
    try {
      setBusy(true);
      if (Platform.OS !== "web") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (permission.status !== "granted") {
          showToast("Permissão de câmera negada. Vá em Configurações > Privacidade > Câmera para permitir o acesso.", "error");
          return;
        }
      }
      const result =
        Platform.OS === "web"
          ? await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"] as ImagePicker.MediaType[],
              quality: 0.5,
              base64: true,
            })
          : await ImagePicker.launchCameraAsync({
              cameraType: (cameraFacing === "FRONT" ? "front" : "back") as ImagePicker.CameraType,
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
      // base64 de ~6MB em texto ≈ 8MB de dados — limite conservador de 7MB
      if (asset.base64.length > 7_000_000) {
        showToast("Imagem muito grande. Tente com resolução menor.", "error");
        return;
      }
      setPreviewUri(asset.uri ?? null);
      setDraftProof({
        imageBase64: asset.base64,
        mimeType: normalizeMimeType(asset.mimeType),
        cameraFacing,
      });
    } catch (error) {
      // Frente 13 (segunda camada), Lote 13: captura da selfie de
      // comprovação (gate de liberação de pagamento da sessão) nunca
      // capturava falha — só toast.
      captureException(error, { component: "SelfieProofCapture", action: "captureProof" });
      const message = error instanceof Error ? error.message : "Falha ao abrir a câmera.";
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
      await onChange(draftProof);
      setDraftProof(null);
      setPreviewUri(null);
      showToast("Selfie salva como evidência.", "success");
    } catch (error) {
      captureException(error, { component: "SelfieProofCapture", action: "saveDraft" });
      showToast("Erro ao salvar a selfie. Tente novamente.", "error");
    } finally {
      setSaving(false);
    }
  }

  const hasPreview = Boolean(previewUri);
  // Depois de salvar, draftProof/previewUri são limpos — sem essa flag a
  // tela voltava a mostrar exatamente os mesmos botões de "tirar selfie"
  // de antes, como se nada tivesse sido feito. O cliente não tinha como
  // perceber visualmente que a selfie já foi salva, só por uma legenda
  // pequena (savedLabel) que passava despercebida.
  const hasSavedValue = Boolean(value) && !hasPreview;
  const savedPreviewUri = value ? `data:${value.mimeType};base64,${value.imageBase64}` : null;

  return (
    <MvCard style={{ gap: 12, alignItems: "center" }}>
      <MvText variant="semi2" style={{ textAlign: "center" }}>
        Confirmação por selfie
      </MvText>

      {Platform.OS === "web" ? (
        <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
          No navegador, selecione uma foto da galeria
        </MvText>
      ) : null}

      {!hasPreview && !hasSavedValue && Platform.OS !== "web" ? (
        <MvButton
          variant="ghost"
          label={`Câmera ${cameraFacing === "FRONT" ? "frontal" : "traseira"}`}
          disabled={disabled || busy}
          onPress={() => setCameraFacing((c) => (c === "FRONT" ? "BACK" : "FRONT"))}
          style={{ alignSelf: "center" }}
        />
      ) : null}

      {!hasPreview && !hasSavedValue ? (
        <MvButton
          variant="outline"
          label="Tirar selfie"
          disabled={disabled || busy}
          loading={busy}
          onPress={() => void captureProof()}
          style={{ alignSelf: "center", minWidth: 160 }}
        />
      ) : null}

      <MvText
        variant="caption"
        style={{ textAlign: "center", color: statusColor }}
      >
        {savedLabel}
      </MvText>

      {hasSavedValue && savedPreviewUri ? (
        <View style={{ gap: 10, width: "100%", alignItems: "center" }}>
          <View style={{ position: "relative" }}>
            <Image
              accessibilityLabel="Selfie salva como evidência"
              accessibilityRole="image"
              resizeMode="cover"
              source={{ uri: savedPreviewUri }}
              style={{
                width: previewWidth,
                height: previewHeight,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: theme.primary,
                opacity: 0.9,
              }}
            />
            <View style={{ position: "absolute", top: 8, right: 8, backgroundColor: theme.primary, borderRadius: 14, padding: 2 }}>
              <Ionicons name="checkmark" size={18} color={theme.textOnPrimary} />
            </View>
          </View>
          <MvButton
            variant="ghost"
            label="Tirar outra selfie"
            disabled={disabled || busy}
            loading={busy}
            onPress={() => void captureProof()}
          />
        </View>
      ) : null}

      {hasPreview && previewUri ? (
        <View style={{ gap: 12, width: "100%", alignItems: "center" }}>
          <Image
            accessibilityLabel="Prévia da selfie capturada"
            accessibilityRole="image"
            resizeMode="cover"
            source={{ uri: previewUri }}
            style={{
              width: previewWidth,
              height: previewHeight,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: C.border,
            }}
          />
          <View
            style={{
              width: "100%",
              flexDirection: useStackedActions ? "column" : "row",
              gap: S.gap,
            }}
          >
            <View style={useStackedActions ? undefined : { flex: 1 }}>
              <MvButton
                accessibilityLabel="Salvar selfie"
                label="Salvar selfie"
                disabled={disabled || busy || saving || !draftProof}
                loading={saving}
                onPress={saveDraft}
              />
            </View>
            <View style={useStackedActions ? undefined : { flex: 1 }}>
              <MvButton
                variant="ghost"
                label="Tentar novamente"
                disabled={disabled || busy || saving}
                loading={busy}
                onPress={() => {
                  setDraftProof(null);
                  setPreviewUri(null);
                  void captureProof();
                }}
              />
            </View>
          </View>
        </View>
      ) : null}
    </MvCard>
  );
}
