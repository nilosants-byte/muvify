import React, { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { providersApi, ProviderCredentials, ProviderCredentialsDocument } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { formatBRDate } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalCredentials">;

type AttachedDoc = { name: string; uri: string; mimeType: string };

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
      // Restore previously saved docs: first = frente, second = verso
      const docs = data.credentials ?? [];
      if (docs[0]) setFrontDoc({ name: docs[0].name, uri: docs[0].uri, mimeType: docs[0].mimeType ?? "application/octet-stream" });
      if (docs[1]) setBackDoc({ name: docs[1].name, uri: docs[1].uri, mimeType: docs[1].mimeType ?? "application/octet-stream" });
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar credenciais.", navigation });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

  function applyPickedDoc(side: "front" | "back", doc: AttachedDoc) {
    if (side === "front") {
      setFrontDoc(doc);
    } else {
      setBackDoc(doc);
    }
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
      if (isFileTooLarge(asset.size)) {
        showToast("O arquivo deve ter no m\u00e1ximo 5MB.", "error");
        return;
      }
      const doc: AttachedDoc = {
        name: asset.name,
        uri: asset.uri,
        mimeType: asset.mimeType ?? "application/octet-stream",
      };
      applyPickedDoc(side, doc);
    } catch {
      showToast("Falha ao selecionar o arquivo.", "error");
    }
  }

  async function pickFromGallery(side: "front" | "back") {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast("Permita acesso \u00e0 galeria para anexar imagem.", "error");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      if (isFileTooLarge(asset.fileSize)) {
        showToast("A imagem deve ter no m\u00e1ximo 5MB.", "error");
        return;
      }

      const fallbackName = side === "front" ? "cref-frente.jpg" : "cref-verso.jpg";
      const doc: AttachedDoc = {
        name: asset.fileName ?? fallbackName,
        uri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
      };
      applyPickedDoc(side, doc);
    } catch {
      showToast("Falha ao selecionar o documento.", "error");
    }
  }

  function chooseDocumentSource(side: "front" | "back") {
    Alert.alert(
      "Selecionar documento",
      "Como voc\u00ea quer anexar este lado do CREF?",
      [
        { text: "Galeria", onPress: () => void pickFromGallery(side) },
        { text: "Arquivo", onPress: () => void pickFromFile(side) },
        { text: "Cancelar", style: "cancel" },
      ]
    );
  }

  async function handleSave() {
    if (!crefNumber.trim()) { showToast("Informe o n\u00famero do CREF.", "error"); return; }

    const existingDocs: ProviderCredentialsDocument[] = credentials?.credentials ?? [];
    const hasFront = frontDoc || existingDocs[0];
    const hasBack = backDoc || existingDocs[1];

    if (!hasFront) {
      showToast("Anexe a frente do documento do CREF.", "error");
      return;
    }
    if (!hasBack) {
      showToast("Anexe o verso do documento do CREF.", "error");
      return;
    }

    try {
      setSaving(true);

      const frontEntry: ProviderCredentialsDocument = frontDoc
        ? { name: frontDoc.name, uri: frontDoc.uri, mimeType: frontDoc.mimeType }
        : { name: existingDocs[0].name, uri: existingDocs[0].uri, mimeType: existingDocs[0].mimeType };

      const backEntry: ProviderCredentialsDocument = backDoc
        ? { name: backDoc.name, uri: backDoc.uri, mimeType: backDoc.mimeType }
        : { name: existingDocs[1].name, uri: existingDocs[1].uri, mimeType: existingDocs[1].mimeType };

      const credentialDocs: ProviderCredentialsDocument[] = [frontEntry, backEntry];

      const updated = await runWithAuth((token) =>
        providersApi.upsertMyCredentials(token, {
          crefNumber: crefNumber.trim(),
          credentials: credentialDocs,
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

  const statusBadge = (() => {
    if (currentStatus === "APPROVED") return { label: "Aprovado", variant: "green" as const };
    if (currentStatus === "IN_REVIEW") return { label: "Em an\u00e1lise", variant: "blue" as const };
    if (currentStatus === "REJECTED") return { label: "Reprovado", variant: "red" as const };
    return { label: "Pendente", variant: "orange" as const };
  })();

  function DocSlot({
    label,
    doc,
    side,
  }: {
    label: string;
    doc: AttachedDoc | null;
    side: "front" | "back";
  }) {
    return (
      <View>
        <MvText variant="semi3" style={{ marginBottom: 6 }}>{label}</MvText>
        {doc ? (
          <View style={{
            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            padding: 10, borderRadius: 10, borderWidth: 1,
            borderColor: "rgba(34,197,94,0.30)", backgroundColor: "rgba(34,197,94,0.08)"
          }}>
            <View style={{ flex: 1 }}>
              <MvText variant="semi3" style={{ color: theme.textGreen }} numberOfLines={1}>
                {doc.name}
              </MvText>
              <MvText variant="body4" color="secondary">Arquivo selecionado</MvText>
            </View>
            <TouchableOpacity onPress={() => chooseDocumentSource(side)} style={{ paddingLeft: 8 }}>
              <MvText variant="body4" style={{ color: theme.textGreen }}>Trocar</MvText>
            </TouchableOpacity>
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
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="semi1">CREF e Documentos</MvText>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        <MvText variant="body4" color="secondary">
          {"Sua certifica\u00e7\u00e3o precisa ser validada para oferecer servi\u00e7os."}
        </MvText>

        {/* Status */}
        <MvCard>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <MvText variant="semi2">{"Status da valida\u00e7\u00e3o"}</MvText>
            <MvBadge label={statusBadge.label} variant={statusBadge.variant} />
          </View>
          {isApproved && credentials?.crefValidatedAt ? (
            <MvText variant="body4" color="secondary">
              Aprovado em {formatBRDate(credentials.crefValidatedAt)}
            </MvText>
          ) : currentStatus === "IN_REVIEW" ? (
            <MvText variant="body4" color="secondary">
              {"Seu CREF est\u00e1 em an\u00e1lise pela equipe administrativa."}
            </MvText>
          ) : currentStatus === "REJECTED" ? (
            <MvText variant="body4" color="secondary">
              {"Seu CREF foi reprovado. Atualize os documentos para nova an\u00e1lise."}
            </MvText>
          ) : (
            <MvText variant="body4" color="secondary">
              {"Envie frente e verso do CREF para avan\u00e7ar para an\u00e1lise."}
            </MvText>
          )}
          {credentials?.crefRejectionReason ? (
            <MvText variant="body4" color="danger" style={{ marginTop: 8 }}>
              {"Motivo da reprova\u00e7\u00e3o:"} {credentials.crefRejectionReason}
            </MvText>
          ) : null}
        </MvCard>

        {hasOnlyOneSide ? (
          <MvCard>
            <MvText variant="body4" color="warning">
              {"Falta anexar o outro lado do CREF (frente e verso s\u00e3o obrigat\u00f3rios)."}
            </MvText>
          </MvCard>
        ) : null}

        {loading ? (
          <MvText variant="body4" color="secondary">Carregando...</MvText>
        ) : (
          <>
            <MvCard>
              <View style={{ gap: 12 }}>
                <MvInput
                  autoCapitalize="characters"
                  placeholder={"N\u00famero do CREF (Ex.: 123456-G/SP)"}
                  value={crefNumber}
                  onChangeText={setCrefNumber}
                />

                {/* Frente do CREF */}
                <DocSlot label="Frente do CREF" doc={frontDoc} side="front" />

                {/* Verso do CREF */}
                <DocSlot label="Verso do CREF" doc={backDoc} side="back" />

                <MvText variant="body4" color="secondary">
                  {"Aceito: PDF, JPEG, PNG. M\u00e1ximo 5MB por arquivo."}
                </MvText>
              </View>
            </MvCard>

            <MvCard>
              <MvText variant="semi3" style={{ marginBottom: 4 }}>Como funciona?</MvText>
              <MvText variant="body4" color="secondary">
                {"Ap\u00f3s salvar, nossa equipe revisa os dados em at\u00e9 2 dias \u00fateis. Voc\u00ea receber\u00e1 uma notifica\u00e7\u00e3o quando o CREF for validado."}
              </MvText>
            </MvCard>

            <MvButton label="Salvar credenciais" loading={saving} onPress={() => void handleSave()} />
          </>
        )}
      </ScrollView>
    </View>
  );
}





