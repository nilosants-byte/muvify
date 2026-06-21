import React, { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, ScrollView, StatusBar, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { providersApi, ProviderCredentials, ProviderCredentialsDocument } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { formatBRDate } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalCredentials">;
type AttachedDoc = { name: string; uri: string; mimeType: string };

// Barra de progresso de 3 etapas do CREF
function CrefProgressBar({ status }: { status: string }) {
  const { theme } = useMvTheme();
  const green = theme.textGreen;
  const steps = [
    { label: "Enviar docs", done: status !== "PENDING" || false },
    { label: "Em análise", done: status === "APPROVED" || status === "REJECTED" },
    { label: "Aprovado", done: status === "APPROVED" },
  ];
  const activeIndex =
    status === "PENDING" ? 0 :
    status === "IN_REVIEW" ? 1 :
    status === "REJECTED" ? 1 :
    2;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 0, marginBottom: 4 }}>
      {steps.map((step, i) => {
        const isDone = step.done;
        const isActive = i === activeIndex;
        const isRejected = status === "REJECTED" && i === 1;
        const color = isRejected ? theme.danger : (isDone || isActive) ? green : theme.text3;
        return (
          <React.Fragment key={step.label}>
            <View style={{ alignItems: "center", flex: 1 }}>
              <View style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: isRejected
                  ? "rgba(239,68,68,0.14)"
                  : (isDone || isActive) ? "rgba(34,197,94,0.14)" : theme.chipBg,
                borderWidth: 1.5,
                borderColor: isRejected ? theme.danger : (isDone || isActive) ? green : theme.border,
                alignItems: "center", justifyContent: "center",
              }}>
                {isDone && !isRejected
                  ? <Ionicons name="checkmark" size={14} color={green} />
                  : isRejected
                    ? <Ionicons name="close" size={14} color={theme.danger} />
                    : <MvText style={{ fontSize: 11, fontFamily: "DMSans_700Bold", color }}>{i + 1}</MvText>
                }
              </View>
              <MvText style={{ fontSize: 10, color, marginTop: 4, fontFamily: "DMSans_500Medium", textAlign: "center" }}>
                {step.label}
              </MvText>
            </View>
            {i < steps.length - 1 ? (
              <View style={{
                height: 2, flex: 1, marginBottom: 18,
                backgroundColor: step.done ? green : theme.border,
                borderRadius: 1,
              }} />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

// Card de status com ícone grande e contexto visual
function StatusHeroCard({ status, credentials }: { status: string; credentials: ProviderCredentials | null }) {
  const { theme } = useMvTheme();

  const config = {
    APPROVED: {
      icon: "checkmark-circle" as const,
      color: theme.textGreen,
      bg: "rgba(34,197,94,0.10)" as const,
      border: "rgba(34,197,94,0.22)" as const,
      title: "CREF aprovado",
      body: credentials?.crefValidatedAt
        ? `Validado em ${formatBRDate(credentials.crefValidatedAt)}. Você pode oferecer serviços no app.`
        : "Sua certificação está validada. Você pode oferecer serviços no app.",
    },
    IN_REVIEW: {
      icon: "time-outline" as const,
      color: "#F59E0B",
      bg: "rgba(245,158,11,0.10)" as const,
      border: "rgba(245,158,11,0.22)" as const,
      title: "Em análise",
      body: "Nossa equipe está revisando seus documentos. Você receberá uma notificação em até 2 dias úteis.",
    },
    REJECTED: {
      icon: "close-circle" as const,
      color: theme.danger,
      bg: "rgba(239,68,68,0.10)" as const,
      border: "rgba(239,68,68,0.22)" as const,
      title: "Documentos reprovados",
      body: credentials?.crefRejectionReason
        ? `Motivo: ${credentials.crefRejectionReason}. Corrija e envie novamente.`
        : "Seus documentos foram reprovados. Corrija os dados e envie novamente.",
    },
    PENDING: {
      icon: "document-text-outline" as const,
      color: theme.text3,
      bg: theme.chipBg as string,
      border: theme.border as string,
      title: "Documentação pendente",
      body: "Envie o número do CREF e os dois lados do documento para iniciar a análise.",
    },
  };

  const c = config[status as keyof typeof config] ?? config.PENDING;

  return (
    <View style={{
      borderRadius: 16, borderWidth: 1,
      borderColor: c.border, backgroundColor: c.bg,
      padding: 16, flexDirection: "row", alignItems: "center", gap: 14,
    }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: `${c.color}18`, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Ionicons name={c.icon} size={28} color={c.color} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <MvText variant="semi2" style={{ color: c.color }}>{c.title}</MvText>
        <MvText variant="body4" color="secondary" style={{ lineHeight: 18 }}>{c.body}</MvText>
      </View>
    </View>
  );
}

export function ProfessionalCredentialsScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [credentials, setCredentials] = useState<ProviderCredentials | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [crefNumber, setCrefNumber] = useState("");
  const [frontDoc, setFrontDoc] = useState<AttachedDoc | null>(null);
  const [backDoc, setBackDoc] = useState<AttachedDoc | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await runWithAuth((token) => providersApi.myCredentials(token)) as ProviderCredentials;
      setCredentials(data);
      setCrefNumber(data.crefNumber ?? "");
      const docs = data.credentials ?? [];
      if (docs[0]) setFrontDoc({ name: docs[0].name, uri: docs[0].uri, mimeType: docs[0].mimeType ?? "application/octet-stream" });
      if (docs[1]) setBackDoc({ name: docs[1].name, uri: docs[1].uri, mimeType: docs[1].mimeType ?? "application/octet-stream" });
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar credenciais.", navigation });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function applyPickedDoc(side: "front" | "back", doc: AttachedDoc) {
    if (side === "front") setFrontDoc(doc);
    else setBackDoc(doc);
    showToast("Documento selecionado.", "success");
  }

  function isFileTooLarge(size?: number | null) {
    return Boolean(size && size > 5 * 1024 * 1024);
  }

  async function pickFromFile(side: "front" | "back") {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      if (isFileTooLarge(asset.size)) { showToast("O arquivo deve ter no máximo 5MB.", "error"); return; }
      applyPickedDoc(side, { name: asset.name, uri: asset.uri, mimeType: asset.mimeType ?? "application/octet-stream" });
    } catch {
      showToast("Falha ao selecionar o arquivo.", "error");
    }
  }

  async function pickFromGallery(side: "front" | "back") {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { showToast("Permita acesso à galeria para anexar imagem.", "error"); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      if (isFileTooLarge(asset.fileSize)) { showToast("A imagem deve ter no máximo 5MB.", "error"); return; }
      const fallbackName = side === "front" ? "cref-frente.jpg" : "cref-verso.jpg";
      applyPickedDoc(side, { name: asset.fileName ?? fallbackName, uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" });
    } catch {
      showToast("Falha ao selecionar o documento.", "error");
    }
  }

  function chooseDocumentSource(side: "front" | "back") {
    Alert.alert("Selecionar documento", "Como você quer anexar este lado do CREF?", [
      { text: "Galeria", onPress: () => void pickFromGallery(side) },
      { text: "Arquivo", onPress: () => void pickFromFile(side) },
      { text: "Cancelar", style: "cancel" },
    ]);
  }

  async function handleSave() {
    if (!crefNumber.trim()) { showToast("Informe o número do CREF.", "error"); return; }
    const existingDocs: ProviderCredentialsDocument[] = credentials?.credentials ?? [];
    const hasFront = frontDoc || existingDocs[0];
    const hasBack = backDoc || existingDocs[1];
    if (!hasFront) { showToast("Anexe a frente do documento do CREF.", "error"); return; }
    if (!hasBack) { showToast("Anexe o verso do documento do CREF.", "error"); return; }

    try {
      setSaving(true);
      const frontEntry: ProviderCredentialsDocument = frontDoc
        ? { name: frontDoc.name, uri: frontDoc.uri, mimeType: frontDoc.mimeType }
        : { name: existingDocs[0].name, uri: existingDocs[0].uri, mimeType: existingDocs[0].mimeType };
      const backEntry: ProviderCredentialsDocument = backDoc
        ? { name: backDoc.name, uri: backDoc.uri, mimeType: backDoc.mimeType }
        : { name: existingDocs[1].name, uri: existingDocs[1].uri, mimeType: existingDocs[1].mimeType };
      const updated = await runWithAuth((token) =>
        providersApi.upsertMyCredentials(token, {
          crefNumber: crefNumber.trim(),
          credentials: [frontEntry, backEntry],
        })
      ) as ProviderCredentials;
      setCredentials(updated);
      showToast("Credenciais salvas com sucesso.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar credenciais.", navigation });
    } finally {
      setSaving(false);
    }
  }

  const currentStatus = credentials?.crefValidationStatus ?? "PENDING";
  const isApproved = currentStatus === "APPROVED";
  const hasFrontDoc = Boolean(frontDoc || credentials?.credentials?.[0]);
  const hasBackDoc = Boolean(backDoc || credentials?.credentials?.[1]);
  const hasOnlyOneSide = (hasFrontDoc || hasBackDoc) && !(hasFrontDoc && hasBackDoc);

  function DocSlot({ label, doc, side }: { label: string; doc: AttachedDoc | null; side: "front" | "back" }) {
    return (
      <View style={{ gap: 6 }}>
        <MvText variant="semi3">{label}</MvText>
        {doc ? (
          <View style={{
            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            padding: 12, borderRadius: 12, borderWidth: 1,
            borderColor: "rgba(34,197,94,0.30)", backgroundColor: "rgba(34,197,94,0.08)",
          }}>
            <View style={{ flex: 1, gap: 2 }}>
              <MvText variant="semi3" style={{ color: theme.textGreen }} numberOfLines={1}>{doc.name}</MvText>
              <MvText variant="body4" color="secondary">Arquivo selecionado</MvText>
            </View>
            <PressableScale scale={0.94} onPress={() => chooseDocumentSource(side)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(34,197,94,0.12)" }}>
              <MvText variant="badge" style={{ color: theme.textGreen, letterSpacing: 0, fontSize: 12 }}>Trocar</MvText>
            </PressableScale>
          </View>
        ) : (
          <MvButton variant="outline" label="Anexar (PDF ou imagem)" onPress={() => chooseDocumentSource(side)} />
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader title="CREF e Documentos" onBack={() => navigation.goBack()} />

      <ScreenEntrance>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Math.max(40, insets.bottom + 24), gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Barra de progresso */}
        <CrefProgressBar status={loading ? "PENDING" : currentStatus} />

        {/* Card de status hero */}
        <StatusHeroCard status={loading ? "PENDING" : currentStatus} credentials={credentials} />

        {/* Aviso lado faltando */}
        {!loading && hasOnlyOneSide ? (
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 10,
            borderRadius: 12, borderWidth: 1,
            borderColor: "rgba(245,158,11,0.30)", backgroundColor: "rgba(245,158,11,0.08)",
            padding: 12,
          }}>
            <Ionicons name="warning-outline" size={18} color="#F59E0B" />
            <MvText variant="body4" style={{ flex: 1, color: "#F59E0B", lineHeight: 18 }}>
              Falta anexar o outro lado do CREF — frente e verso são obrigatórios.
            </MvText>
          </View>
        ) : null}

        {/* Formulário */}
        {loading ? (
          <View style={{ gap: 10 }}>
            {[80, 56, 56].map((h, i) => (
              <View key={i} style={{ height: h, borderRadius: 12, backgroundColor: theme.chipBg }} />
            ))}
          </View>
        ) : (
          <>
            <MvCard style={{ gap: 14 }}>
              <MvInput
                autoCapitalize="characters"
                placeholder="Número do CREF (Ex.: 123456-G/SP)"
                value={crefNumber}
                onChangeText={setCrefNumber}
              />
              <DocSlot label="Frente do CREF" doc={frontDoc} side="front" />
              <DocSlot label="Verso do CREF" doc={backDoc} side="back" />
              <MvText variant="body4" color="secondary">Aceito: PDF, JPEG, PNG. Máximo 5MB por arquivo.</MvText>
            </MvCard>

            {!isApproved ? (
              <MvButton label="Salvar e enviar para análise" loading={saving} onPress={() => void handleSave()} />
            ) : null}
          </>
        )}
      </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
