import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { consultancyApi, ProviderConsultancyCatalog } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ClientStackParamList, "ConsultancyRequest">;
type QuestionKey = "need" | "limitations" | "extra";

export function ConsultancyRequestScreen({ route, navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const providerId = route.params.professionalId;

  const [catalog, setCatalog] = useState<ProviderConsultancyCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [openQuestion, setOpenQuestion] = useState<QuestionKey | null>(null);
  const [trainingNeedText, setTrainingNeedText] = useState("");
  const [limitationText, setLimitationText] = useState("");
  const [extraInfoText, setExtraInfoText] = useState("");

  const onlineOffers = useMemo(() =>
    (catalog?.offers ?? []).filter((item) =>
      item.kind === "ONLINE_CONSULTANCY" || item.kind === "ONLINE_CONSULTANCY_SPECIALIZED" || item.kind === "COMBO"
    ), [catalog?.offers]
  );

  const selectedOffer = useMemo(() => onlineOffers.find((offer) => offer.id === selectedOfferId) ?? null, [onlineOffers, selectedOfferId]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await consultancyApi.providerCatalog(providerId);
      setCatalog(result);
      setSelectedOfferId(result.offers?.[0]?.id ?? null);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar consultoria do profissional.", navigation });
    } finally {
      setLoading(false);
    }
  }, [navigation, providerId, showToast]);

  useEffect(() => { void load(); }, [load]);

  async function submitRequest() {
    if (!catalog?.onlineConsultancyEnabled) {
      showToast("Consultoria online ainda não habilitada por este profissional.", "error");
      return;
    }
    if (!selectedOfferId) {
      showToast("Escolha uma opção de consultoria antes de continuar.", "error");
      return;
    }
    try {
      setSaving(true);
      await runWithAuth((token) => consultancyApi.createRequest(token, {
        providerId, quotedOfferId: selectedOfferId,
        trainingNeedText: trainingNeedText.trim() || undefined,
        limitationText: limitationText.trim() || undefined,
        extraInfoText: extraInfoText.trim() || undefined,
      }));
      showToast("Solicitação enviada. Aguarde resposta do profissional.", "success");
      navigation.goBack();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao enviar solicitação de consultoria.", navigation });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="h4">Consultoria online</MvText>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        <MvText variant="body4" color="secondary">Escolha um serviço e envie seu briefing.</MvText>

        {loading ? (
          <MvText variant="body4" color="secondary">Carregando catálogo...</MvText>
        ) : (
          <>
            <MvCard>
              <MvBadge
                label={catalog?.onlineConsultancyEnabled ? "Consultoria habilitada" : "Consultoria desabilitada"}
                variant={catalog?.onlineConsultancyEnabled ? "green" : "orange"}
              />
              <MvText variant="body4" color="secondary" style={{ marginTop: 8 }}>
                Treinos completos liberados após contratação e pagamento.
              </MvText>
            </MvCard>

            <MvCard>
              <MvText variant="semi2" style={{ marginBottom: 10 }}>Escolha o serviço</MvText>
              <View style={{ gap: 8 }}>
                {onlineOffers.map((offer) => {
                  const selected = selectedOfferId === offer.id;
                  return (
                    <TouchableOpacity
                      key={offer.id}
                      onPress={() => setSelectedOfferId(offer.id)}
                      style={{
                        borderWidth: 1,
                        borderColor: selected ? "rgba(76,175,80,0.40)" : theme.border,
                        borderRadius: 11,
                        backgroundColor: selected ? "rgba(76,175,80,0.06)" : theme.inputBg,
                        padding: 12,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <MvText variant="semi3">{offer.title}</MvText>
                        <MvText variant="body4" color="secondary">
                          {offer.kindDescription ?? offer.kind} • {offer.billingCycle}
                        </MvText>
                      </View>
                      <MvText variant="semi3" style={{ color: theme.textGreen }}>
                        {formatCurrencyBRL((offer.effectivePriceCents ?? offer.priceCents) / 100)}
                      </MvText>
                    </TouchableOpacity>
                  );
                })}
                {onlineOffers.length === 0 ? (
                  <MvText variant="body4" color="secondary">Nenhuma oferta de consultoria cadastrada ainda.</MvText>
                ) : null}
              </View>
            </MvCard>

            <MvCard>
              <MvText variant="semi2" style={{ marginBottom: 10 }}>Briefing rápido</MvText>
              <View style={{ gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setOpenQuestion((q) => q === "need" ? null : "need")}
                  style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg }}
                >
                  <MvText variant="semi3">Qual tipo de treino você precisa?</MvText>
                </TouchableOpacity>
                {openQuestion === "need" ? (
                  <MvInput multiline numberOfLines={4} placeholder="Até 300 caracteres" maxLength={300} value={trainingNeedText} onChangeText={setTrainingNeedText} />
                ) : null}

                <TouchableOpacity
                  onPress={() => setOpenQuestion((q) => q === "limitations" ? null : "limitations")}
                  style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg }}
                >
                  <MvText variant="semi3">Você tem alguma limitação?</MvText>
                </TouchableOpacity>
                {openQuestion === "limitations" ? (
                  <MvInput multiline numberOfLines={4} placeholder="Até 300 caracteres" maxLength={300} value={limitationText} onChangeText={setLimitationText} />
                ) : null}

                <TouchableOpacity
                  onPress={() => setOpenQuestion((q) => q === "extra" ? null : "extra")}
                  style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg }}
                >
                  <MvText variant="semi3">Informações extras</MvText>
                </TouchableOpacity>
                {openQuestion === "extra" ? (
                  <MvInput multiline numberOfLines={4} placeholder="Até 300 caracteres" maxLength={300} value={extraInfoText} onChangeText={setExtraInfoText} />
                ) : null}

                {selectedOffer ? (
                  <MvText variant="body4" color="secondary">
                    Serviço selecionado: {selectedOffer.title} ({formatCurrencyBRL((selectedOffer.effectivePriceCents ?? selectedOffer.priceCents) / 100)})
                  </MvText>
                ) : null}
              </View>
            </MvCard>
          </>
        )}

        <MvButton
          disabled={loading || !catalog?.onlineConsultancyEnabled || !selectedOfferId}
          loading={saving}
          label="Enviar solicitação ao profissional"
          onPress={submitRequest}
        />
      </ScrollView>
    </View>
  );
}
