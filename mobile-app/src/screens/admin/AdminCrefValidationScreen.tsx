import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  Image,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { adminApi, AdminCrefQueueItem, API_BASE_URL } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { AdminScaffold } from "./AdminScaffold";
import { handleScreenError } from "../shared/api-helpers";

type Props = {
  navigation: any;
};

type QueueStatus = "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED";

const SESSION_SALT = Date.now();

function resolveDocUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith("data:") || uri.startsWith("http")) return uri;
  if (uri.startsWith("/")) return `${API_BASE_URL}${uri}?_s=${SESSION_SALT}`;
  return uri;
}

function isImageUri(uri: string): boolean {
  if (uri.startsWith("data:image/")) return true;
  const lower = uri.toLowerCase();
  return lower.endsWith(".jpg") || lower.endsWith(".jpeg") ||
    lower.endsWith(".png") || lower.endsWith(".webp");
}

function DocViewerModal({
  uri,
  label,
  visible,
  onClose,
  onError,
}: {
  uri: string;
  label: string;
  visible: boolean;
  onClose: () => void;
  onError?: (msg: string) => void;
}) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const isImage = isImageUri(uri);

  async function openExternal() {
    try {
      const resolved = resolveDocUri(uri);
      if (resolved) await Linking.openURL(resolved);
    } catch {
      onError?.("Não foi possível abrir o documento. Verifique sua conexão.");
    }
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {/* Header */}
        <View style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 12,
        }}>
          <MvText variant="semi2" style={{ color: "#fff" }}>{label}</MvText>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <TouchableOpacity onPress={openExternal} style={{ padding: 4 }}>
              <Ionicons name="open-outline" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {isImage ? (
          <Image
            source={{ uri }}
            style={{ flex: 1 }}
            resizeMode="contain"
            onError={() => onError?.("Falha ao carregar a imagem. Tente abrir externamente.")}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
            <Ionicons name="document-outline" size={64} color="rgba(255,255,255,0.5)" />
            <MvText variant="body3" style={{ color: "rgba(255,255,255,0.7)", textAlign: "center" }}>
              {label}
            </MvText>
            <MvText variant="body4" style={{ color: "rgba(255,255,255,0.45)", textAlign: "center" }}>
              Não é possível visualizar este formato diretamente.
            </MvText>
            <TouchableOpacity
              onPress={openExternal}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.3)",
                borderRadius: 10,
                paddingHorizontal: 18,
                paddingVertical: 10,
              }}
            >
              <Ionicons name="open-outline" size={18} color="#fff" />
              <MvText variant="semi3" style={{ color: "#fff" }}>Abrir externamente</MvText>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

function DocButtons({ item }: { item: AdminCrefQueueItem }) {
  const { theme } = useMvTheme();
  const { showToast } = useAppState();
  const [modalUri, setModalUri] = useState<string | null>(null);
  const [modalLabel, setModalLabel] = useState("");

  const frontDoc = item.credentials?.[0];
  const backDoc = item.credentials?.[1];
  const frontUri = resolveDocUri(frontDoc?.uri);
  const backUri = resolveDocUri(backDoc?.uri);

  if (!frontUri && !backUri) return null;

  function open(uri: string, label: string) {
    setModalUri(uri);
    setModalLabel(label);
  }

  return (
    <>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
        {frontUri ? (
          <TouchableOpacity
            onPress={() => open(frontUri, "Frente do documento")}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              borderWidth: 1,
              borderColor: theme.primarySubtleBorder,
              borderRadius: 8,
              paddingVertical: 9,
              backgroundColor: theme.primarySubtle,
            }}
          >
            {isImageUri(frontUri) ? (
              <Ionicons name="image-outline" size={16} color={theme.primary} />
            ) : (
              <Ionicons name="document-outline" size={16} color={theme.primary} />
            )}
            <MvText variant="caption" style={{ color: theme.primary }}>Frente</MvText>
          </TouchableOpacity>
        ) : (
          <View style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 8,
            paddingVertical: 9,
            opacity: 0.4,
          }}>
            <MvText variant="caption" color="secondary">Frente não enviada</MvText>
          </View>
        )}

        {backUri ? (
          <TouchableOpacity
            onPress={() => open(backUri, "Verso do documento")}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              borderWidth: 1,
              borderColor: theme.primarySubtleBorder,
              borderRadius: 8,
              paddingVertical: 9,
              backgroundColor: theme.primarySubtle,
            }}
          >
            {isImageUri(backUri) ? (
              <Ionicons name="image-outline" size={16} color={theme.primary} />
            ) : (
              <Ionicons name="document-outline" size={16} color={theme.primary} />
            )}
            <MvText variant="caption" style={{ color: theme.primary }}>Verso</MvText>
          </TouchableOpacity>
        ) : (
          <View style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 8,
            paddingVertical: 9,
            opacity: 0.4,
          }}>
            <MvText variant="caption" color="secondary">Verso não enviado</MvText>
          </View>
        )}
      </View>

      {modalUri ? (
        <DocViewerModal
          uri={modalUri}
          label={modalLabel}
          visible={true}
          onClose={() => setModalUri(null)}
          onError={(msg) => showToast(msg, "error")}
        />
      ) : null}
    </>
  );
}

export function AdminCrefValidationScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { runWithAuth, showToast } = useAppState();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AdminCrefQueueItem[]>([]);
  const [status, setStatus] = useState<QueueStatus>("IN_REVIEW");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [justification, setJustification] = useState("");
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const payload = await runWithAuth((token) =>
        adminApi.listCrefRequests(token, { status, take: 100 })
      );
      setItems(payload);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar fila de CREF.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast, status]);

  useFocusEffect(useCallback(() => {
    setRejectingId(null);
    setJustification("");
    void load();
  }, [load]));

  async function approve(providerId: string) {
    try {
      setSubmittingId(providerId);
      await runWithAuth((token) =>
        adminApi.reviewCref(token, providerId, { decision: "APPROVE" })
      );
      showToast("CREF aprovado com sucesso.", "success");
      setRejectingId(null);
      setJustification("");
      await load();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao aprovar CREF.",
        navigation
      });
    } finally {
      setSubmittingId(null);
    }
  }

  async function reject(providerId: string) {
    const reason = justification.trim();
    if (!reason) {
      showToast("Informe a justificativa da reprovação.", "error");
      return;
    }
    if (reason.length > 300) {
      showToast("A justificativa deve ter até 300 caracteres.", "error");
      return;
    }

    try {
      setSubmittingId(providerId);
      await runWithAuth((token) =>
        adminApi.reviewCref(token, providerId, { decision: "REJECT", justification: reason })
      );
      showToast("CREF reprovado e devolutiva enviada.", "success");
      setRejectingId(null);
      setJustification("");
      await load();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao reprovar CREF.",
        navigation
      });
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <AdminScaffold
      title="Validação de CREF"
      navigation={navigation}
      currentScreen="AdminCrefValidation"
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 10 }}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["IN_REVIEW", "PENDING", "APPROVED", "REJECTED"] as const).map((option) => (
            <TouchableOpacity
              key={option}
              onPress={() => {
                setStatus(option);
                setRejectingId(null);
                setJustification("");
              }}
              style={{
                borderWidth: 1,
                borderColor: status === option ? theme.primary : "rgba(127,127,127,0.35)",
                borderRadius: 20,
                paddingHorizontal: 12,
                paddingVertical: 8
              }}
            >
              <MvText variant="caption">
                {option === "IN_REVIEW"
                  ? "Em análise"
                  : option === "PENDING"
                    ? "Pendentes"
                    : option === "APPROVED"
                      ? "Aprovados"
                      : "Reprovados"}
              </MvText>
            </TouchableOpacity>
          ))}
        </View>

        {items.length === 0 && !loading ? (
          <MvCard>
            <MvText variant="body3">Nenhum CREF encontrado nessa fila.</MvText>
          </MvCard>
        ) : null}

        {items.map((item) => {
          const docCount = item.credentials?.length ?? 0;
          const isRejectingThis = rejectingId === item.providerId;
          const isSubmittingThis = submittingId === item.providerId;

          return (
            <MvCard key={item.providerId}>
              <View style={{ gap: 8 }}>
                <MvText variant="semi2">{item.user.name ?? "Profissional desconhecido"}</MvText>
                <MvText variant="body4" color="secondary">{item.user.email ?? "—"}</MvText>
                <MvText variant="body4">CREF: {item.crefNumber ?? "—"}</MvText>
                <MvText variant="body4">
                  Documentos enviados: {docCount}{docCount > 0 ? " (frente e verso abaixo)" : ""}
                </MvText>
                <MvText variant="body4">
                  Status:{" "}
                  {item.crefValidationStatus === "APPROVED"
                    ? "Aprovado"
                    : item.crefValidationStatus === "REJECTED"
                      ? "Reprovado"
                      : item.crefValidationStatus === "IN_REVIEW"
                        ? "Em análise"
                        : "Pendente"}
                </MvText>
                {item.crefRejectionReason ? (
                  <MvText variant="body4" color="secondary">
                    Último motivo: {item.crefRejectionReason}
                  </MvText>
                ) : null}

                {/* Document viewer buttons */}
                <DocButtons item={item} />

                {status === "IN_REVIEW" ? (
                  <View style={{ gap: 8, marginTop: 6 }}>
                    <MvButton
                      label="Aprovar CREF"
                      loading={isSubmittingThis}
                      disabled={docCount === 0}
                      onPress={() => void approve(item.providerId)}
                    />
                    {docCount === 0 && (
                      <MvText variant="caption" color="secondary" style={{ textAlign: "center" }}>
                        Nenhum documento enviado — aguarde envio antes de aprovar.
                      </MvText>
                    )}
                    {isRejectingThis ? (
                      <View style={{ gap: 8 }}>
                        <MvInput
                          multiline
                          numberOfLines={4}
                          maxLength={300}
                          placeholder="Escreva o motivo da reprovação (máximo 300 caracteres)"
                          value={justification}
                          onChangeText={setJustification}
                          style={{ textAlignVertical: "top" } as any}
                        />
                        <MvText variant="caption" color="secondary">
                          {justification.length}/300
                        </MvText>
                        <MvButton
                          variant="danger"
                          label="Confirmar reprovação"
                          loading={isSubmittingThis}
                          onPress={() => void reject(item.providerId)}
                        />
                        <MvButton
                          variant="ghost"
                          label="Cancelar"
                          onPress={() => {
                            setRejectingId(null);
                            setJustification("");
                          }}
                        />
                      </View>
                    ) : (
                      <MvButton
                        variant="outline"
                        label="Reprovar CREF"
                        onPress={() => {
                          setRejectingId(item.providerId);
                          setJustification("");
                        }}
                      />
                    )}
                  </View>
                ) : null}
              </View>
            </MvCard>
          );
        })}
      </ScrollView>
    </AdminScaffold>
  );
}
