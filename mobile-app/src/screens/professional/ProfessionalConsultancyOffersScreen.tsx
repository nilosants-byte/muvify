import React, { useEffect, useMemo, useState } from "react";
import * as Haptics from "expo-haptics";
import { trackEvent } from "../../services/analytics";
import { Alert, Modal, ScrollView, StatusBar, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import {
  consultancyApi,
  OfferBillingCycle,
  ProviderServiceOffer,
  ServiceOfferKind,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvRefreshControl, MvText } from "../../components/mv";
import { StepProgressBar } from "../../components/professional/UXReformComponents";
import { ConsultancyTabSwitcher } from "../../components/professional/ConsultancyTabSwitcher";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { SkeletonCard } from "../../components/polish/SkeletonCard";
import { formatBRDate, formatCurrencyBRL, maskDateInputBR, maskPriceInput } from "../../utils/formatters";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { handleScreenError } from "../shared/api-helpers";
import { useConsultancyCenterData, offerEffectivePriceCents } from "../../hooks/useConsultancyCenterData";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalConsultancyOffers">;

const offerKindOptions: Array<{ label: string; value: ServiceOfferKind }> = [
  { label: "Presencial", value: "PRESENTIAL" },
  { label: "Consultoria online", value: "ONLINE_CONSULTANCY" },
  { label: "Consultoria especializada", value: "ONLINE_CONSULTANCY_SPECIALIZED" },
  { label: "Combo", value: "COMBO" },
];

const cycleOptions: Array<{ label: string; value: OfferBillingCycle }> = [
  { label: "Diário", value: "DAILY" },
  { label: "Semanal", value: "WEEKLY" },
  { label: "Mensal", value: "MONTHLY" },
  { label: "Trimestral", value: "QUARTERLY" },
  { label: "Semestral", value: "SEMIANNUAL" },
  { label: "Anual", value: "ANNUAL" },
];

function toCents(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function parseDateInput(value: string) {
  const trimmed = value.trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return null;

  const [dayRaw, monthRaw, yearRaw] = trimmed.split("/");
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;

  const parsed = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function cycleLabel(cycle: OfferBillingCycle) {
  return cycleOptions.find((item) => item.value === cycle)?.label ?? cycle;
}

function offerDescription(offer: ProviderServiceOffer): string {
  const cycle = cycleLabel(offer.billingCycle);

  if (offer.kind === "PRESENTIAL") {
    const days = offer.daysPerWeek ? `${offer.daysPerWeek}x na semana` : "";
    return [days, cycle].filter(Boolean).join(" · ");
  }

  if (offer.kind === "COMBO") {
    const p = offer.comboPresentialDaysPerWeek ?? 0;
    const o = offer.comboOnlineDaysPerWeek ?? 0;
    return `${p} dia${p !== 1 ? "s" : ""} presencial + ${o} online/sem · ${cycle}`;
  }

  if (offer.kind === "ONLINE_CONSULTANCY_SPECIALIZED") {
    return `Especializada · ${cycle}`;
  }

  return cycle;
}

export function ProfessionalConsultancyOffersScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const { centerQuery, loading, crefValidated, offers, setOffers } = useConsultancyCenterData();

  const [creatingOffer, setCreatingOffer] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [deletingOfferId, setDeletingOfferId] = useState<string | null>(null);
  const [offerWizardStep, setOfferWizardStep] = useState(0);
  const [offerFormVisible, setOfferFormVisible] = useState(false);

  const [offerTitle, setOfferTitle] = useState("");
  const [offerKind, setOfferKind] = useState<ServiceOfferKind>("ONLINE_CONSULTANCY");
  const [offerCycle, setOfferCycle] = useState<OfferBillingCycle>("MONTHLY");
  const [offerPrice, setOfferPrice] = useState("0,00");
  const [daysPerWeek, setDaysPerWeek] = useState("3");
  const [comboPresentialDaysPerWeek, setComboPresentialDaysPerWeek] = useState("3");
  const [comboOnlineDaysPerWeek, setComboOnlineDaysPerWeek] = useState("2");
  const [promotionLabel, setPromotionLabel] = useState("");
  const [markAsPromotion, setMarkAsPromotion] = useState(false);
  const [promotionPrice, setPromotionPrice] = useState("0,00");
  const [promotionEndsAt, setPromotionEndsAt] = useState("");

  useEffect(() => {
    if (centerQuery.error) {
      handleScreenError({ error: centerQuery.error, showToast, fallbackMessage: "Falha ao carregar ofertas.", navigation });
    }
  }, [centerQuery.error, showToast, navigation]);

  const basePriceCents = useMemo(() => toCents(offerPrice), [offerPrice]);
  const promotionPriceCents = useMemo(() => toCents(promotionPrice), [promotionPrice]);
  const parsedPromotionEndsAt = useMemo(() => parseDateInput(promotionEndsAt), [promotionEndsAt]);

  const promotionValueError = useMemo(() => {
    if (!markAsPromotion) return undefined;
    if (promotionPriceCents <= 0) return "Informe o valor promocional.";
    if (basePriceCents <= 0) return "Defina primeiro o valor base.";
    if (promotionPriceCents >= basePriceCents) return "Valor promocional deve ser menor que o valor base.";
    return undefined;
  }, [basePriceCents, markAsPromotion, promotionPriceCents]);

  const promotionDateError = useMemo(() => {
    if (!markAsPromotion) return undefined;
    if (!promotionEndsAt.trim()) return "Informe até quando a promoção ficará válida.";
    if (!parsedPromotionEndsAt) return "Use o formato DD/MM/AAAA.";
    if (parsedPromotionEndsAt.getTime() <= Date.now()) return "A data final da promoção precisa ser futura.";
    return undefined;
  }, [markAsPromotion, parsedPromotionEndsAt, promotionEndsAt]);

  const comboDaysError = useMemo(() => {
    if (offerKind !== "COMBO") return undefined;
    const p = Number(comboPresentialDaysPerWeek);
    const o = Number(comboOnlineDaysPerWeek);
    if (!p || p < 1 || p > 7) return "Dias presenciais devem ser entre 1 e 7.";
    if (!o || o < 1 || o > 7) return "Dias online devem ser entre 1 e 7.";
    return undefined;
  }, [comboOnlineDaysPerWeek, comboPresentialDaysPerWeek, offerKind]);

  useEffect(() => {
    if (offerKind === "COMBO") setOfferTitle("Combo");
    else if (offerTitle === "Combo") setOfferTitle("");
  }, [offerKind, offerTitle]);

  useEffect(() => {
    if (editingOfferId) return;
    setOfferCycle(offerKind === "PRESENTIAL" ? "DAILY" : "MONTHLY");
  }, [offerKind, editingOfferId]);

  function resetOfferForm() {
    setEditingOfferId(null);
    setOfferTitle("");
    setOfferKind("ONLINE_CONSULTANCY");
    setOfferCycle("MONTHLY");
    setOfferPrice("0,00");
    setDaysPerWeek("3");
    setComboPresentialDaysPerWeek("3");
    setComboOnlineDaysPerWeek("2");
    setMarkAsPromotion(false);
    setPromotionPrice("0,00");
    setPromotionEndsAt("");
    setPromotionLabel("");
    setOfferWizardStep(0);
  }

  function startEditOffer(offer: ProviderServiceOffer) {
    setEditingOfferId(offer.id);
    setOfferTitle(offer.title);
    setOfferKind(offer.kind);
    setOfferCycle(offer.billingCycle);
    setOfferPrice((offer.priceCents / 100).toFixed(2).replace(".", ","));
    setMarkAsPromotion(offer.isPromotion);
    setPromotionPrice(offer.promotionPriceCents ? (offer.promotionPriceCents / 100).toFixed(2).replace(".", ",") : "0,00");
    setPromotionEndsAt(offer.promotionEndsAt ? new Date(offer.promotionEndsAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
    setPromotionLabel(offer.promotionLabel ?? "");
    setOfferFormVisible(true);
  }

  function openNewOfferForm() {
    resetOfferForm();
    setOfferFormVisible(true);
  }

  function closeOfferForm() {
    resetOfferForm();
    setOfferFormVisible(false);
  }

  async function handleDeleteOffer(offerId: string) {
    Alert.alert("Excluir oferta", "Deseja excluir esta oferta permanentemente?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: () => {
          const removed = offers.find((o) => o.id === offerId) ?? null;
          setOffers((prev) => prev.filter((o) => o.id !== offerId));
          showToast("Oferta excluída.", "success");

          runWithAuth((token) => consultancyApi.deleteProviderOffer(token, offerId)).catch(() => {
            if (removed) setOffers((prev) => [...prev, removed]);
            showToast("Não foi possível excluir a oferta. Tente novamente.", "error");
          });
        },
      },
    ]);
  }

  async function handleCreateOffer() {
    if (!offerTitle.trim() && offerKind !== "COMBO") {
      showToast("Informe um titulo para a oferta.", "error");
      return;
    }
    if (basePriceCents < 100) {
      showToast("Informe valor base minimo de R$ 1,00.", "error");
      return;
    }
    if (offerKind === "COMBO" && comboDaysError) {
      showToast(comboDaysError, "error");
      return;
    }
    if (markAsPromotion && (promotionValueError || promotionDateError)) {
      showToast(promotionValueError ?? promotionDateError ?? "Promoção inválida.", "error");
      return;
    }

    try {
      setCreatingOffer(true);

      if (editingOfferId) {
        const updatedOffer = await runWithAuth((token) =>
          consultancyApi.updateProviderOffer(token, editingOfferId, {
            title: offerKind === "COMBO" ? "Combo" : offerTitle.trim(),
            priceCents: basePriceCents,
            daysPerWeek: offerKind === "PRESENTIAL" ? Math.max(1, Number(daysPerWeek) || 1) : undefined,
            comboPresentialDaysPerWeek: offerKind === "COMBO" ? Math.max(1, Number(comboPresentialDaysPerWeek) || 1) : undefined,
            comboOnlineDaysPerWeek: offerKind === "COMBO" ? Math.max(1, Number(comboOnlineDaysPerWeek) || 1) : undefined,
            isPromotion: markAsPromotion,
            promotionPriceCents: markAsPromotion ? promotionPriceCents : undefined,
            promotionEndsAt: markAsPromotion && parsedPromotionEndsAt ? parsedPromotionEndsAt.toISOString() : undefined,
            promotionLabel: markAsPromotion ? promotionLabel.trim() || undefined : undefined,
          })
        );
        setOffers((prev) =>
          prev.map((o) => (o.id === editingOfferId ? updatedOffer : o))
        );
        showToast("Oferta atualizada com sucesso.", "success");
        resetOfferForm();
        setOfferFormVisible(false);
        return;
      } else {
        await runWithAuth((token) =>
          consultancyApi.createProviderOffer(token, {
            kind: offerKind,
            title: offerKind === "COMBO" ? "Combo" : offerTitle.trim(),
            billingCycle: offerCycle,
            daysPerWeek: offerKind === "PRESENTIAL" ? Math.max(1, Number(daysPerWeek) || 1) : undefined,
            comboPresentialDaysPerWeek: offerKind === "COMBO" ? Math.max(1, Number(comboPresentialDaysPerWeek) || 1) : undefined,
            comboOnlineDaysPerWeek: offerKind === "COMBO" ? Math.max(1, Number(comboOnlineDaysPerWeek) || 1) : undefined,
            priceCents: basePriceCents,
            isPromotion: markAsPromotion,
            promotionPriceCents: markAsPromotion ? promotionPriceCents : undefined,
            promotionEndsAt: markAsPromotion && parsedPromotionEndsAt ? parsedPromotionEndsAt.toISOString() : undefined,
            promotionLabel: markAsPromotion ? promotionLabel.trim() || undefined : undefined,
          })
        );
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        trackEvent("offer_created", { kind: offerKind, billing_cycle: offerCycle });
        showToast("Oferta criada com sucesso.", "success");
      }

      resetOfferForm();
      setOfferFormVisible(false);
      void centerQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: editingOfferId ? "Falha ao atualizar oferta." : "Falha ao criar oferta.", navigation });
    } finally {
      setCreatingOffer(false);
    }
  }

  function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
    return (
      <PressableScale
        scale={0.95}
        onPress={onPress}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 20,
          backgroundColor: selected ? theme.primarySubtle : theme.chipBg,
          borderWidth: 1,
          borderColor: selected ? theme.primarySubtleBorder : theme.border,
        }}
      >
        <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.text2 }}>
          {label}
        </MvText>
      </PressableScale>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.consultancy.offers">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <ProfessionalScreenHeader
        title="Vitrine"
        subtitle="Suas ofertas de consultoria"
        onBack={() => navigation.replace("ProfessionalConsultancyCenter")}
      />

      <ScreenEntrance>
      <ScrollView
        automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <MvRefreshControl refreshing={centerQuery.isRefetching} onRefresh={() => void centerQuery.refetch()} />
        }
      >
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
        <>
        <MvCard style={{ gap: 10 }}>
          <ConsultancyTabSwitcher
            active="offers"
            onNavigate={(key) => {
              if (key === "dashboard") navigation.replace("ProfessionalConsultancyCenter");
              else if (key === "requests") navigation.replace("ProfessionalConsultancyRequests");
            }}
          />

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <MvText variant="semi2">Sua vitrine</MvText>
            <MvBadge label={`${offers.length} oferta${offers.length === 1 ? "" : "s"}`} variant={offers.length ? "blue" : "gray"} />
          </View>

          <MvButton label="+ Nova oferta" onPress={openNewOfferForm} />

          {offers.length === 0 && !loading ? (
            <View style={{
              alignItems: "center", padding: 24, gap: 12,
              backgroundColor: theme.inputBg,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: theme.border,
            }}>
              <Ionicons name="pricetag-outline" size={36} color={theme.text3} />
              <MvText variant="h3">Sua vitrine está vazia</MvText>
              <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
                Crie sua primeira oferta para os alunos encontrarem seus serviços de consultoria.
              </MvText>
            </View>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {offers.map((offer) => {
                const hasDiscount = offer.isPromotionActive && offer.promotionPriceCents && offer.priceCents !== offer.promotionPriceCents;
                const kindLabel = offerKindOptions.find((o) => o.value === offer.kind)?.label ?? offer.kind;
                return (
                  <View
                    key={offer.id}
                    style={{
                      flexBasis: "48%",
                      flexGrow: 1,
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 14,
                      backgroundColor: theme.mode === "dark" ? "rgba(0,0,0,0.10)" : "#FFFFFF",
                      padding: 12,
                      gap: 6,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                      <MvText variant="caption" color="secondary" style={{ textTransform: "uppercase", letterSpacing: 0.3 }} numberOfLines={1}>
                        {kindLabel}
                      </MvText>
                      {offer.isPromotionActive ? <MvBadge label="Promo" variant="orange" /> : null}
                    </View>
                    <MvText variant="semi2" numberOfLines={2}>{offer.title}</MvText>
                    <MvText variant="caption" color="secondary">
                      {offerDescription(offer)}
                    </MvText>
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                      <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 18, letterSpacing: -0.2, color: theme.textGreen }}>
                        {formatCurrencyBRL(offerEffectivePriceCents(offer) / 100)}
                      </MvText>
                      {hasDiscount ? (
                        <MvText variant="caption" color="secondary" style={{ textDecorationLine: "line-through" }}>
                          {formatCurrencyBRL(offer.priceCents / 100)}
                        </MvText>
                      ) : null}
                    </View>
                    {offer.basePriceChangeLockedUntil && new Date(offer.basePriceChangeLockedUntil) > new Date() ? (
                      <MvText variant="caption" color="secondary">
                        Valor alterável a partir de {formatBRDate(offer.basePriceChangeLockedUntil)}
                      </MvText>
                    ) : null}
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                      <MvBadge label={offer.isActive !== false ? "Ativa" : "Inativa"} variant={offer.isActive !== false ? "green" : "gray"} />
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        <PressableScale
                          onPress={() => startEditOffer(offer)}
                          scale={0.94}
                          style={{
                            width: 28, height: 28, borderRadius: 8,
                            backgroundColor: theme.primarySubtle,
                            alignItems: "center", justifyContent: "center",
                          }}
                        >
                          <Ionicons name="create-outline" size={15} color={theme.textGreen} />
                        </PressableScale>
                        <PressableScale
                          onPress={() => void handleDeleteOffer(offer.id)}
                          disabled={deletingOfferId === offer.id}
                          scale={0.94}
                          style={{
                            width: 28, height: 28, borderRadius: 8,
                            backgroundColor: "rgba(239,68,68,0.08)",
                            alignItems: "center", justifyContent: "center",
                            opacity: deletingOfferId === offer.id ? 0.45 : 1,
                          }}
                        >
                          <Ionicons name="trash-outline" size={15} color={theme.danger} />
                        </PressableScale>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </MvCard>

        <Modal visible={offerFormVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeOfferForm}>
          <View style={{ flex: 1, backgroundColor: theme.bg }}>
            <View
              style={{
                paddingTop: insets.top + 12,
                paddingHorizontal: 16,
                paddingBottom: 12,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottomWidth: 1,
                borderBottomColor: theme.border,
              }}
            >
              <MvText variant="h3">{editingOfferId ? "Editar oferta" : "Nova oferta"}</MvText>
              <PressableScale scale={0.90} onPress={closeOfferForm} style={{ padding: 4 }}>
                <Ionicons name="close-circle-outline" size={24} color={theme.text3} />
              </PressableScale>
            </View>
            <ScrollView
              automaticallyAdjustKeyboardInsets={true}
              contentContainerStyle={{ padding: 16, gap: 10 }}
              showsVerticalScrollIndicator={false}
            >
            {editingOfferId ? (
              <View style={{ gap: 10 }}>
                <MvText variant="body4" color="secondary">Altere os campos desejados e salve.</MvText>
                <MvInput
                  editable={offerKind !== "COMBO"}
                  placeholder={offerKind === "COMBO" ? "Combo (titulo fixo)" : "Titulo da oferta"}
                  value={offerTitle}
                  onChangeText={setOfferTitle}
                />
                {offerKind === "PRESENTIAL" ? (
                  <MvInput keyboardType="numeric" placeholder="Dias por semana (presencial)" value={daysPerWeek} onChangeText={setDaysPerWeek} />
                ) : null}
                {offerKind === "COMBO" ? (
                  <>
                    <MvInput keyboardType="numeric" placeholder="Dias presenciais por semana" value={comboPresentialDaysPerWeek} onChangeText={setComboPresentialDaysPerWeek} />
                    <MvInput keyboardType="numeric" placeholder="Dias online por semana" value={comboOnlineDaysPerWeek} onChangeText={setComboOnlineDaysPerWeek} />
                    {comboDaysError ? <MvText variant="body4" color="danger">{comboDaysError}</MvText> : null}
                  </>
                ) : null}
                <MvInput keyboardType="numeric" placeholder="Valor base (R$)" value={offerPrice} onChangeText={(value) => setOfferPrice(maskPriceInput(value))} />
                <MvText variant="caption" color="secondary">O valor base pode ser alterado apenas 1 vez a cada 30 dias.</MvText>
                <Chip label={markAsPromotion ? "Promoção ativa no cadastro" : "Marcar como promoção"} selected={markAsPromotion} onPress={() => setMarkAsPromotion((current) => !current)} />
                {markAsPromotion ? (
                  <>
                    <MvInput keyboardType="numeric" placeholder="Valor promocional (R$)" value={promotionPrice} onChangeText={(value) => setPromotionPrice(maskPriceInput(value))} />
                    {promotionValueError ? <MvText variant="body4" color="danger">{promotionValueError}</MvText> : null}
                    <MvInput keyboardType="numeric" placeholder="Validade (DD/MM/AAAA)" value={promotionEndsAt} onChangeText={(value) => setPromotionEndsAt(maskDateInputBR(value))} />
                    {promotionDateError ? <MvText variant="body4" color="danger">{promotionDateError}</MvText> : null}
                    <MvInput placeholder="Texto da promoção (opcional)" value={promotionLabel} onChangeText={setPromotionLabel} maxLength={50} />
                  </>
                ) : null}
                {!crefValidated ? (
                  <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>Esta funcionalidade ficará disponível quando seu CREF for aprovado.</MvText>
                ) : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <MvButton label="Salvar alterações" loading={creatingOffer} disabled={!crefValidated || Boolean(promotionValueError || promotionDateError || comboDaysError)} onPress={() => void handleCreateOffer()} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvButton variant="outline" label="Cancelar" onPress={closeOfferForm} />
                  </View>
                </View>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                <MvText variant="semi2">Nova oferta de serviço</MvText>
                <StepProgressBar steps={["Tipo", "Valor", "Detalhes", "Preview"]} currentStep={offerWizardStep + 1} />

                {offerWizardStep === 0 ? (
                  <View style={{ gap: 8 }}>
                    <MvText variant="body4" color="secondary">Escolha o modelo de atendimento.</MvText>
                    {([
                      { value: "PRESENTIAL", label: "Presencial", icon: "body-outline", desc: "Atendimento físico — cobrança diária" },
                      { value: "ONLINE_CONSULTANCY", label: "Consultoria online", icon: "phone-portrait-outline", desc: "Plano entregue remotamente — cobrança mensal" },
                      { value: "ONLINE_CONSULTANCY_SPECIALIZED", label: "Especializada", icon: "ribbon-outline", desc: "Abordagem diferenciada — cobrança mensal" },
                      { value: "COMBO", label: "Combo presencial + online", icon: "shuffle-outline", desc: "Combina sessões e acompanhamento — cobrança mensal" },
                    ] as { value: ServiceOfferKind; label: string; icon: string; desc: string }[]).map((opt) => {
                      const sel = offerKind === opt.value;
                      return (
                        <PressableScale
                          key={opt.value}
                          scale={0.97}
                          onPress={() => setOfferKind(opt.value)}
                          style={{ flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, borderColor: sel ? theme.primarySubtleBorder : theme.border, backgroundColor: sel ? theme.primarySubtle : theme.cardBg, padding: 12 }}
                        >
                          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: sel ? theme.primarySubtle : theme.backBtn, alignItems: "center", justifyContent: "center" }}>
                            <Ionicons name={opt.icon as any} size={18} color={sel ? theme.textGreen : theme.text1} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <MvText variant="semi3" style={{ color: sel ? theme.textGreen : theme.text1 }}>{opt.label}</MvText>
                            <MvText variant="caption" color="secondary">{opt.desc}</MvText>
                          </View>
                          {sel ? <Ionicons name="checkmark-circle" size={18} color={theme.textGreen} /> : null}
                        </PressableScale>
                      );
                    })}
                    <MvButton label="Avançar →" onPress={() => setOfferWizardStep(1)} />
                  </View>
                ) : null}

                {offerWizardStep === 1 ? (
                  <View style={{ gap: 10 }}>
                    <MvText variant="body4" color="secondary">Defina o valor da sua oferta.</MvText>
                    <View style={{ borderRadius: 10, padding: 10, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle }}>
                      <MvText variant="body4" style={{ color: theme.textGreen }}>
                        Cobrança: {cycleLabel(offerCycle)} (definida automaticamente pelo tipo)
                      </MvText>
                    </View>
                    <MvInput keyboardType="numeric" placeholder="Valor base (R$)" value={offerPrice} onChangeText={(value) => setOfferPrice(maskPriceInput(value))} />
                    <MvText variant="caption" color="secondary">O valor base pode ser alterado apenas 1 vez a cada 30 dias.</MvText>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <MvButton variant="outline" label="← Voltar" onPress={() => setOfferWizardStep(0)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <MvButton label="Avançar →" disabled={basePriceCents < 100} onPress={() => setOfferWizardStep(2)} />
                      </View>
                    </View>
                  </View>
                ) : null}

                {offerWizardStep === 2 ? (
                  <View style={{ gap: 10 }}>
                    <MvText variant="body4" color="secondary">Detalhes e configurações opcionais.</MvText>
                    {offerKind !== "COMBO" ? (
                      <MvInput placeholder="Título da oferta" value={offerTitle} onChangeText={setOfferTitle} />
                    ) : null}
                    {offerKind === "PRESENTIAL" ? (
                      <MvInput keyboardType="numeric" placeholder="Dias por semana (presencial)" value={daysPerWeek} onChangeText={setDaysPerWeek} />
                    ) : null}
                    {offerKind === "COMBO" ? (
                      <>
                        <MvInput keyboardType="numeric" placeholder="Dias presenciais por semana" value={comboPresentialDaysPerWeek} onChangeText={setComboPresentialDaysPerWeek} />
                        <MvInput keyboardType="numeric" placeholder="Dias online por semana" value={comboOnlineDaysPerWeek} onChangeText={setComboOnlineDaysPerWeek} />
                        {comboDaysError ? <MvText variant="body4" color="danger">{comboDaysError}</MvText> : null}
                      </>
                    ) : null}
                    <Chip label={markAsPromotion ? "Promoção ativa no cadastro" : "Marcar como promoção"} selected={markAsPromotion} onPress={() => setMarkAsPromotion((current) => !current)} />
                    {markAsPromotion ? (
                      <>
                        <MvInput keyboardType="numeric" placeholder="Valor promocional (R$)" value={promotionPrice} onChangeText={(value) => setPromotionPrice(maskPriceInput(value))} />
                        {promotionValueError ? <MvText variant="body4" color="danger">{promotionValueError}</MvText> : null}
                        <MvInput keyboardType="numeric" placeholder="Validade (DD/MM/AAAA)" value={promotionEndsAt} onChangeText={(value) => setPromotionEndsAt(maskDateInputBR(value))} />
                        {promotionDateError ? <MvText variant="body4" color="danger">{promotionDateError}</MvText> : null}
                        <MvInput placeholder="Texto da promoção (opcional)" value={promotionLabel} onChangeText={setPromotionLabel} maxLength={50} />
                      </>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <MvButton variant="outline" label="← Voltar" onPress={() => setOfferWizardStep(1)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <MvButton
                          label="Revisar →"
                          disabled={offerKind !== "COMBO" && !offerTitle.trim()}
                          onPress={() => setOfferWizardStep(3)}
                        />
                      </View>
                    </View>
                  </View>
                ) : null}

                {offerWizardStep === 3 ? (
                  <View style={{ gap: 10 }}>
                    <MvText variant="body4" color="secondary">Revise sua oferta antes de publicar.</MvText>
                    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle, padding: 14, gap: 6 }}>
                      <MvText variant="semi2">{offerKind === "COMBO" ? "Combo" : (offerTitle || "Sem título")}</MvText>
                      <MvText variant="body4" color="secondary">
                        {offerKindOptions.find((o) => o.value === offerKind)?.label} · {cycleLabel(offerCycle)}
                      </MvText>
                      <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 22, letterSpacing: -0.2, color: theme.textGreen }}>
                        {formatCurrencyBRL(basePriceCents / 100)}
                      </MvText>
                      {markAsPromotion && promotionPriceCents > 0 ? (
                        <MvText variant="caption" style={{ color: theme.textGreen }}>
                          Promoção: {formatCurrencyBRL(promotionPriceCents / 100)}{promotionEndsAt ? ` até ${promotionEndsAt}` : ""}
                        </MvText>
                      ) : null}
                    </View>
                    {!crefValidated ? (
                      <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>Esta funcionalidade ficará disponível quando seu CREF for aprovado.</MvText>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <MvButton variant="outline" label="← Voltar" onPress={() => setOfferWizardStep(2)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <MvButton
                          label="Criar oferta"
                          loading={creatingOffer}
                          disabled={!crefValidated || Boolean(promotionValueError || promotionDateError || comboDaysError)}
                          onPress={() => void handleCreateOffer()}
                        />
                      </View>
                    </View>
                  </View>
                ) : null}
              </View>
            )}
            </ScrollView>
          </View>
        </Modal>
        </>
        )}
      </ScrollView>
      </ScreenEntrance>

      <ProfessionalBottomNav
        activeKey="consultoria"
        onPress={(key) => {
          if (key === "consultoria") { navigation.replace("ProfessionalConsultancyCenter"); return; }
          if (key === "home") navigation.navigate("ProfessionalTabs", { screen: "ProfessionalHome" } as never);
          else if (key === "agenda") navigation.navigate("ProfessionalTabs", { screen: "ProfessionalAgenda" } as never);
          else if (key === "alunos") navigation.navigate("ProfessionalStudents" as never);
          else if (key === "financeiro") navigation.navigate("ProfessionalTabs", { screen: "PayoutStatus" } as never);
        }}
      />
    </View>
  );
}
