import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import {
  ApiError,
  consultancyApi,
  ConsultancyRequest,
  OfferBillingCycle,
  ProviderServiceOffer,
  providersApi,
  ServiceOfferKind,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvProgressBar, MvText } from "../../components/mv";
import { formatBRDate, formatCurrencyBRL, maskDateInputBR, maskPriceInput } from "../../utils/formatters";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalConsultancyCenter">;
type CenterTab = "dashboard" | "offers" | "requests";

const centerTabs: Array<{ key: CenterTab; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "dashboard", label: "Painel", icon: "speedometer-outline" },
  { key: "offers", label: "Ofertas", icon: "pricetag-outline" },
  { key: "requests", label: "Solicitacoes", icon: "chatbubbles-outline" },
];

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

function requestStatusLabel(status: ConsultancyRequest["status"]) {
  const map: Record<string, string> = {
    OPEN: "Aberto",
    RESPONDED: "Respondido",
    ACCEPTED: "Aceito",
    REFUSED: "Recusado",
    EXPIRED_REFUNDED: "Expirado/Estornado",
    ARCHIVED: "Arquivado",
  };
  return map[status] ?? status;
}

function requestStatusVariant(status: ConsultancyRequest["status"]): "green" | "blue" | "orange" | "red" | "gray" {
  if (status === "ACCEPTED") return "green";
  if (status === "RESPONDED") return "blue";
  if (status === "OPEN") return "orange";
  if (status === "REFUSED" || status === "EXPIRED_REFUNDED") return "red";
  return "gray";
}

function offerEffectivePriceCents(offer: ProviderServiceOffer) {
  if (offer.isPromotionActive && offer.promotionPriceCents) return offer.promotionPriceCents;
  return offer.priceCents;
}

export function ProfessionalConsultancyCenterScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const iconColor = theme.mode === "dark" ? "#D8E0D8" : "#394239";

  const [loading, setLoading] = useState(true);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);
  const [crefValidated, setCrefValidated] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingOffer, setCreatingOffer] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [deletingOfferId, setDeletingOfferId] = useState<string | null>(null);
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<CenterTab>("dashboard");
  const [settingsEnabled, setSettingsEnabled] = useState(false);
  const [responseSlaDays, setResponseSlaDays] = useState("7");
  const [prebuiltPlanCount, setPrebuiltPlanCount] = useState(0);
  const [offers, setOffers] = useState<ProviderServiceOffer[]>([]);
  const [requests, setRequests] = useState<ConsultancyRequest[]>([]);
  const [selectedOfferByRequest, setSelectedOfferByRequest] = useState<Record<string, string>>({});

  // Offer form
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

  const [responseTextByRequest, setResponseTextByRequest] = useState<Record<string, string>>({});

  const onlineOffers = useMemo(
    () =>
      offers.filter(
        (item) =>
          item.isActive !== false &&
          (item.kind === "ONLINE_CONSULTANCY" || item.kind === "ONLINE_CONSULTANCY_SPECIALIZED" || item.kind === "COMBO")
      ),
    [offers]
  );

  const activeRequests = useMemo(
    () => requests.filter((item) => item.status === "OPEN" || item.status === "RESPONDED" || item.status === "ACCEPTED"),
    [requests]
  );

  const openRequests = useMemo(() => activeRequests.filter((item) => item.status === "OPEN"), [activeRequests]);
  const respondedRequests = useMemo(() => activeRequests.filter((item) => item.status === "RESPONDED"), [activeRequests]);
  const acceptedRequests = useMemo(() => activeRequests.filter((item) => item.status === "ACCEPTED"), [activeRequests]);
  const promotionCount = useMemo(() => offers.filter((item) => item.isPromotionActive).length, [offers]);

  const averageTicket = useMemo(() => {
    if (!onlineOffers.length) return 0;
    const total = onlineOffers.reduce((sum, item) => sum + offerEffectivePriceCents(item), 0);
    return Math.round(total / onlineOffers.length);
  }, [onlineOffers]);

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
    if (!promotionEndsAt.trim()) return "Informe ate quando a promocao ficara valida.";
    if (!parsedPromotionEndsAt) return "Use o formato DD/MM/AAAA.";
    if (parsedPromotionEndsAt.getTime() <= Date.now()) return "A data final da promocao precisa ser futura.";
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

  const readinessChecklist = useMemo(
    () => [
      {
        key: "profile",
        title: "Perfil profissional completo",
        detail: "Necessario para publicar ofertas e responder alunos.",
        done: !needsProfileSetup,
      },
      {
        key: "cref",
        title: "CREF validado",
        detail: "Sem validação, os lancamentos ficam bloqueados.",
        done: crefValidated,
      },
      {
        key: "plan",
        title: "Treino pre-pronto cadastrado",
        detail: "Garante entrega rapida da consultoria.",
        done: prebuiltPlanCount > 0,
      },
      {
        key: "offer",
        title: "Oferta online ativa",
        detail: "Necessário para enviar proposta nas solicitações.",
        done: onlineOffers.length > 0,
      },
      {
        key: "settings",
        title: "Consultoria online habilitada",
        detail: "Permite aparecer como disponivel para novos alunos.",
        done: settingsEnabled,
      },
    ],
    [crefValidated, needsProfileSetup, onlineOffers.length, prebuiltPlanCount, settingsEnabled]
  );

  const readinessScore = useMemo(() => {
    const done = readinessChecklist.filter((item) => item.done).length;
    return readinessChecklist.length ? done / readinessChecklist.length : 0;
  }, [readinessChecklist]);

  const nextGuidedStep = useMemo(
    () => readinessChecklist.find((item) => !item.done),
    [readinessChecklist]
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [providerSettings, providerOffers, providerRequests, credentialsResult, providerPlans] = await Promise.all([
        runWithAuth((token) => consultancyApi.providerSettings(token)).catch((err) => {
          const msg = err instanceof Error ? err.message : "";
          const profileMissing =
            (err instanceof ApiError && err.status === 404) ||
            msg.toLowerCase().includes("perfil profissional") ||
            msg.toLowerCase().includes("provider profile");
          if (profileMissing) return null;
          throw err;
        }),
        runWithAuth((token) => consultancyApi.providerOffers(token)).catch(() => [] as ProviderServiceOffer[]),
        runWithAuth((token) => consultancyApi.providerRequests(token)).catch(() => [] as ConsultancyRequest[]),
        runWithAuth((token) => providersApi.myCredentials(token)).catch(() => null),
        runWithAuth((token) => consultancyApi.providerPlans(token)).catch(() => []),
      ]);

      const profileMissing = providerSettings === null;
      const availableOnlineOffers = providerOffers.filter(
        (item) =>
          item.isActive !== false &&
          (item.kind === "ONLINE_CONSULTANCY" || item.kind === "ONLINE_CONSULTANCY_SPECIALIZED" || item.kind === "COMBO")
      );

      setNeedsProfileSetup(profileMissing);
      const credentials = credentialsResult as
        | {
            crefValidatedAt?: string | null;
            crefValidationStatus?: "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED";
          }
        | null;
      setCrefValidated(credentials?.crefValidationStatus === "APPROVED");
      setPrebuiltPlanCount((providerPlans as Array<{ isPrebuilt?: boolean }>).filter((item) => item.isPrebuilt !== false).length);
      setOffers(providerOffers);
      setRequests(providerRequests);

      if (!profileMissing && providerSettings) {
        setSettingsEnabled(providerSettings.enabled);
        setResponseSlaDays(String(providerSettings.responseSlaDays));
      }

      setResponseTextByRequest((current) => {
        const next = { ...current };
        providerRequests.forEach((item) => {
          if (!next[item.id]) next[item.id] = "";
        });
        return next;
      });

      setSelectedOfferByRequest((current) => {
        const next = { ...current };
        providerRequests.forEach((item) => {
          if (!next[item.id] && availableOnlineOffers[0]) {
            next[item.id] = availableOnlineOffers[0].id;
          }
        });
        return next;
      });
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar central de consultoria.", navigation });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleOnlineSetting(enabled: boolean) {
    try {
      setSavingSettings(true);
      const response = await runWithAuth((token) =>
        consultancyApi.upsertProviderSettings(token, { enabled, responseSlaDays: Number(responseSlaDays) || 7 })
      );
      setSettingsEnabled(response.enabled);
      setResponseSlaDays(String(response.responseSlaDays));
      showToast(enabled ? "Consultoria online habilitada." : "Consultoria online desabilitada.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao atualizar configuração.", navigation });
    } finally {
      setSavingSettings(false);
    }
  }

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
  }

  function startEditOffer(offer: ProviderServiceOffer) {
    setEditingOfferId(offer.id);
    setOfferTitle(offer.title);
    setOfferKind(offer.kind);
    setOfferCycle(offer.billingCycle);
    setOfferPrice((offer.priceCents / 100).toFixed(2).replace(".", ","));
    setMarkAsPromotion(offer.isPromotion);
    setPromotionPrice(offer.promotionPriceCents ? (offer.promotionPriceCents / 100).toFixed(2).replace(".", ",") : "0,00");
    setPromotionEndsAt(offer.promotionEndsAt ? new Date(offer.promotionEndsAt).toLocaleDateString("pt-BR") : "");
    setPromotionLabel(offer.promotionLabel ?? "");
    setSelectedTab("offers");
  }

  async function handleDeleteOffer(offerId: string) {
    Alert.alert("Excluir oferta", "Deseja excluir esta oferta permanentemente?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: () => {
          // Remove imediatamente da UI (otimista)
          const removed = offers.find((o) => o.id === offerId) ?? null;
          setOffers((prev) => prev.filter((o) => o.id !== offerId));
          showToast("Oferta excluída.", "success");

          // Confirma no servidor em segundo plano
          runWithAuth((token) => consultancyApi.deleteProviderOffer(token, offerId)).catch(() => {
            // Falhou: restaura a oferta e avisa
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
      showToast(promotionValueError ?? promotionDateError ?? "Promocao invalida.", "error");
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
        showToast("Oferta criada com sucesso.", "success");
      }

      resetOfferForm();
      await load();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: editingOfferId ? "Falha ao atualizar oferta." : "Falha ao criar oferta.", navigation });
    } finally {
      setCreatingOffer(false);
    }
  }

  async function respondRequest(requestId: string) {
    const text = responseTextByRequest[requestId]?.trim();
    if (!text) {
      showToast("Escreva uma resposta para o aluno.", "error");
      return;
    }
    if (!onlineOffers.length) {
      showToast("Cadastre uma oferta online para responder.", "error");
      return;
    }

    const selectedOfferId = selectedOfferByRequest[requestId] ?? onlineOffers[0]?.id;
    if (!selectedOfferId) {
      showToast("Selecione uma oferta para enviar ao aluno.", "error");
      return;
    }

    try {
      setRespondingRequestId(requestId);
      await runWithAuth((token) =>
        consultancyApi.respondRequest(token, requestId, {
          providerResponseText: text,
          quotedOfferId: selectedOfferId,
        })
      );
      showToast("Resposta enviada ao aluno.", "success");
      setResponseTextByRequest((current) => ({ ...current, [requestId]: "" }));
      await load();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao responder solicitacao.", navigation });
    } finally {
      setRespondingRequestId(null);
    }
  }

  function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
    return (
      <TouchableOpacity
        onPress={onPress}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 20,
          backgroundColor: selected ? "rgba(34,197,94,0.12)" : theme.chipBg,
          borderWidth: 1,
          borderColor: selected ? "rgba(34,197,94,0.30)" : theme.border,
        }}
      >
        <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.text2 }}>
          {label}
        </MvText>
      </TouchableOpacity>
    );
  }

  function StatCard({
    label,
    value,
    hint,
    icon,
  }: {
    label: string;
    value: string;
    hint: string;
    icon: keyof typeof Ionicons.glyphMap;
  }) {
    return (
      <View
        style={{
          flexBasis: "48%",
          flexGrow: 1,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.inputBg,
          borderRadius: 12,
          padding: 10,
          gap: 5,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <MvText variant="body4" color="secondary">
            {label}
          </MvText>
          <Ionicons name={icon} size={16} color={iconColor} />
        </View>
        <MvText variant="h4">{value}</MvText>
        <MvText variant="caption" color="secondary">
          {hint}
        </MvText>
      </View>
    );
  }

  function QuickAction({
    icon,
    title,
    subtitle,
    onPress,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    subtitle: string;
    onPress: () => void;
  }) {
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        style={{
          flexBasis: "48%",
          flexGrow: 1,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 12,
          backgroundColor: theme.mode === "dark" ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.8)",
          padding: 10,
          gap: 4,
        }}
      >
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={icon} size={15} color={iconColor} />
        </View>
        <MvText variant="semi3">{title}</MvText>
        <MvText variant="caption" color="secondary">
          {subtitle}
        </MvText>
      </TouchableOpacity>
    );
  }

  const firstOpenRequest = openRequests[0];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.consultancy">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={iconColor} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <MvText variant="semi1">Consultoria</MvText>
          <MvText variant="caption" color="secondary">
            Gestão completa das suas ofertas e solicitações.
          </MvText>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate("ProfessionalArchivedRequests")}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 20,
            paddingHorizontal: 10,
            paddingVertical: 7,
            backgroundColor: theme.cardBg,
          }}
        >
          <Ionicons name="archive-outline" size={14} color={iconColor} />
          <MvText variant="body4">Arquivados</MvText>
        </TouchableOpacity>
      </View>

      <ScrollView
        automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        <MvCard style={{ padding: 0, overflow: "hidden" }}>
          <View
            style={{
              paddingHorizontal: 12,
              paddingTop: 12,
              paddingBottom: 10,
              borderBottomWidth: 1,
              borderBottomColor: theme.border,
              backgroundColor: theme.mode === "dark" ? "rgba(34,197,94,0.08)" : "rgba(34,197,94,0.09)",
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <MvText variant="semi2">Sua central de vendas e atendimento</MvText>
                <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
                  Tudo em um fluxo unico: captar, responder e fechar consultorias.
                </MvText>
              </View>
              <MvBadge label={settingsEnabled ? "Online ativa" : "Online pausada"} variant={settingsEnabled ? "green" : "orange"} />
            </View>

            {nextGuidedStep ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.mode === "dark" ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  backgroundColor: theme.mode === "dark" ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.66)",
                  gap: 2,
                }}
              >
                <MvText variant="caption" color="secondary">
                  Próximo passo recomendado
                </MvText>
                <MvText variant="semi3">{nextGuidedStep.title}</MvText>
              </View>
            ) : (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: "rgba(34,197,94,0.30)",
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  backgroundColor: theme.mode === "dark" ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.14)",
                }}
              >
                <MvText variant="semi3" style={{ color: theme.textGreen }}>
                  Excelente: sua consultoria esta pronta para escalar.
                </MvText>
              </View>
            )}
          </View>

          <View style={{ padding: 12, gap: 8 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <StatCard label="Abertas" value={String(openRequests.length)} hint="Aguardando sua resposta" icon="mail-unread-outline" />
              <StatCard label="Em analise" value={String(respondedRequests.length)} hint="Aluno ainda decide" icon="time-outline" />
              <StatCard label="Aceitas" value={String(acceptedRequests.length)} hint="Contratos ativos" icon="checkmark-done-outline" />
              <StatCard label="Ticket online" value={averageTicket ? formatCurrencyBRL(averageTicket / 100) : "R$ 0,00"} hint="Media por oferta online" icon="cash-outline" />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <QuickAction
                icon="chatbubble-ellipses-outline"
                title="Responder agora"
                subtitle={openRequests.length ? `${openRequests.length} pendente(s)` : "Sem pendências"}
                onPress={() => setSelectedTab("requests")}
              />
              <QuickAction
                icon="pricetag-outline"
                title="Nova oferta"
                subtitle="Cadastrar e publicar servico"
                onPress={() => setSelectedTab("offers")}
              />
              <QuickAction
                icon="barbell-outline"
                title="Treino pre-pronto"
                subtitle={prebuiltPlanCount ? `${prebuiltPlanCount} cadastrado(s)` : "Criar primeira base"}
                onPress={() => navigation.navigate("TrainingCreation")}
              />
              <QuickAction
                icon="archive-outline"
                title="Arquivados"
                subtitle="Histórico de solicitações"
                onPress={() => navigation.navigate("ProfessionalArchivedRequests")}
              />
            </View>
          </View>
        </MvCard>

        {needsProfileSetup ? (
          <MvCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Ionicons name="warning-outline" size={16} color={theme.mode === "dark" ? "#FF9800" : "#9a4e00"} />
              <MvText variant="semi2">Perfil profissional incompleto</MvText>
            </View>
            <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
              Antes de publicar ofertas e responder alunos, conclua seu perfil profissional.
            </MvText>
            <MvButton
              label="Ir para meu perfil"
              onPress={() => navigation.navigate("ProfessionalTabs", { screen: "ProfessionalProfileEditor" })}
            />
          </MvCard>
        ) : null}

        {!crefValidated ? (
          <MvCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Ionicons name="shield-checkmark-outline" size={16} color={theme.mode === "dark" ? "#FF9800" : "#9a4e00"} />
              <MvText variant="semi2">CREF pendente de validação</MvText>
            </View>
            <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
              Esta funcionalidade ficará disponível quando seu CREF for aprovado.
            </MvText>
            <MvButton
              variant="outline"
              label="Ir para CREF e documentos"
              onPress={() => navigation.navigate("ProfessionalCredentials")}
            />
          </MvCard>
        ) : null}

        <MvCard style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {centerTabs.map((tab) => {
              const selected = selectedTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  onPress={() => setSelectedTab(tab.key)}
                  style={{
                    flex: 1,
                    paddingVertical: 9,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: selected ? "rgba(34,197,94,0.35)" : theme.border,
                    backgroundColor: selected ? "rgba(34,197,94,0.12)" : theme.inputBg,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <Ionicons name={tab.icon} size={14} color={selected ? theme.textGreen : iconColor} />
                  <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.text2 }}>
                    {tab.label}
                  </MvText>
                </TouchableOpacity>
              );
            })}
          </View>

          {selectedTab === "dashboard" ? (
            <View style={{ gap: 10 }}>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  padding: 10,
                  gap: 10,
                  backgroundColor: theme.inputBg,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <MvText variant="semi2">Checklist de prontidão</MvText>
                  <MvText variant="body4" color="secondary">
                    {Math.round(readinessScore * 100)}%
                  </MvText>
                </View>
                <MvProgressBar progress={readinessScore} height={5} />
                <View style={{ gap: 8 }}>
                  {readinessChecklist.map((item) => (
                    <View key={item.key} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                      <Ionicons
                        name={item.done ? "checkmark-circle" : "ellipse-outline"}
                        size={16}
                        color={item.done ? theme.textGreen : theme.text2}
                        style={{ marginTop: 1 }}
                      />
                      <View style={{ flex: 1 }}>
                        <MvText variant="semi3">{item.title}</MvText>
                        <MvText variant="caption" color="secondary">
                          {item.detail}
                        </MvText>
                      </View>
                    </View>
                  ))}
                </View>
              </View>

              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  padding: 10,
                  gap: 8,
                  backgroundColor: theme.inputBg,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <MvText variant="semi2">Modo consultoria online</MvText>
                  <MvBadge label={settingsEnabled ? "Habilitada" : "Desabilitada"} variant={settingsEnabled ? "green" : "orange"} />
                </View>
                <MvText variant="body4" color="secondary">
                  Defina em quantos dias você entrega um plano após o aceite do aluno.
                </MvText>
                <MvInput
                  keyboardType="numeric"
                  placeholder="Prazo máximo de entrega (dias)"
                  value={responseSlaDays}
                  onChangeText={setResponseSlaDays}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <MvButton label="Habilitar" loading={savingSettings} onPress={() => void toggleOnlineSetting(true)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvButton variant="outline" label="Desabilitar" loading={savingSettings} onPress={() => void toggleOnlineSetting(false)} />
                  </View>
                </View>
              </View>

              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  padding: 10,
                  gap: 8,
                  backgroundColor: theme.inputBg,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <MvText variant="semi2">Treinos pré-prontos</MvText>
                  <MvBadge label={prebuiltPlanCount ? `${prebuiltPlanCount} disponíveis` : "Nenhum"} variant={prebuiltPlanCount ? "green" : "orange"} />
                </View>
                <MvText variant="body4" color="secondary">
                  Deixe ao menos um treino base pronto para responder solicitações com agilidade.
                </MvText>
                <MvButton label={prebuiltPlanCount ? "Gerenciar treinos" : "Criar primeiro treino"} onPress={() => navigation.navigate("TrainingCreation")} />
              </View>

              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  padding: 10,
                  gap: 8,
                  backgroundColor: theme.inputBg,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <MvText variant="semi2">Fila de solicitações</MvText>
                  <MvBadge label={`${openRequests.length} abertas`} variant={openRequests.length ? "orange" : "gray"} />
                </View>
                {firstOpenRequest ? (
                  <>
                    <MvText variant="semi3">{firstOpenRequest.client?.name ?? "Aluno"}</MvText>
                    <MvText variant="body4" color="secondary">
                      Necessidade: {firstOpenRequest.trainingNeedText || "Não informado"}
                    </MvText>
                    <MvButton variant="outline" label="Ir para responder" onPress={() => setSelectedTab("requests")} />
                  </>
                ) : (
                  <MvText variant="body4" color="secondary">
                    Sem solicitações abertas agora. Continue promovendo seus serviços.
                  </MvText>
                )}
              </View>
            </View>
          ) : null}

          {selectedTab === "offers" ? (
            <View style={{ gap: 10 }}>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  padding: 10,
                  gap: 10,
                  backgroundColor: theme.inputBg,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <MvText variant="semi2">{editingOfferId ? "Editar oferta" : "Nova oferta de serviço"}</MvText>
                  {editingOfferId ? (
                    <TouchableOpacity onPress={resetOfferForm} style={{ padding: 4 }}>
                      <Ionicons name="close-circle-outline" size={20} color={theme.text3} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                <MvText variant="body4" color="secondary">
                  {editingOfferId ? "Altere os campos desejados e salve." : "Monte sua oferta com clareza de valor, frequência e promoção opcional."}
                </MvText>

                <MvInput
                  editable={offerKind !== "COMBO"}
                  placeholder={offerKind === "COMBO" ? "Combo (titulo fixo)" : "Titulo da oferta"}
                  value={offerTitle}
                  onChangeText={setOfferTitle}
                />

                {offerKind === "COMBO" ? (
                  <MvText variant="caption" color="secondary">
                    No tipo Combo, o titulo oficial sera "Combo".
                  </MvText>
                ) : null}

                <View>
                  <MvText variant="caption" color="secondary" style={{ marginBottom: 6 }}>
                    Tipo de oferta
                  </MvText>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {offerKindOptions.map((opt) => (
                      <Chip key={opt.value} label={opt.label} selected={offerKind === opt.value} onPress={() => setOfferKind(opt.value)} />
                    ))}
                  </View>
                </View>

                <View>
                  <MvText variant="caption" color="secondary" style={{ marginBottom: 6 }}>
                    Cobranca
                  </MvText>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {cycleOptions.map((opt) => (
                      <Chip key={opt.value} label={opt.label} selected={offerCycle === opt.value} onPress={() => setOfferCycle(opt.value)} />
                    ))}
                  </View>
                </View>

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
                <MvText variant="caption" color="secondary">
                  O valor base pode ser alterado apenas 1 vez a cada 30 dias.
                </MvText>

                <Chip label={markAsPromotion ? "Promocao ativa no cadastro" : "Marcar como promocao"} selected={markAsPromotion} onPress={() => setMarkAsPromotion((current) => !current)} />
                {markAsPromotion ? (
                  <>
                    <MvInput keyboardType="numeric" placeholder="Valor promocional (R$)" value={promotionPrice} onChangeText={(value) => setPromotionPrice(maskPriceInput(value))} />
                    {promotionValueError ? <MvText variant="body4" color="danger">{promotionValueError}</MvText> : null}
                    <MvInput
                      keyboardType="numeric"
                      placeholder="Validade (DD/MM/AAAA)"
                      value={promotionEndsAt}
                      onChangeText={(value) => setPromotionEndsAt(maskDateInputBR(value))}
                    />
                    {promotionDateError ? <MvText variant="body4" color="danger">{promotionDateError}</MvText> : null}
                    <MvInput placeholder="Texto da promocao (opcional)" value={promotionLabel} onChangeText={setPromotionLabel} />
                  </>
                ) : null}

                {!crefValidated ? (
                  <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
                    Esta funcionalidade ficará disponível quando seu CREF for aprovado.
                  </MvText>
                ) : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <MvButton
                      label={editingOfferId ? "Salvar alterações" : "Criar oferta"}
                      loading={creatingOffer}
                      disabled={!crefValidated || Boolean(promotionValueError || promotionDateError || comboDaysError)}
                      onPress={() => void handleCreateOffer()}
                    />
                  </View>
                  {editingOfferId ? (
                    <View style={{ flex: 1 }}>
                      <MvButton variant="outline" label="Cancelar" onPress={resetOfferForm} />
                    </View>
                  ) : null}
                </View>
              </View>

              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  padding: 10,
                  gap: 8,
                  backgroundColor: theme.inputBg,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <MvText variant="semi2">Ofertas cadastradas</MvText>
                  <MvBadge label={`${offers.length} total`} variant={offers.length ? "blue" : "gray"} />
                </View>
                {offers.length === 0 && !loading ? (
                  <MvText variant="body4" color="secondary">
                    Nenhuma oferta cadastrada ainda.
                  </MvText>
                ) : null}
                <View style={{ gap: 8 }}>
                  {offers.map((offer) => (
                    <View
                      key={offer.id}
                      style={{
                        borderWidth: 1,
                        borderColor: theme.border,
                        borderRadius: 10,
                        padding: 10,
                        backgroundColor: theme.mode === "dark" ? "rgba(0,0,0,0.10)" : "#FFFFFF",
                        gap: 5,
                      }}
                    >
                      {/* Linha do título + ações */}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={{ flex: 1 }}>
                          <MvText variant="semi3" numberOfLines={1}>{offer.title}</MvText>
                        </View>
                        <MvBadge label={offer.isActive !== false ? "Ativa" : "Inativa"} variant={offer.isActive !== false ? "green" : "gray"} />
                        <TouchableOpacity
                          onPress={() => startEditOffer(offer)}
                          hitSlop={8}
                          style={{
                            width: 28, height: 28, borderRadius: 8,
                            backgroundColor: theme.mode === "dark" ? "rgba(34,197,94,0.12)" : "rgba(21,128,61,0.09)",
                            alignItems: "center", justifyContent: "center",
                          }}
                        >
                          <Ionicons name="create-outline" size={15} color={theme.textGreen} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => void handleDeleteOffer(offer.id)}
                          hitSlop={8}
                          disabled={deletingOfferId === offer.id}
                          style={{
                            width: 28, height: 28, borderRadius: 8,
                            backgroundColor: "rgba(239,68,68,0.08)",
                            alignItems: "center", justifyContent: "center",
                            opacity: deletingOfferId === offer.id ? 0.45 : 1,
                          }}
                        >
                          <Ionicons name="trash-outline" size={15} color="#EF4444" />
                        </TouchableOpacity>
                      </View>

                      {/* Tipo e frequência */}
                      <MvText variant="caption" color="secondary">
                        {offerDescription(offer)}
                      </MvText>

                      {/* Preço */}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <MvText variant="semi3">
                          {formatCurrencyBRL(offerEffectivePriceCents(offer) / 100)}
                        </MvText>
                        {offer.isPromotionActive && offer.promotionPriceCents && offer.priceCents !== offer.promotionPriceCents ? (
                          <MvText variant="caption" style={{ color: theme.textGreen }}>
                            promoção{offer.promotionEndsAt ? ` até ${formatBRDate(offer.promotionEndsAt)}` : ""}
                          </MvText>
                        ) : null}
                      </View>

                      {/* Aviso de bloqueio de preço — só exibe se ainda bloqueado */}
                      {offer.basePriceChangeLockedUntil && new Date(offer.basePriceChangeLockedUntil) > new Date() ? (
                        <MvText variant="caption" color="secondary">
                          Valor base alterável a partir de {formatBRDate(offer.basePriceChangeLockedUntil)}
                        </MvText>
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
            </View>
          ) : null}

          {selectedTab === "requests" ? (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <MvText variant="semi2">Solicitacoes ativas</MvText>
                <MvBadge label={`${activeRequests.length} em andamento`} variant={activeRequests.length ? "blue" : "gray"} />
              </View>

              {activeRequests.length === 0 && !loading ? (
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 12,
                    padding: 12,
                    backgroundColor: theme.inputBg,
                    gap: 8,
                  }}
                >
                  <MvText variant="semi3">Sem solicitações ativas no momento</MvText>
                  <MvText variant="body4" color="secondary">
                    Assim que um aluno enviar pedido de consultoria, ele aparecerá aqui para você responder.
                  </MvText>
                  <MvButton variant="outline" label="Ver ofertas publicadas" onPress={() => setSelectedTab("offers")} />
                </View>
              ) : null}

              <View style={{ gap: 10 }}>
                {activeRequests.map((request) => {
                  const selectedOfferId = selectedOfferByRequest[request.id] ?? onlineOffers[0]?.id ?? "";
                  return (
                    <View
                      key={request.id}
                      style={{
                        borderWidth: 1,
                        borderColor: theme.border,
                        borderRadius: 10,
                        padding: 10,
                        backgroundColor: theme.inputBg,
                        gap: 6,
                      }}
                    >
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <MvText variant="semi3">{request.client?.name ?? "Aluno"}</MvText>
                          <MvText variant="caption" color="secondary">
                            Entrada em {formatBRDate(request.createdAt)}
                          </MvText>
                        </View>
                        <MvBadge label={requestStatusLabel(request.status)} variant={requestStatusVariant(request.status)} />
                      </View>
                      <MvText variant="body4" color="secondary">
                        Necessidade: {request.trainingNeedText || "Não informado"}
                      </MvText>
                      <MvText variant="body4" color="secondary">
                        Limitações: {request.limitationText || "Não informado"}
                      </MvText>
                      {request.extraInfoText ? (
                        <MvText variant="body4" color="secondary">
                          Observações: {request.extraInfoText}
                        </MvText>
                      ) : null}

                      {request.status === "OPEN" ? (
                        <>
                          {onlineOffers.length ? (
                            <View style={{ gap: 6 }}>
                              <MvText variant="caption" color="secondary">
                                Oferta que sera enviada junto da sua resposta
                              </MvText>
                              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                                {onlineOffers.map((offer) => {
                                  const selected = selectedOfferId === offer.id;
                                  return (
                                    <TouchableOpacity
                                      key={offer.id}
                                      onPress={() => setSelectedOfferByRequest((current) => ({ ...current, [request.id]: offer.id }))}
                                      style={{
                                        borderWidth: 1,
                                        borderColor: selected ? "rgba(34,197,94,0.35)" : theme.border,
                                        backgroundColor: selected ? "rgba(34,197,94,0.12)" : theme.cardBg,
                                        borderRadius: 18,
                                        paddingVertical: 6,
                                        paddingHorizontal: 10,
                                        maxWidth: "100%",
                                      }}
                                    >
                                      <MvText variant="caption" style={{ color: selected ? theme.textGreen : theme.text2 }}>
                                        {offer.title} - {formatCurrencyBRL(offerEffectivePriceCents(offer) / 100)}
                                      </MvText>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </View>
                          ) : (
                            <MvText variant="body4" color="warning">
                              Cadastre uma oferta online para poder responder esta solicitacao.
                            </MvText>
                          )}

                          <MvInput
                            placeholder="Resposta ao aluno: explique como voce pode ajudar e o que sera entregue."
                            multiline
                            numberOfLines={3}
                            value={responseTextByRequest[request.id] ?? ""}
                            onChangeText={(value) => setResponseTextByRequest((current) => ({ ...current, [request.id]: value }))}
                          />
                          <MvButton
                            label="Enviar proposta"
                            disabled={!onlineOffers.length}
                            loading={respondingRequestId === request.id}
                            onPress={() => void respondRequest(request.id)}
                          />
                        </>
                      ) : null}

                      {request.providerResponseText && request.status !== "OPEN" ? (
                        <View
                          style={{
                            borderWidth: 1,
                            borderColor: theme.border,
                            borderRadius: 8,
                            padding: 8,
                            backgroundColor: theme.mode === "dark" ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.8)",
                          }}
                        >
                          <MvText variant="caption" color="secondary">
                            Sua ultima resposta
                          </MvText>
                          <MvText variant="body4">{request.providerResponseText}</MvText>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
        </MvCard>

        <MvCard>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <MvText variant="semi2">Resumo rápido da operação</MvText>
              <MvText variant="body4" color="secondary">
                {onlineOffers.length
                  ? `Você tem ${onlineOffers.length} oferta(s) online ativa(s) e ${promotionCount} promoção(ões) em andamento.`
                  : "Você ainda não possui ofertas online ativas."}
              </MvText>
            </View>
            <MvBadge label={openRequests.length ? "Prioridade alta" : "Sem pendências"} variant={openRequests.length ? "orange" : "green"} />
          </View>
          <MvProgressBar progress={Math.min(1, openRequests.length / 10)} height={4} />
        </MvCard>

        {loading ? (
          <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
            Atualizando dados......
          </MvText>
        ) : null}
      </ScrollView>

      <ProfessionalBottomNav
        activeKey="financeiro"
        onPress={(key) => {
          if (key === "financeiro") return;
          if (key === "home") {
            navigation.navigate("ProfessionalTabs" as never);
            return;
          }
          if (key === "agenda") {
            navigation.navigate("ProfessionalTabs", { screen: "ProfessionalAgenda" } as never);
            return;
          }
          if (key === "alunos") {
            navigation.navigate("ProfessionalStudents" as never);
            return;
          }
          if (key === "conversas") {
            navigation.navigate("ProfessionalChatList" as never);
            return;
          }
          // financeiro is handled above
        }}
      />
    </View>
  );
}
