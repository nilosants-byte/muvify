import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StatusBar, Text, TextInput, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";
import { ClientStackParamList } from "../../navigation/route-types";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import {
  Category,
  ConsultancyPaymentMethod,
  OfferBillingCycle,
  paymentsApi,
  PresentialPackage,
  presentialPackagesApi,
  PresentialPackageWeeklyScheduleSlot,
  ProviderDetail,
  providersApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar } from "../../components/mv";
import { TimeWheelPicker } from "../../components/mv/TimeWheelPicker";
import { formatCurrencyBRL, getInitials } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { hapticCta } from "../../utils/haptics";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";

type Props = NativeStackScreenProps<ClientStackParamList, "BuyPresentialPackage">;

const WEEKDAYS = [
  { id: 0, short: "Dom" },
  { id: 1, short: "Seg" },
  { id: 2, short: "Ter" },
  { id: 3, short: "Qua" },
  { id: 4, short: "Qui" },
  { id: 5, short: "Sex" },
  { id: 6, short: "Sáb" },
] as const;

function billingCycleLabel(cycle: OfferBillingCycle) {
  if (cycle === "DAILY") return "diário";
  if (cycle === "WEEKLY") return "semanal";
  if (cycle === "MONTHLY") return "mensal";
  if (cycle === "QUARTERLY") return "trimestral";
  if (cycle === "SEMIANNUAL") return "semestral";
  return "anual";
}

function Chip({
  label,
  selected,
  disabled = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { theme } = useMvTheme();
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        height: 40,
        borderRadius: S.chipR,
        backgroundColor: disabled ? "rgba(255,255,255,0.04)" : selected ? theme.primarySubtle : "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: disabled ? theme.border : selected ? theme.primarySubtleBorder : theme.border,
        opacity: disabled ? 0.45 : 1,
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: selected ? "DMSans_700Bold" : "DMSans_400Regular", fontSize: 13, color: selected ? theme.primary : theme.text2 }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function BuyPresentialPackageScreen({ navigation, route }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const {
    professionalId,
    offerId,
    offerTitle,
    offerKind,
    billingCycle,
    cycleAmountCents,
    presentialPackageMode,
    presentialSessionsPerCycle,
    presentialHasFixedTerm,
    presentialTotalCycles,
    comboPresentialShareCents,
    comboConsultancyShareCents,
    acceptsPix = true,
    acceptsCreditCard = true,
    offerServiceMode,
  } = route.params;

  const isFixedRecurring = presentialPackageMode === "FIXED_RECURRING";
  const isCombo = offerKind === "COMBO";

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<ConsultancyPaymentMethod>(
    acceptsCreditCard ? "CREDIT_CARD" : "PIX"
  );
  const [weeklySchedule, setWeeklySchedule] = useState<PresentialPackageWeeklyScheduleSlot[]>([]);
  const [sessionLocation, setSessionLocation] = useState<string | null>(null);
  const [homeAddressQuery, setHomeAddressQuery] = useState("");
  const [homeAddressCoords, setHomeAddressCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [searchingHomeAddress, setSearchingHomeAddress] = useState(false);
  const [newSlotWeekday, setNewSlotWeekday] = useState(1);
  const [newSlotTime, setNewSlotTime] = useState("08:00");
  const [purchasing, setPurchasing] = useState(false);
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [purchasedPackage, setPurchasedPackage] = useState<PresentialPackage | null>(null);
  const [pixPending, setPixPending] = useState<{
    qrCodeUrl: string | null;
    copyAndPasteCode: string | null;
    hostedInstructionsUrl: string | null;
  } | null>(null);
  const [pixConfirmed, setPixConfirmed] = useState(false);

  const setupQuery = useAuthQuery(
    queryKeys.providers.detail(professionalId),
    async (token) => {
      const [providerDetail, customerStatus] = await Promise.all([
        providersApi.detail(professionalId) as Promise<ProviderDetail>,
        paymentsApi.customerStatus(token),
      ]);
      const resolvedCategories = (providerDetail.categoryLinks ?? [])
        .map((link) => link.category)
        .filter((category): category is Category => Boolean(category));
      return { provider: providerDetail, categories: resolvedCategories, paymentReady: customerStatus.hasDefaultPaymentMethod };
    },
    { staleTime: 5 * 60 * 1000 }
  );

  const provider = setupQuery.data?.provider ?? null;
  const paymentReady = setupQuery.data?.paymentReady ?? false;

  useEffect(() => {
    if (setupQuery.data?.categories) setCategories(setupQuery.data.categories);
  }, [setupQuery.data]);

  useEffect(() => {
    if (!selectedCategoryId && categories.length > 0) setSelectedCategoryId(categories[0].id);
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    if (setupQuery.error) {
      handleScreenError({ error: setupQuery.error, showToast, fallbackMessage: "Falha ao preparar a compra.", navigation });
    }
  }, [setupQuery.error, showToast, navigation]);

  // Enquanto o Pix da compra estiver pendente, confere a cada 5s se ja foi
  // pago (o webhook confirma assincrono - o cliente pode levar minutos/horas
  // pra escanear o QR).
  useEffect(() => {
    if (!pixPending || !purchasedPackage || pixConfirmed) return;
    const interval = setInterval(async () => {
      try {
        const updated = await runWithAuth((token) => presentialPackagesApi.detail(token, purchasedPackage.id));
        if (updated.status === "ACTIVE") {
          setPixConfirmed(true);
          setPixPending(null);
          showToast("Pagamento confirmado! Seu pacote está ativo.", "success");
        }
      } catch {
        // silencioso - tenta de novo no proximo tick
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [pixPending, purchasedPackage, pixConfirmed, runWithAuth, showToast]);

  function addWeeklySlot() {
    if (weeklySchedule.some((slot) => slot.weekday === newSlotWeekday && slot.time === newSlotTime)) {
      showToast("Esse dia e horário já foi adicionado.", "error");
      return;
    }
    setWeeklySchedule((current) => [...current, { weekday: newSlotWeekday, time: newSlotTime }].sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time)));
  }

  function removeWeeklySlot(index: number) {
    setWeeklySchedule((current) => current.filter((_, i) => i !== index));
  }

  async function searchHomeAddress() {
    const query = homeAddressQuery.trim();
    if (!query) return;
    try {
      setSearchingHomeAddress(true);
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`;
      const resp = await fetch(url, {
        headers: { "Accept-Language": "pt-BR", "User-Agent": "Muvify-App/1.0" },
      });
      const results = (await resp.json()) as Array<{ display_name: string; lat: string; lon: string }>;
      const first = results[0];
      if (!first) {
        showToast("Endereço não encontrado.", "info");
        setHomeAddressCoords(null);
        return;
      }
      const lat = parseFloat(first.lat);
      const lng = parseFloat(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        showToast("Endereço inválido.", "error");
        setHomeAddressCoords(null);
        return;
      }
      setHomeAddressCoords({ lat, lng });
      setHomeAddressQuery(first.display_name);
    } catch {
      showToast("Falha ao buscar endereço.", "error");
      setHomeAddressCoords(null);
    } finally {
      setSearchingHomeAddress(false);
    }
  }

  // Local de atendimento da oferta prevalece sobre o do perfil - null herda
  // o que o perfil do profissional já permite (ver Frente C).
  const effectiveServiceMode = offerServiceMode ?? provider?.serviceMode;
  const fixedLocations = provider?.fixedLocations ?? [];
  const needsLocation = Boolean(effectiveServiceMode);

  const canSubmit =
    Boolean(selectedCategoryId) &&
    (!isFixedRecurring || weeklySchedule.length > 0) &&
    (paymentMethod !== "CREDIT_CARD" || paymentReady) &&
    (!isCombo || consentAcknowledged) &&
    (!needsLocation || Boolean(sessionLocation)) &&
    (sessionLocation !== "A domicílio" || Boolean(homeAddressCoords));

  async function handlePurchase() {
    if (!canSubmit || purchasing) return;
    try {
      setPurchasing(true);
      const body = {
        offerId,
        categoryId: selectedCategoryId,
        paymentMethod: paymentMethod as "CREDIT_CARD" | "PIX",
        weeklySchedule: isFixedRecurring ? weeklySchedule : undefined,
        sessionLocation: sessionLocation ?? undefined,
        clientLatitude: sessionLocation === "A domicílio" ? homeAddressCoords?.lat : undefined,
        clientLongitude: sessionLocation === "A domicílio" ? homeAddressCoords?.lng : undefined,
        ...(isCombo ? { acknowledgedImmediateExecution: true } : {}),
      };
      if (isCombo) {
        const result = await runWithAuth((token) => presentialPackagesApi.purchaseCombo(token, body));
        setPurchasedPackage(result.package);
        if (result.presentialPayment.status === "PENDING" && result.presentialPayment.pix) {
          setPixPending(result.presentialPayment.pix);
        } else if (
          result.presentialPayment.status === "CAPTURED" &&
          (result.consultancyPayment.status === "CAPTURED" || result.consultancyPayment.status === "AUTHORIZED")
        ) {
          await hapticCta();
          showToast("Combo contratado com sucesso!", "success");
          navigation.replace("MyPresentialPackages");
        } else {
          showToast(
            "A consultoria foi processada, mas o presencial precisa de atenção - confira em 'Meus pacotes'.",
            "info"
          );
          navigation.replace("MyPresentialPackages");
        }
      } else {
        const result = await runWithAuth((token) => presentialPackagesApi.purchase(token, body));
        setPurchasedPackage(result.package);
        if (result.payment.status === "CAPTURED") {
          await hapticCta();
          showToast("Pacote contratado com sucesso!", "success");
          navigation.replace("MyPresentialPackages");
        } else if (result.payment.status === "SCHEDULED") {
          await hapticCta();
          showToast(
            `Pacote contratado! ${result.payment.sessionsScheduled} sessão(ões) agendada(s) — cada uma é cobrada individualmente perto da data.`,
            "success"
          );
          navigation.replace("MyPresentialPackages");
        } else if (result.payment.status === "PENDING" && result.payment.pix) {
          setPixPending(result.payment.pix);
        } else {
          showToast("Não foi possível confirmar o pagamento. Tente novamente.", "error");
        }
      }
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível concluir a compra.", navigation });
    } finally {
      setPurchasing(false);
    }
  }

  const cycleLabel = billingCycleLabel(billingCycle);
  const unitLabel = presentialPackageMode === "FLEXIBLE_CREDITS" ? "créditos" : "sessões";
  // Único caso que já cobra sessão por sessão em vez do ciclo inteiro
  // adiantado — o combo ainda usa o modelo antigo pro lado presencial.
  const isCardFixedRecurringPurchase = !isCombo && isFixedRecurring && paymentMethod === "CREDIT_CARD";

  if (setupQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.text2 }}>Preparando compra...</Text>
      </View>
    );
  }

  if (pixPending && purchasedPackage) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1 }}>Pague o Pix para ativar</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: S.px, gap: 14 }}>
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 12, alignItems: "center" }}>
            {pixPending.copyAndPasteCode ? (
              <QRCode value={pixPending.copyAndPasteCode} size={200} backgroundColor="transparent" color={theme.text1} />
            ) : null}
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1, textAlign: "center" }}>
              Escaneie o QR code ou copie o código abaixo no app do seu banco
            </Text>
            {pixPending.copyAndPasteCode ? (
              <Text selectable style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, textAlign: "center" }}>
                {pixPending.copyAndPasteCode}
              </Text>
            ) : null}
          </View>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, textAlign: "center" }}>
            Assim que o pagamento for confirmado, seu pacote ativa automaticamente e esta tela some sozinha.
          </Text>
          <TouchableOpacity
            onPress={() => navigation.replace("MyPresentialPackages")}
            style={{ height: S.btnH, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>Ver meus pacotes</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.3 }}>
            {isCombo ? "Contratar combo" : "Contratar pacote"}
          </Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>{offerTitle}</Text>
        </View>
      </View>

      <ScreenEntrance>
        <ScrollView
          automaticallyAdjustKeyboardInsets={true}
          contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 40, gap: 14, paddingTop: 16 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Card: Profissional */}
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <MvAvatar initials={getInitials(provider?.displayName ?? "Personal")} tone="green" size="md" photoUri={provider?.photoUrl ?? null} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>{provider?.displayName ?? "Profissional"}</Text>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 2 }}>
                  {presentialPackageMode === "FIXED_RECURRING" ? "Pacote de horário fixo" : "Pacote de créditos flexíveis"}
                </Text>
              </View>
            </View>
          </View>

          {/* Card: Como funciona a cobrança - comunicação obrigatória antes de confirmar */}
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: "rgba(36,230,109,0.08)", padding: S.cardPad, gap: 6 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>Como funciona esta cobrança</Text>
            {isCardFixedRecurringPurchase ? (
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
                {presentialSessionsPerCycle} sessão(ões) por ciclo ({cycleLabel}), no valor de {formatCurrencyBRL(cycleAmountCents / 100)} no total —
                mas você não paga tudo de uma vez: cada sessão é cobrada individualmente, perto da data em que vai acontecer.
                {presentialHasFixedTerm && presentialTotalCycles
                  ? ` A assinatura tem prazo determinado de ${presentialTotalCycles} ciclos e encerra sozinha ao final.`
                  : " Sem prazo fixo - renova automaticamente até você ou o profissional cancelarem."}
                {" "}Cancelar a qualquer momento libera as sessões futuras ainda não cobradas, sem nenhum custo.
              </Text>
            ) : (
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
                Esta é uma assinatura: você paga {formatCurrencyBRL((isCombo ? comboPresentialShareCents ?? 0 : cycleAmountCents) / 100)} a cada ciclo ({cycleLabel}),
                liberando {presentialSessionsPerCycle} {unitLabel} por ciclo.
                {presentialHasFixedTerm && presentialTotalCycles
                  ? ` A assinatura tem prazo determinado de ${presentialTotalCycles} ciclos e encerra sozinha ao final.`
                  : " Sem prazo fixo - renova automaticamente até você ou o profissional cancelarem."}
                {" "}Você pode cancelar quando quiser: cancelar só impede a próxima cobrança, sem afetar o que já foi pago.
              </Text>
            )}
            {isCombo ? (
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
                A consultoria online do combo é cobrada à parte, uma única vez: {formatCurrencyBRL((comboConsultancyShareCents ?? 0) / 100)}.
              </Text>
            ) : null}
            {!isCardFixedRecurringPurchase ? (
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
                {paymentMethod === "PIX"
                  ? "No Pix, cada ciclo gera um QR code novo - você precisa pagar manualmente a cada renovação para manter o pacote ativo."
                  : "No cartão, a renovação é automática a cada ciclo, usando o cartão salvo na sua conta."}
              </Text>
            ) : null}
          </View>

          {/* Card: Categoria */}
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Especialidade</Text>
            {categories.length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {categories.map((item) => (
                  <Chip key={item.id} label={item.name} selected={selectedCategoryId === item.id} onPress={() => setSelectedCategoryId(item.id)} />
                ))}
              </View>
            ) : (
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>
                Este profissional ainda não configurou especialidades.
              </Text>
            )}
          </View>

          {/* Card: Horário fixo semanal (só modo FIXED_RECURRING) */}
          {isFixedRecurring ? (
            <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Horário fixo semanal</Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>
                Escolha os dias e horários da sua rotina - toda semana as sessões acontecem automaticamente nesses horários.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {WEEKDAYS.map((day) => (
                  <Chip key={day.id} label={day.short} selected={newSlotWeekday === day.id} onPress={() => setNewSlotWeekday(day.id)} />
                ))}
              </View>
              <TimeWheelPicker value={newSlotTime} onChange={setNewSlotTime} />
              <TouchableOpacity
                onPress={addWeeklySlot}
                style={{ height: 40, borderRadius: 10, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>+ Adicionar horário</Text>
              </TouchableOpacity>
              {weeklySchedule.length > 0 ? (
                <View style={{ gap: 6 }}>
                  {weeklySchedule.map((slot, index) => (
                    <View
                      key={`${slot.weekday}-${slot.time}`}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 10, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 8 }}
                    >
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>
                        {WEEKDAYS.find((d) => d.id === slot.weekday)?.short} · {slot.time}
                      </Text>
                      <TouchableOpacity onPress={() => removeWeeklySlot(index)}>
                        <Ionicons name="close-circle-outline" size={20} color={theme.text3} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.danger }}>
                  Adicione ao menos um horário fixo semanal.
                </Text>
              )}
            </View>
          ) : null}

          {/* Card: Local */}
          {needsLocation ? (
            <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>
                Local do atendimento <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>(obrigatório)</Text>
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {effectiveServiceMode === "HOME_VISIT_ONLY" || effectiveServiceMode === "BOTH" ? (
                  <Chip label="A domicílio" selected={sessionLocation === "A domicílio"} onPress={() => setSessionLocation("A domicílio")} />
                ) : null}
                {effectiveServiceMode !== "HOME_VISIT_ONLY"
                  ? fixedLocations.map((loc) => (
                      <Chip key={loc.id} label={loc.name} selected={sessionLocation === loc.name} onPress={() => setSessionLocation(loc.name)} />
                    ))
                  : null}
              </View>
              {sessionLocation === "A domicílio" ? (
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <TextInput
                      value={homeAddressQuery}
                      onChangeText={(v) => { setHomeAddressQuery(v); setHomeAddressCoords(null); }}
                      onSubmitEditing={() => void searchHomeAddress()}
                      placeholder="Endereço completo do atendimento"
                      placeholderTextColor={theme.text3}
                      returnKeyType="search"
                      style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, backgroundColor: theme.inputBg, paddingHorizontal: 12, paddingVertical: 10, color: theme.text1, fontSize: 13 }}
                    />
                    <TouchableOpacity
                      onPress={() => void searchHomeAddress()}
                      disabled={searchingHomeAddress || !homeAddressQuery.trim()}
                      style={{ height: 40, paddingHorizontal: 14, borderRadius: 10, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", opacity: searchingHomeAddress || !homeAddressQuery.trim() ? 0.6 : 1 }}
                    >
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: "#000" }}>
                        {searchingHomeAddress ? "..." : "Buscar"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: homeAddressCoords ? theme.primary : theme.text3 }}>
                    {homeAddressCoords ? "Endereço confirmado." : "Busque e confirme o endereço para checar se está dentro da área de atendimento."}
                  </Text>
                </View>
              ) : null}
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>
                Todas as sessões do pacote acontecerão neste local.
              </Text>
            </View>
          ) : null}

          {/* Card: Pagamento */}
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Pagamento</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {acceptsCreditCard ? (
                <Chip label="Cartão" selected={paymentMethod === "CREDIT_CARD"} onPress={() => setPaymentMethod("CREDIT_CARD")} />
              ) : null}
              {acceptsPix ? (
                <Chip label="Pix" selected={paymentMethod === "PIX"} onPress={() => setPaymentMethod("PIX")} />
              ) : null}
            </View>
            {paymentMethod === "CREDIT_CARD" && !paymentReady ? (
              <TouchableOpacity onPress={() => navigation.navigate("ClientPaymentMethod")}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.danger }}>
                  Nenhum cartão configurado - toque para adicionar antes de continuar.
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Card: Resumo */}
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 6 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, marginBottom: 4 }}>Resumo</Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>
              {presentialSessionsPerCycle} {unitLabel} por ciclo {cycleLabel}
            </Text>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 18, color: theme.primary, marginTop: 4 }}>
              {formatCurrencyBRL((isCombo ? comboPresentialShareCents ?? 0 : cycleAmountCents) / 100)} / {cycleLabel}
            </Text>
          </View>

          {isCombo ? (
            <TouchableOpacity
              onPress={() => setConsentAcknowledged((v) => !v)}
              style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}
            >
              <Ionicons
                name={consentAcknowledged ? "checkbox" : "square-outline"}
                size={18}
                color={consentAcknowledged ? theme.primary : theme.text3}
              />
              <Text style={{ flex: 1, fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text2 }}>
                Peço o início imediato do atendimento de consultoria deste combo e estou ciente de que, após a entrega da primeira ficha de treino, perco o direito de arrependimento de 7 dias previsto no CDC para essa parte da contratação.
              </Text>
            </TouchableOpacity>
          ) : null}

          <View style={{ paddingBottom: Math.max(16, insets.bottom) }}>
            <TouchableOpacity
              disabled={!canSubmit || purchasing}
              onPress={() => { hapticCta(); void handlePurchase(); }}
              style={{
                height: S.btnH,
                borderRadius: S.btnR,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: !canSubmit || purchasing ? "rgba(36,230,109,0.4)" : theme.primary,
              }}
            >
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.textOnPrimary }}>
                {purchasing ? "Processando..." : "Confirmar assinatura"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
