import React, { useEffect, useMemo, useState } from "react";
import * as Haptics from "expo-haptics";
import { trackEvent } from "../../services/analytics";
import { Alert, Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import {
  ApiError,
  consultancyApi,
  OfferBillingCycle,
  PresentialPackageMode,
  ProviderServiceMode,
  ProviderServiceOffer,
  ServiceOfferKind,
  userApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvRefreshControl, MvText, MvToggle } from "../../components/mv";
import { StepProgressBar } from "../../components/professional/UXReformComponents";
import { PressableScale } from "../../components/polish/PressableScale";
import { SkeletonCard } from "../../components/polish/SkeletonCard";
import { formatBRDate, formatCurrencyBRL, maskDateInputBR, maskPriceInput } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { useConsultancyCenterData, offerEffectivePriceCents } from "../../hooks/useConsultancyCenterData";

type CenterNavigation = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalConsultancyCenter">["navigation"];

// Painel embutido na aba "Vitrine" de ProfessionalConsultancyCenterScreen —
// não é mais uma tela/rota própria (ver Etapa 7: unificação das 3 abas numa
// única tela, sem navegação/transição entre elas).
type Props = { navigation: CenterNavigation };

const offerKindOptions: Array<{ label: string; value: ServiceOfferKind }> = [
  { label: "Presencial", value: "PRESENTIAL" },
  { label: "Consultoria online", value: "ONLINE_CONSULTANCY" },
  { label: "Consultoria especializada", value: "ONLINE_CONSULTANCY_SPECIALIZED" },
  { label: "Combo", value: "COMBO" },
];

// Mesmos ícones usados no seletor de tipo do wizard (passo 0) — reaproveitados
// aqui pro chip de categoria na vitrine, pra manter a mesma linguagem visual
// entre "criar oferta" e "ver oferta".
const offerKindIcon: Record<ServiceOfferKind, keyof typeof Ionicons.glyphMap> = {
  PRESENTIAL: "body-outline",
  ONLINE_CONSULTANCY: "phone-portrait-outline",
  ONLINE_CONSULTANCY_SPECIALIZED: "ribbon-outline",
  COMBO: "shuffle-outline",
};

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

function packageModeLabel(mode?: PresentialPackageMode | null): string | null {
  if (mode === "FIXED_RECURRING") return "Pacote · horário fixo";
  if (mode === "FLEXIBLE_CREDITS") return "Pacote · créditos flexíveis";
  return null;
}

function offerDescription(offer: ProviderServiceOffer): string {
  const cycle = cycleLabel(offer.billingCycle);
  const packageLabel = packageModeLabel(offer.presentialPackageMode);

  if (offer.kind === "PRESENTIAL") {
    if (packageLabel) return `${packageLabel} · ${cycle}`;
    const days = offer.daysPerWeek ? `${offer.daysPerWeek}x na semana` : "";
    return [days, cycle].filter(Boolean).join(" · ");
  }

  if (offer.kind === "COMBO") {
    if (packageLabel) return `${packageLabel} · ${cycle}`;
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
  const { runWithAuth, showToast, showSubscriptionRequiredSheet } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const { centerQuery, loading, crefValidated, subscriptionActive, offers, setOffers } = useConsultancyCenterData();
  // Bloco 6 (bloqueio por assinatura inativa): mesma condição que já barra
  // por CREF, agora também considerando assinatura.
  const canSaveOffer = crefValidated && subscriptionActive;

  const myProfileQuery = useAuthQuery(queryKeys.user.me(), (token) => userApi.me(token));
  const profileServiceMode: ProviderServiceMode = myProfileQuery.data?.providerProfile?.serviceMode ?? "BOTH";

  const [creatingOffer, setCreatingOffer] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  // Frente 5 (segunda camada), Lote 5: o card fora do formulário já avisava
  // "Valor alterável a partir de {data}", mas dentro do próprio formulário
  // de edição o campo de preço continuava normal, sem aviso — o
  // profissional só descobria a trava depois de preencher tudo e tentar
  // salvar, com um erro do backend.
  const [editingOfferPriceLockedUntil, setEditingOfferPriceLockedUntil] = useState<string | null>(null);
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
  const [presentialPackageMode, setPresentialPackageMode] = useState<PresentialPackageMode | null>(null);
  const [presentialHasFixedTerm, setPresentialHasFixedTerm] = useState(false);
  const [presentialTotalCycles, setPresentialTotalCycles] = useState("3");
  const [presentialSessionsPerCycle, setPresentialSessionsPerCycle] = useState("8");
  const [comboPresentialShare, setComboPresentialShare] = useState("0,00");
  const [comboConsultancyShare, setComboConsultancyShare] = useState("0,00");
  const [acceptsPix, setAcceptsPix] = useState(true);
  const [acceptsDebitCard, setAcceptsDebitCard] = useState(true);
  const [acceptsCreditCard, setAcceptsCreditCard] = useState(true);
  const [fichaValidityDays, setFichaValidityDays] = useState("");
  const [offerServiceMode, setOfferServiceMode] = useState<ProviderServiceMode | null>(null);

  useEffect(() => {
    if (centerQuery.error) {
      handleScreenError({ error: centerQuery.error, showToast, fallbackMessage: "Falha ao carregar ofertas.", navigation });
    }
  }, [centerQuery.error, showToast, navigation]);

  const editingOfferPriceLocked = useMemo(
    () => Boolean(editingOfferPriceLockedUntil) && new Date(editingOfferPriceLockedUntil!).getTime() > Date.now(),
    [editingOfferPriceLockedUntil]
  );

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

  const comboPresentialShareCents = useMemo(() => toCents(comboPresentialShare), [comboPresentialShare]);
  const comboConsultancyShareCents = useMemo(() => toCents(comboConsultancyShare), [comboConsultancyShare]);

  // Combo sempre precisa de um modelo de pacote (presencial + consultoria
  // sao 2 cobrancas independentes) - presencial avulso pode ou nao virar
  // pacote, por isso so valida sessoes/vigencia quando um modo foi escolhido.
  const presentialPackageError = useMemo(() => {
    if (offerKind === "COMBO" && !presentialPackageMode) {
      return "Escolha o modelo do pacote presencial do combo.";
    }
    if (!presentialPackageMode) return undefined;
    const sessions = Number(presentialSessionsPerCycle);
    if (!sessions || sessions < 1) {
      return "Informe quantas sessões (ou créditos) o pacote libera por ciclo.";
    }
    if (presentialHasFixedTerm) {
      const cycles = Number(presentialTotalCycles);
      if (!cycles || cycles < 1) return "Informe o número total de ciclos.";
    }
    return undefined;
  }, [offerKind, presentialPackageMode, presentialSessionsPerCycle, presentialHasFixedTerm, presentialTotalCycles]);

  const paymentMethodsError = useMemo(() => {
    if (!acceptsPix && !acceptsDebitCard && !acceptsCreditCard) {
      return "Selecione ao menos uma forma de pagamento aceita.";
    }
    return undefined;
  }, [acceptsPix, acceptsDebitCard, acceptsCreditCard]);

  const comboShareError = useMemo(() => {
    if (offerKind !== "COMBO" || !presentialPackageMode) return undefined;
    if (comboPresentialShareCents <= 0 || comboConsultancyShareCents <= 0) {
      return "Informe o valor de cada metade do combo.";
    }
    if (comboPresentialShareCents + comboConsultancyShareCents !== basePriceCents) {
      return "A soma das duas metades deve ser igual ao valor total da oferta.";
    }
    return undefined;
  }, [offerKind, presentialPackageMode, comboPresentialShareCents, comboConsultancyShareCents, basePriceCents]);

  useEffect(() => {
    if (offerKind === "COMBO") setOfferTitle("Combo");
    else if (offerTitle === "Combo") setOfferTitle("");
  }, [offerKind, offerTitle]);

  // Frente 5 (segunda camada), Lote 1: promoção não é suportada em ofertas
  // Combo (o backend rejeita) — desliga automaticamente se o profissional
  // trocar o tipo pra Combo com promoção já marcada.
  useEffect(() => {
    if (offerKind === "COMBO" && markAsPromotion) setMarkAsPromotion(false);
  }, [offerKind, markAsPromotion]);

  useEffect(() => {
    if (editingOfferId) return;
    setOfferCycle(offerKind === "PRESENTIAL" ? "DAILY" : "MONTHLY");
  }, [offerKind, editingOfferId]);

  useEffect(() => {
    if (editingOfferId) return;
    if (offerKind !== "PRESENTIAL" && offerKind !== "COMBO") {
      setPresentialPackageMode(null);
    }
  }, [offerKind, editingOfferId]);

  function resetOfferForm() {
    setEditingOfferId(null);
    setEditingOfferPriceLockedUntil(null);
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
    setPresentialPackageMode(null);
    setPresentialHasFixedTerm(false);
    setPresentialTotalCycles("3");
    setPresentialSessionsPerCycle("8");
    setComboPresentialShare("0,00");
    setComboConsultancyShare("0,00");
    setAcceptsPix(true);
    setAcceptsDebitCard(true);
    setAcceptsCreditCard(true);
    setFichaValidityDays("");
    setOfferServiceMode(null);
    setOfferWizardStep(0);
  }

  function startEditOffer(offer: ProviderServiceOffer) {
    setEditingOfferId(offer.id);
    setEditingOfferPriceLockedUntil(offer.basePriceChangeLockedUntil ?? null);
    setOfferTitle(offer.title);
    setOfferKind(offer.kind);
    setOfferCycle(offer.billingCycle);
    setOfferPrice((offer.priceCents / 100).toFixed(2).replace(".", ","));
    setMarkAsPromotion(offer.isPromotion);
    setPromotionPrice(offer.promotionPriceCents ? (offer.promotionPriceCents / 100).toFixed(2).replace(".", ",") : "0,00");
    setPromotionEndsAt(offer.promotionEndsAt ? new Date(offer.promotionEndsAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
    setPromotionLabel(offer.promotionLabel ?? "");
    setPresentialPackageMode(offer.presentialPackageMode ?? null);
    setPresentialHasFixedTerm(Boolean(offer.presentialHasFixedTerm));
    setPresentialTotalCycles(offer.presentialTotalCycles ? String(offer.presentialTotalCycles) : "3");
    setPresentialSessionsPerCycle(offer.presentialSessionsPerCycle ? String(offer.presentialSessionsPerCycle) : "8");
    setComboPresentialShare(
      offer.comboPresentialShareCents ? (offer.comboPresentialShareCents / 100).toFixed(2).replace(".", ",") : "0,00"
    );
    setComboConsultancyShare(
      offer.comboConsultancyShareCents ? (offer.comboConsultancyShareCents / 100).toFixed(2).replace(".", ",") : "0,00"
    );
    setAcceptsPix(offer.acceptsPix ?? true);
    setAcceptsDebitCard(offer.acceptsDebitCard ?? true);
    setAcceptsCreditCard(offer.acceptsCreditCard ?? true);
    setFichaValidityDays(offer.fichaValidityDays ? String(offer.fichaValidityDays) : "");
    setOfferServiceMode(offer.offerServiceMode ?? null);
    setOfferFormVisible(true);
  }

  function openNewOfferForm() {
    resetOfferForm();
    setOfferFormVisible(true);
  }

  // Frente 5 (segunda camada), Lote 4: fechar o formulário (X, "Cancelar"
  // ou botão físico/gesto de voltar no Android, via onRequestClose)
  // descartava preço, dias, promoção etc. sem nenhuma confirmação. Editar
  // uma oferta já vem com os campos preenchidos, então qualquer edição em
  // andamento é tratada como "tem algo a perder" — mesmo critério usado no
  // treino (ProfessionalTrainingCreationScreen).
  const hasOfferFormChanges = Boolean(editingOfferId) || offerTitle.trim().length > 0 || basePriceCents > 0;

  function closeOfferForm() {
    if (hasOfferFormChanges) {
      Alert.alert(
        "Sair sem salvar?",
        "As alterações nesta oferta ainda não foram salvas e serão perdidas.",
        [
          { text: "Continuar editando", style: "cancel" },
          {
            text: "Sair sem salvar",
            style: "destructive",
            onPress: () => {
              resetOfferForm();
              setOfferFormVisible(false);
            },
          },
        ]
      );
      return;
    }
    resetOfferForm();
    setOfferFormVisible(false);
  }

  async function handleDeleteOffer(offerId: string) {
    Alert.alert("Excluir oferta", "Deseja excluir esta oferta permanentemente?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: async () => {
          // Frente 6 (Ofertas do profissional), Lote 4: a remoção otimista
          // (som antes da confirmação do backend) mostrava "Oferta
          // excluída." mesmo quando a exclusão ia falhar (ex: oferta já
          // vendida, sempre bloqueada por restrição de FK) — e o toast de
          // erro genérico "tente novamente" sugeria que repetir podia
          // funcionar, quando na verdade nunca vai pra essa oferta específica.
          setDeletingOfferId(offerId);
          try {
            await runWithAuth((token) => consultancyApi.deleteProviderOffer(token, offerId));
            setOffers((prev) => prev.filter((o) => o.id !== offerId));
            showToast("Oferta excluída.", "success");
          } catch (error) {
            const message =
              error instanceof ApiError
                ? error.message
                : "Não foi possível excluir a oferta. Tente novamente.";
            showToast(message, "error");
          } finally {
            setDeletingOfferId(null);
          }
        },
      },
    ]);
  }

  async function handleToggleOfferActive(offer: ProviderServiceOffer) {
    const nextIsActive = !(offer.isActive !== false);
    try {
      const updated = await runWithAuth((token) =>
        consultancyApi.updateProviderOffer(token, offer.id, { isActive: nextIsActive })
      );
      setOffers((prev) => prev.map((o) => (o.id === offer.id ? updated : o)));
      showToast(nextIsActive ? "Oferta reativada." : "Oferta desativada — ela some da vitrine, mas contratos ativos continuam normalmente.", "success");
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Não foi possível alterar o status da oferta.",
        onSubscriptionRequired: showSubscriptionRequiredSheet
      });
    }
  }

  // Substitui os 3 ícones de ação (olho/editar/excluir) que ficavam soltos no
  // card — concentrados aqui num único "⋯", seguindo o mesmo padrão de
  // Alert.alert já usado no resto da tela pra confirmações.
  function openOfferMenu(offer: ProviderServiceOffer) {
    const isActive = offer.isActive !== false;
    Alert.alert(offer.title, undefined, [
      {
        text: isActive ? "Ocultar da vitrine" : "Reativar oferta",
        onPress: () => void handleToggleOfferActive(offer),
      },
      { text: "Editar", onPress: () => startEditOffer(offer) },
      {
        text: "Excluir",
        style: "destructive",
        onPress: () => void handleDeleteOffer(offer.id),
      },
      { text: "Cancelar", style: "cancel" },
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
    if (presentialPackageError) {
      showToast(presentialPackageError, "error");
      return;
    }
    if (comboShareError) {
      showToast(comboShareError, "error");
      return;
    }
    if (paymentMethodsError) {
      showToast(paymentMethodsError, "error");
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
            presentialPackageMode,
            presentialHasFixedTerm: presentialPackageMode ? presentialHasFixedTerm : false,
            presentialTotalCycles:
              presentialPackageMode && presentialHasFixedTerm ? Math.max(1, Number(presentialTotalCycles) || 1) : null,
            presentialSessionsPerCycle:
              presentialPackageMode ? Math.max(1, Number(presentialSessionsPerCycle) || 1) : null,
            comboPresentialShareCents:
              offerKind === "COMBO" && presentialPackageMode ? comboPresentialShareCents : null,
            comboConsultancyShareCents:
              offerKind === "COMBO" && presentialPackageMode ? comboConsultancyShareCents : null,
            acceptsPix,
            acceptsDebitCard,
            acceptsCreditCard,
            fichaValidityDays: offerKind !== "PRESENTIAL" && fichaValidityDays.trim() ? Number(fichaValidityDays) : null,
            offerServiceMode:
              offerKind === "PRESENTIAL" || offerKind === "COMBO" ? offerServiceMode : null,
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
            presentialPackageMode: presentialPackageMode ?? undefined,
            presentialHasFixedTerm: presentialPackageMode ? presentialHasFixedTerm : undefined,
            presentialTotalCycles:
              presentialPackageMode && presentialHasFixedTerm
                ? Math.max(1, Number(presentialTotalCycles) || 1)
                : undefined,
            presentialSessionsPerCycle: presentialPackageMode
              ? Math.max(1, Number(presentialSessionsPerCycle) || 1)
              : undefined,
            comboPresentialShareCents:
              offerKind === "COMBO" && presentialPackageMode ? comboPresentialShareCents : undefined,
            comboConsultancyShareCents:
              offerKind === "COMBO" && presentialPackageMode ? comboConsultancyShareCents : undefined,
            acceptsPix,
            acceptsDebitCard,
            acceptsCreditCard,
            fichaValidityDays:
              offerKind !== "PRESENTIAL" && fichaValidityDays.trim() ? Number(fichaValidityDays) : undefined,
            offerServiceMode:
              offerKind === "PRESENTIAL" || offerKind === "COMBO" ? offerServiceMode ?? undefined : undefined,
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
      handleScreenError({
        error,
        showToast,
        fallbackMessage: editingOfferId ? "Falha ao atualizar oferta." : "Falha ao criar oferta.",
        navigation,
        onSubscriptionRequired: showSubscriptionRequiredSheet
      });
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
      <ScrollView
        style={{ flex: 1 }}
        automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100, gap: 12 }}
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
            <View style={{ gap: 10 }}>
              {offers.map((offer) => {
                const hasDiscount = offer.isPromotionActive && offer.promotionPriceCents && offer.priceCents !== offer.promotionPriceCents;
                const kindLabel = offerKindOptions.find((o) => o.value === offer.kind)?.label ?? offer.kind;
                const isActive = offer.isActive !== false;
                return (
                  <View
                    key={offer.id}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 16,
                      backgroundColor: theme.mode === "dark" ? "rgba(255,255,255,0.015)" : "#FFFFFF",
                      padding: 16,
                      opacity: deletingOfferId === offer.id ? 0.45 : 1,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 5,
                          alignSelf: "flex-start",
                          backgroundColor: theme.mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                          borderWidth: 1,
                          borderColor: theme.border,
                          borderRadius: 999,
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                        }}
                      >
                        <Ionicons name={offerKindIcon[offer.kind]} size={11} color={theme.text2} />
                        <MvText
                          style={{ fontFamily: "DMSans_700Bold", fontSize: 10.5, letterSpacing: 0.3, textTransform: "uppercase", color: theme.text2 }}
                          numberOfLines={1}
                        >
                          {kindLabel}
                        </MvText>
                      </View>
                      {offer.isPromotionActive ? <MvBadge label="Promo" variant="orange" /> : null}
                    </View>

                    <MvText variant="h4" numberOfLines={2} style={{ marginTop: 10 }}>{offer.title}</MvText>
                    <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
                      {offerDescription(offer)}
                    </MvText>
                    {offer.basePriceChangeLockedUntil && new Date(offer.basePriceChangeLockedUntil) > new Date() ? (
                      <MvText variant="caption" color="secondary" style={{ marginTop: 6 }}>
                        Valor alterável a partir de {formatBRDate(offer.basePriceChangeLockedUntil)}
                      </MvText>
                    ) : null}

                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 14,
                        paddingTop: 12,
                        borderTopWidth: 1,
                        borderTopColor: theme.border,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap", flexShrink: 1 }}>
                        <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 21, letterSpacing: -0.2, color: theme.textGreen }}>
                          {formatCurrencyBRL(offerEffectivePriceCents(offer) / 100)}
                        </MvText>
                        {hasDiscount ? (
                          <MvText variant="caption" color="secondary" style={{ textDecorationLine: "line-through" }}>
                            {formatCurrencyBRL(offer.priceCents / 100)}
                          </MvText>
                        ) : null}
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isActive ? theme.primary : theme.text3 }} />
                          <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 11.5, color: isActive ? theme.textGreen : theme.text3 }}>
                            {isActive ? "Ativa" : "Inativa"}
                          </MvText>
                        </View>
                        <PressableScale
                          onPress={() => openOfferMenu(offer)}
                          disabled={deletingOfferId === offer.id}
                          scale={0.94}
                          accessibilityLabel="Gerenciar oferta"
                          style={{
                            width: 30, height: 30, borderRadius: 9,
                            backgroundColor: theme.mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                            alignItems: "center", justifyContent: "center",
                          }}
                        >
                          <Ionicons name="ellipsis-horizontal" size={16} color={theme.text2} />
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
                <MvText variant="caption" color="secondary">
                  O tipo da oferta (presencial, consultoria, combo) não pode ser trocado depois de criada — crie uma
                  nova oferta se precisar de um tipo diferente.
                </MvText>
                <MvInput
                  editable={offerKind !== "COMBO"}
                  placeholder={offerKind === "COMBO" ? "Combo (titulo fixo)" : "Titulo da oferta"}
                  value={offerTitle}
                  onChangeText={setOfferTitle}
                />
                {offerKind === "PRESENTIAL" ? (
                  <MvInput keyboardType="numeric" label="Dias por semana (presencial)" placeholder="Ex: 3" value={daysPerWeek} onChangeText={setDaysPerWeek} />
                ) : null}
                {offerKind !== "PRESENTIAL" ? (
                  <View style={{ gap: 4 }}>
                    <MvInput
                      keyboardType="numeric"
                      label="Validade de cada ficha (dias) — opcional"
                      placeholder="Ex: 30"
                      value={fichaValidityDays}
                      onChangeText={setFichaValidityDays}
                    />
                    <MvText variant="caption" color="secondary">
                      Quando a ficha vence, você é avisado pra renovar — a renovação cobra o valor desta oferta de
                      novo. Se deixar em branco, a ficha não tem validade automática.
                    </MvText>
                  </View>
                ) : null}
                {offerKind === "COMBO" ? (
                  <>
                    <MvInput keyboardType="numeric" label="Dias presenciais por semana" placeholder="Ex: 3" value={comboPresentialDaysPerWeek} onChangeText={setComboPresentialDaysPerWeek} />
                    <MvInput keyboardType="numeric" label="Dias online por semana" placeholder="Ex: 2" value={comboOnlineDaysPerWeek} onChangeText={setComboOnlineDaysPerWeek} />
                    {comboDaysError ? <MvText variant="body4" color="danger">{comboDaysError}</MvText> : null}
                  </>
                ) : null}
                {(offerKind === "PRESENTIAL" || offerKind === "COMBO") && profileServiceMode === "BOTH" ? (
                  <View style={{ gap: 8 }}>
                    <MvText variant="body4" color="secondary">Local de atendimento desta oferta</MvText>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {([
                        { value: null, label: "Igual ao perfil" },
                        { value: "PRESENTIAL_ONLY" as const, label: "Só local fixo" },
                        { value: "HOME_VISIT_ONLY" as const, label: "Só domicílio" },
                      ]).map((opt) => {
                        const sel = offerServiceMode === opt.value;
                        return (
                          <PressableScale
                            key={opt.label}
                            scale={0.97}
                            onPress={() => setOfferServiceMode(opt.value)}
                            style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: sel ? theme.primarySubtleBorder : theme.border, backgroundColor: sel ? theme.primarySubtle : theme.cardBg, padding: 8, alignItems: "center" }}
                          >
                            <MvText variant="caption" style={{ color: sel ? theme.textGreen : theme.text1 }}>{opt.label}</MvText>
                          </PressableScale>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
                {offerKind === "PRESENTIAL" ? (
                  <Chip
                    label={presentialPackageMode ? "Vendido como pacote (cobrança em ciclos)" : "Vender como pacote (cobrança em ciclos)"}
                    selected={Boolean(presentialPackageMode)}
                    onPress={() => setPresentialPackageMode((current) => (current ? null : "FIXED_RECURRING"))}
                  />
                ) : null}
                {offerKind === "COMBO" || (offerKind === "PRESENTIAL" && presentialPackageMode) ? (
                  <View style={{ gap: 8 }}>
                    <MvText variant="body4" color="secondary">Modelo do pacote</MvText>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {([
                        { value: "FIXED_RECURRING" as const, label: "Horário fixo", desc: "Mesmo dia/horário toda semana" },
                        { value: "FLEXIBLE_CREDITS" as const, label: "Sessões avulsas", desc: "Bloco fechado, aluno agenda quando quiser" },
                      ]).map((opt) => {
                        const sel = presentialPackageMode === opt.value;
                        return (
                          <PressableScale
                            key={opt.value}
                            scale={0.97}
                            onPress={() => setPresentialPackageMode(opt.value)}
                            style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: sel ? theme.primarySubtleBorder : theme.border, backgroundColor: sel ? theme.primarySubtle : theme.cardBg, padding: 10 }}
                          >
                            <MvText variant="body4" style={{ color: sel ? theme.textGreen : theme.text1, fontWeight: sel ? "700" : "400" }}>{opt.label}</MvText>
                            <MvText variant="caption" color="secondary">{opt.desc}</MvText>
                          </PressableScale>
                        );
                      })}
                    </View>
                    <MvInput
                      keyboardType="numeric"
                      label={presentialPackageMode === "FLEXIBLE_CREDITS" ? "Total de sessões no pacote" : "Sessões por ciclo"}
                      placeholder="Ex: 8"
                      value={presentialSessionsPerCycle}
                      onChangeText={setPresentialSessionsPerCycle}
                    />
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <MvText variant="body4">Vigência com prazo determinado</MvText>
                      <MvToggle value={presentialHasFixedTerm} onValueChange={setPresentialHasFixedTerm} accessibilityLabel="Vigência com prazo determinado" />
                    </View>
                    {presentialHasFixedTerm ? (
                      <MvInput keyboardType="numeric" label="Total de ciclos" placeholder="Ex: 3" value={presentialTotalCycles} onChangeText={setPresentialTotalCycles} />
                    ) : (
                      <MvText variant="caption" color="secondary">Sem prazo definido — renova sozinho até o aluno ou você cancelar.</MvText>
                    )}
                    {presentialPackageError ? <MvText variant="body4" color="danger">{presentialPackageError}</MvText> : null}
                    {offerKind === "COMBO" ? (
                      <>
                        <MvInput keyboardType="numeric" label="Valor da metade presencial (R$)" placeholder="Ex: 600,00" value={comboPresentialShare} onChangeText={(value) => setComboPresentialShare(maskPriceInput(value))} />
                        <MvInput keyboardType="numeric" label="Valor da metade consultoria (R$)" placeholder="Ex: 400,00" value={comboConsultancyShare} onChangeText={(value) => setComboConsultancyShare(maskPriceInput(value))} />
                        {comboShareError ? <MvText variant="body4" color="danger">{comboShareError}</MvText> : null}
                      </>
                    ) : null}
                  </View>
                ) : null}
                <MvInput
                  keyboardType="numeric"
                  placeholder="Valor base (R$)"
                  value={offerPrice}
                  onChangeText={(value) => setOfferPrice(maskPriceInput(value))}
                  editable={!editingOfferPriceLocked}
                />
                <MvText variant="caption" color={editingOfferPriceLocked ? "warning" : "secondary"}>
                  {editingOfferPriceLocked
                    ? `Valor base travado até ${formatBRDate(editingOfferPriceLockedUntil)} (só pode mudar 1 vez a cada 30 dias).`
                    : "O valor base pode ser alterado apenas 1 vez a cada 30 dias."}
                </MvText>
                {offerKind !== "COMBO" ? (
                  <>
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
                  </>
                ) : null}
                {!crefValidated ? (
                  <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>Publicar ofertas fica disponível quando seu CREF for aprovado.</MvText>
                ) : !subscriptionActive ? (
                  <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>Exige assinatura ativa.</MvText>
                ) : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <MvButton label="Salvar alterações" loading={creatingOffer} disabled={!canSaveOffer || Boolean(promotionValueError || promotionDateError || comboDaysError || presentialPackageError || comboShareError)} onPress={() => void handleCreateOffer()} />
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

                    <MvText variant="body4" style={{ marginTop: 6 }}>Formas de pagamento aceitas</MvText>
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      <Chip label="Pix" selected={acceptsPix} onPress={() => setAcceptsPix((c) => !c)} />
                      <Chip label="Débito" selected={acceptsDebitCard} onPress={() => setAcceptsDebitCard((c) => !c)} />
                      <Chip label="Crédito" selected={acceptsCreditCard} onPress={() => setAcceptsCreditCard((c) => !c)} />
                    </View>
                    {paymentMethodsError ? <MvText variant="body4" color="danger">{paymentMethodsError}</MvText> : null}

                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <MvButton variant="outline" label="← Voltar" onPress={() => setOfferWizardStep(0)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <MvButton label="Avançar →" disabled={basePriceCents < 100 || Boolean(paymentMethodsError)} onPress={() => setOfferWizardStep(2)} />
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
                      <MvInput keyboardType="numeric" label="Dias por semana (presencial)" placeholder="Ex: 3" value={daysPerWeek} onChangeText={setDaysPerWeek} />
                    ) : null}
                    {offerKind === "COMBO" ? (
                      <>
                        <MvInput keyboardType="numeric" label="Dias presenciais por semana" placeholder="Ex: 3" value={comboPresentialDaysPerWeek} onChangeText={setComboPresentialDaysPerWeek} />
                        <MvInput keyboardType="numeric" label="Dias online por semana" placeholder="Ex: 2" value={comboOnlineDaysPerWeek} onChangeText={setComboOnlineDaysPerWeek} />
                        {comboDaysError ? <MvText variant="body4" color="danger">{comboDaysError}</MvText> : null}
                      </>
                    ) : null}
                    {offerKind === "PRESENTIAL" ? (
                      <Chip
                        label={presentialPackageMode ? "Vendido como pacote (cobrança em ciclos)" : "Vender como pacote (cobrança em ciclos)"}
                        selected={Boolean(presentialPackageMode)}
                        onPress={() => setPresentialPackageMode((current) => (current ? null : "FIXED_RECURRING"))}
                      />
                    ) : null}
                    {offerKind === "COMBO" || (offerKind === "PRESENTIAL" && presentialPackageMode) ? (
                      <View style={{ gap: 8 }}>
                        <MvText variant="body4" color="secondary">Modelo do pacote</MvText>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          {([
                            { value: "FIXED_RECURRING" as const, label: "Horário fixo", desc: "Mesmo dia/horário toda semana" },
                            { value: "FLEXIBLE_CREDITS" as const, label: "Sessões avulsas", desc: "Bloco fechado, aluno agenda quando quiser" },
                          ]).map((opt) => {
                            const sel = presentialPackageMode === opt.value;
                            return (
                              <PressableScale
                                key={opt.value}
                                scale={0.97}
                                onPress={() => setPresentialPackageMode(opt.value)}
                                style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: sel ? theme.primarySubtleBorder : theme.border, backgroundColor: sel ? theme.primarySubtle : theme.cardBg, padding: 10 }}
                              >
                                <MvText variant="body4" style={{ color: sel ? theme.textGreen : theme.text1, fontWeight: sel ? "700" : "400" }}>{opt.label}</MvText>
                                <MvText variant="caption" color="secondary">{opt.desc}</MvText>
                              </PressableScale>
                            );
                          })}
                        </View>
                        <MvInput
                          keyboardType="numeric"
                          label={presentialPackageMode === "FLEXIBLE_CREDITS" ? "Total de sessões no pacote" : "Sessões por ciclo"}
                          placeholder="Ex: 8"
                          value={presentialSessionsPerCycle}
                          onChangeText={setPresentialSessionsPerCycle}
                        />
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          <MvText variant="body4">Vigência com prazo determinado</MvText>
                          <MvToggle value={presentialHasFixedTerm} onValueChange={setPresentialHasFixedTerm} accessibilityLabel="Vigência com prazo determinado" />
                        </View>
                        {presentialHasFixedTerm ? (
                          <MvInput keyboardType="numeric" label="Total de ciclos" placeholder="Ex: 3" value={presentialTotalCycles} onChangeText={setPresentialTotalCycles} />
                        ) : (
                          <MvText variant="caption" color="secondary">Sem prazo definido — renova sozinho até o aluno ou você cancelar.</MvText>
                        )}
                        {presentialPackageError ? <MvText variant="body4" color="danger">{presentialPackageError}</MvText> : null}
                        {offerKind === "COMBO" ? (
                          <>
                            <MvInput keyboardType="numeric" label="Valor da metade presencial (R$)" placeholder="Ex: 600,00" value={comboPresentialShare} onChangeText={(value) => setComboPresentialShare(maskPriceInput(value))} />
                            <MvInput keyboardType="numeric" label="Valor da metade consultoria (R$)" placeholder="Ex: 400,00" value={comboConsultancyShare} onChangeText={(value) => setComboConsultancyShare(maskPriceInput(value))} />
                            {comboShareError ? <MvText variant="body4" color="danger">{comboShareError}</MvText> : null}
                          </>
                        ) : null}
                      </View>
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
                          disabled={
                            (offerKind !== "COMBO" && !offerTitle.trim()) ||
                            Boolean(presentialPackageError || comboShareError)
                          }
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
                      {presentialPackageMode ? (
                        <MvText variant="caption" color="secondary">
                          {packageModeLabel(presentialPackageMode)} · {presentialSessionsPerCycle} por ciclo
                          {presentialHasFixedTerm ? ` · ${presentialTotalCycles} ciclos` : " · sem prazo"}
                          {offerKind === "COMBO"
                            ? ` (${formatCurrencyBRL(comboPresentialShareCents / 100)} presencial + ${formatCurrencyBRL(comboConsultancyShareCents / 100)} consultoria)`
                            : ""}
                        </MvText>
                      ) : null}
                      <MvText variant="caption" color="secondary">
                        Aceita: {[acceptsPix && "Pix", acceptsDebitCard && "Débito", acceptsCreditCard && "Crédito"].filter(Boolean).join(", ")}
                      </MvText>
                      {offerKind !== "PRESENTIAL" && fichaValidityDays.trim() ? (
                        <MvText variant="caption" color="secondary">
                          Cada ficha vale {fichaValidityDays} dias — renovação cobra {formatCurrencyBRL(basePriceCents / 100)} de novo.
                        </MvText>
                      ) : null}
                    </View>
                    {!crefValidated ? (
                      <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>Publicar ofertas fica disponível quando seu CREF for aprovado.</MvText>
                    ) : !subscriptionActive ? (
                      <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>Exige assinatura ativa.</MvText>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <MvButton variant="outline" label="← Voltar" onPress={() => setOfferWizardStep(2)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <MvButton
                          label="Criar oferta"
                          loading={creatingOffer}
                          disabled={
                            !canSaveOffer ||
                            Boolean(promotionValueError || promotionDateError || comboDaysError || presentialPackageError || comboShareError || paymentMethodsError)
                          }
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
    </View>
  );
}
