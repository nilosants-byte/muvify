import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StatusBar, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { consultancyApi, ProviderConsultancyCatalog, ServiceOfferKind, OfferBillingCycle } from "../../services/api/client";

const KIND_LABEL: Record<ServiceOfferKind, string> = {
  PRESENTIAL: "Presencial",
  ONLINE_CONSULTANCY: "Consultoria online",
  ONLINE_CONSULTANCY_SPECIALIZED: "Consultoria personalizada",
  COMBO: "Combo presencial + online",
};

const CYCLE_LABEL: Record<OfferBillingCycle, string> = {
  DAILY: "Diário",
  WEEKLY: "Semanal",
  MONTHLY: "Mensal",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";

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
    if (!trainingNeedText.trim()) {
      showToast("Descreva o tipo de treino que você precisa.", "error");
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
      Alert.alert(
        "Solicitação enviada!",
        "O profissional responderá em até 24h.\n\nVocê receberá uma notificação quando ele enviar uma proposta.\n\nAcompanhe em Treinos → aba Pendentes.",
        [{ text: "Entendi", onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao enviar solicitação de consultoria.", navigation });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button" accessibilityLabel="Voltar" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Consultoria online</Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>escolha o serviço e envie seu briefing</Text>
        </View>
      </View>

      <ScreenEntrance>
      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 40, gap: 14, paddingTop: 16 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>Escolha um serviço e envie seu briefing antes de contratar.</Text>

        {loading ? (
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>Carregando catálogo...</Text>
        ) : (
          <>
            {/* Status da consultoria */}
            <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: catalog?.onlineConsultancyEnabled ? theme.primarySubtleBorder : C.amberBorder, backgroundColor: catalog?.onlineConsultancyEnabled ? "rgba(36,230,109,0.09)" : "rgba(245,166,35,0.08)", padding: 14, gap: 8 }}>
              <View style={{ backgroundColor: catalog?.onlineConsultancyEnabled ? theme.primarySubtle : C.amberDim, borderWidth: 1, borderColor: catalog?.onlineConsultancyEnabled ? theme.primarySubtleBorder : C.amberBorder, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: catalog?.onlineConsultancyEnabled ? theme.primary : C.amber }}>
                  {catalog?.onlineConsultancyEnabled ? "Consultoria habilitada" : "Consultoria desabilitada"}
                </Text>
              </View>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>
                Treinos completos liberados após contratação e pagamento.
              </Text>
            </View>

            {/* Seleção de oferta */}
            <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Escolha o serviço</Text>
              <View style={{ gap: 8 }}>
                {onlineOffers.map((offer) => {
                  const selected = selectedOfferId === offer.id;
                  return (
                    <TouchableOpacity
                      key={offer.id}
                      onPress={() => setSelectedOfferId(offer.id)}
                      style={{ borderWidth: 1, borderColor: selected ? theme.primarySubtleBorder : theme.border, borderRadius: 16, backgroundColor: selected ? theme.primarySubtle : theme.inputBg, padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>{offer.title}</Text>
                        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text2 }}>
                          {offer.kindDescription ?? KIND_LABEL[offer.kind] ?? offer.kind} • {CYCLE_LABEL[offer.billingCycle] ?? offer.billingCycle}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.primary }}>
                        {formatCurrencyBRL((offer.effectivePriceCents ?? offer.priceCents) / 100)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {onlineOffers.length === 0 ? (
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>Nenhuma oferta de consultoria cadastrada ainda.</Text>
                ) : null}
              </View>
            </View>

            {/* Briefing */}
            <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Briefing rápido</Text>
              {[
                { key: "need" as const, label: "Qual tipo de treino você precisa?", value: trainingNeedText, setter: setTrainingNeedText },
                { key: "limitations" as const, label: "Você tem alguma limitação?", value: limitationText, setter: setLimitationText },
                { key: "extra" as const, label: "Informações extras", value: extraInfoText, setter: setExtraInfoText },
              ].map(({ key, label, value, setter }) => (
                <View key={key}>
                  <TouchableOpacity
                    onPress={() => setOpenQuestion((q) => q === key ? null : key)}
                    style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: openQuestion === key ? theme.primarySubtleBorder : theme.border, backgroundColor: openQuestion === key ? theme.primarySubtle : theme.inputBg, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>{label}</Text>
                    <Ionicons name={openQuestion === key ? "chevron-up" : "chevron-down"} size={16} color={theme.text2} />
                  </TouchableOpacity>
                  {openQuestion === key ? (
                    <TextInput
                      multiline
                      numberOfLines={4}
                      placeholder="Até 300 caracteres"
                      placeholderTextColor={theme.text3}
                      maxLength={300}
                      value={value}
                      onChangeText={setter}
                      selectionColor={theme.primary}
                      style={{ borderWidth: 1, borderColor: theme.borderMid, borderRadius: 14, backgroundColor: theme.inputBg, padding: 12, color: theme.text1, fontFamily: "DMSans_400Regular", fontSize: 13, lineHeight: 20, minHeight: 90, marginTop: 6, textAlignVertical: "top" }}
                    />
                  ) : null}
                </View>
              ))}

              {selectedOffer ? (
                <View style={{ backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 10, borderWidth: 1, borderColor: theme.border }}>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>
                    Serviço selecionado: <Text style={{ fontFamily: "DMSans_700Bold", color: theme.text1 }}>{selectedOffer.title}</Text> ({formatCurrencyBRL((selectedOffer.effectivePriceCents ?? selectedOffer.priceCents) / 100)})
                  </Text>
                </View>
              ) : null}
            </View>
          </>
        )}

        {/* Card de próximo passo — visível antes do envio para preparar o usuário */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: C.skyBorder, backgroundColor: C.skyDim, padding: 14, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Ionicons name="information-circle-outline" size={20} color={C.sky} />
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>O que acontece depois?</Text>
          </View>
          <View style={{ gap: 6 }}>
            {[
              "O personal recebe sua solicitação e monta uma proposta personalizada.",
              "Você receberá uma notificação quando ele responder (geralmente em até 24h).",
              "Para aceitar ou recusar, vá em Treinos → aba Pendentes.",
            ].map((step, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: C.sky, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 9, color: theme.textOnPrimary }}>{i + 1}</Text>
                </View>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: C.zinc300, lineHeight: 18, flex: 1 }}>{step}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* CTA */}
        <TouchableOpacity
          disabled={loading || !catalog?.onlineConsultancyEnabled || !selectedOfferId || saving}
          onPress={() => void submitRequest()}
          accessibilityRole="button"
          accessibilityLabel="Enviar solicitação ao profissional"
          style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: (loading || !catalog?.onlineConsultancyEnabled || !selectedOfferId) ? "rgba(36,230,109,0.4)" : theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
        >
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>
            {saving ? "Enviando..." : "Enviar solicitação ao profissional"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
