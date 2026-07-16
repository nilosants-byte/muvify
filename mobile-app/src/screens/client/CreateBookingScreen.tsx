import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { ScrollView, StatusBar, Text, TextInput, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import {
  ApiError,
  bookingsApi,
  Category,
  ClientAnamnesisProfile,
  PaymentMethod,
  paymentsApi,
  ProviderDetail,
  providersApi,
  ServiceOfferKind,
  userApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar } from "../../components/mv";
import { formatCurrencyBRL, getInitials } from "../../utils/formatters";
import { formatPriceFromCents, handleScreenError } from "../shared/api-helpers";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { hapticCta } from "../../utils/haptics";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { SkeletonShimmer } from "../../components/polish/SkeletonCard";

type Props = NativeStackScreenProps<ClientStackParamList, "CreateBooking">;

const MONTHS_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const WEEKDAY_SHORT_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

function isAnamnesisOutdated(completedAt: string): boolean {
  return Date.now() - new Date(completedAt).getTime() > 6 * 30 * 24 * 60 * 60 * 1000;
}

function offerKindLabel(kind?: ServiceOfferKind) {
  if (!kind) return "Oferta";
  if (kind === "PRESENTIAL") return "Presencial";
  if (kind === "ONLINE_CONSULTANCY") return "Consultoria online";
  if (kind === "ONLINE_CONSULTANCY_SPECIALIZED") return "Consultoria personalizada";
  if (kind === "COMBO") return "Combo";
  return "Oferta";
}

function startOfDay(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromIsoDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map((value) => Number(value));
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

function buildMonthGrid(cursor: Date) {
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const leadingBlanks = firstDay.getDay();
  const cells: Array<Date | null> = [];

  for (let i = 0; i < leadingBlanks; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

// Builds the scheduled instant using Brazil's fixed UTC-3 offset (no DST since
// 2019) instead of Date.setHours, which would use the device's own timezone —
// on a phone set to a different zone, the same wall-clock time would silently
// resolve to a different real-world instant than the one shown on screen.
function mergeDateAndSlot(isoDate: string, slot: string) {
  const [hoursRaw, minutesRaw] = slot.split(":");
  const hours = (hoursRaw ?? "00").padStart(2, "0");
  const minutes = (minutesRaw ?? "00").padStart(2, "0");
  return new Date(`${isoDate}T${hours}:${minutes}:00-03:00`);
}

function formatSelectedDayLabel(isoDate: string) {
  const date = fromIsoDate(isoDate);
  const weekday = WEEKDAY_SHORT_PT[date.getDay()] ?? "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${weekday} - ${day}/${month}`;
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

export function CreateBookingScreen({ navigation, route }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const providerId = route.params.professionalId;
  const offerIdFromRoute = route.params.offerId;
  const offerTitleFromRoute = route.params.offerTitle?.trim() ?? "";
  const offerKindFromRoute = route.params.offerKind;
  const isPromotionalOffer = route.params.isPromotionalOffer === true;
  const offerPriceCentsFromRoute =
    typeof route.params.offerPriceCents === "number" && route.params.offerPriceCents > 0
      ? route.params.offerPriceCents
      : null;

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  const [calendarCursor, setCalendarCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [scheduleByDate, setScheduleByDate] = useState<Record<string, string[]>>({});
  const [loadingCalendarMonth, setLoadingCalendarMonth] = useState(false);
  const [calendarMonthError, setCalendarMonthError] = useState(false);
  const loadedMonthKeysRef = useRef<Set<string>>(new Set());
  const hasInitialized = useRef(false);

  const [selectedDateKeys, setSelectedDateKeys] = useState<string[]>([]);
  const [selectedSlotsByDate, setSelectedSlotsByDate] = useState<Record<string, string>>({});

  const [sessionLocation, setSessionLocation] = useState<string | null>(null);
  const [homeAddressQuery, setHomeAddressQuery] = useState("");
  const [homeAddressCoords, setHomeAddressCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [searchingHomeAddress, setSearchingHomeAddress] = useState(false);
  const [notes, setNotes] = useState("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>("CARD");
  const [creating, setCreating] = useState(false);

  const createBookingQuery = useAuthQuery(
    queryKeys.providers.detail(providerId),
    async (token) => {
      const [providerDetail, customerStatus, anamnesisProfile] = await Promise.all([
        providersApi.detail(providerId) as Promise<ProviderDetail>,
        paymentsApi.customerStatus(token),
        userApi.myAnamnesis(token).catch(() => null),
      ]);
      const resolvedCategories = (providerDetail.categoryLinks ?? [])
        .map((link) => link.category)
        .filter((category): category is Category => Boolean(category));
      return {
        provider: providerDetail,
        categories: resolvedCategories,
        paymentReady: customerStatus.hasDefaultPaymentMethod,
        anamnesis: anamnesisProfile,
      };
    },
    { staleTime: 5 * 60 * 1000 }
  );

  const loading = createBookingQuery.isLoading;
  const provider = createBookingQuery.data?.provider ?? null;
  const paymentReady = createBookingQuery.data?.paymentReady ?? false;
  const anamnesis = createBookingQuery.data?.anamnesis ?? null;

  useEffect(() => {
    if (createBookingQuery.error) {
      handleScreenError({
        error: createBookingQuery.error,
        showToast,
        fallbackMessage: "Falha ao preparar criacao de agendamento.",
        navigation,
      });
    }
  }, [createBookingQuery.error, showToast, navigation]);

  const anamnesisCompleted = anamnesis?.status === "COMPLETED";
  const anamnesisOutdated = anamnesisCompleted && anamnesis?.completedAt
    ? isAnamnesisOutdated(anamnesis.completedAt)
    : false;

  const todayIso = useMemo(() => toIsoDate(startOfDay(new Date())), []);
  const monthCells = useMemo(() => buildMonthGrid(calendarCursor), [calendarCursor]);
  const selectedDateSet = useMemo(() => new Set(selectedDateKeys), [selectedDateKeys]);

  const selectedSchedules = useMemo(
    () =>
      selectedDateKeys.map((dateKey) => ({
        dateKey,
        slots: scheduleByDate[dateKey] ?? [],
        selectedSlot: selectedSlotsByDate[dateKey] ?? "",
      })),
    [scheduleByDate, selectedDateKeys, selectedSlotsByDate]
  );

  const unitPriceCents = useMemo(() => {
    if (offerPriceCentsFromRoute && offerPriceCentsFromRoute > 0) {
      return offerPriceCentsFromRoute;
    }
    return provider?.priceCents ?? 0;
  }, [offerPriceCentsFromRoute, provider?.priceCents]);

  const selectedLessonsCount = selectedDateKeys.length;
  const totalSelectedPriceCents = Math.max(0, unitPriceCents) * selectedLessonsCount;

  const loadMonthSchedule = useCallback(
    async (month: Date, force = false) => {
      const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
      if (!force && loadedMonthKeysRef.current.has(monthKey)) {
        return;
      }

      try {
        setLoadingCalendarMonth(true);
        const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
        const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
        const chunkSize = 14;
        const previews = await Promise.all(
          Array.from({ length: Math.ceil(daysInMonth / chunkSize) }, (_, chunkIndex) => {
            const chunkStart = new Date(
              month.getFullYear(),
              month.getMonth(),
              1 + chunkIndex * chunkSize
            );
            const remainingDays = daysInMonth - chunkIndex * chunkSize;
            const chunkDays = Math.min(chunkSize, remainingDays);
            return providersApi.schedulePreview(providerId, {
              startDate: toIsoDate(chunkStart),
              days: chunkDays,
            });
          })
        );

        const monthMap: Record<string, string[]> = {};
        previews.forEach((preview) => {
          preview.days.forEach((day) => {
            monthMap[day.date] = day.availableSlots ?? [];
          });
        });

        setScheduleByDate((current) => ({ ...current, ...monthMap }));
        loadedMonthKeysRef.current.add(monthKey);
      } catch {
        setCalendarMonthError(true);
      } finally {
        setLoadingCalendarMonth(false);
      }
    },
    [navigation, providerId, showToast]
  );

  useEffect(() => {
    const data = createBookingQuery.data;
    if (!data || hasInitialized.current) return;
    hasInitialized.current = true;
    const cats = data.categories;
    setCategories(cats);
    setSelectedCategoryId((current) =>
      current && cats.some((c) => c.id === current) ? current : (cats[0]?.id ?? "")
    );
    if (data.provider.serviceMode === "HOME_VISIT_ONLY") {
      setSessionLocation("A domicílio");
    }
    loadedMonthKeysRef.current.clear();
    setScheduleByDate({});
    setSelectedDateKeys([]);
    setSelectedSlotsByDate({});
    setCalendarCursor(startOfMonth(new Date()));
    void loadMonthSchedule(startOfMonth(new Date()), true);
  }, [createBookingQuery.data, loadMonthSchedule]);

  useEffect(() => {
    setCalendarMonthError(false);
    void loadMonthSchedule(calendarCursor);
  }, [calendarCursor, loadMonthSchedule]);

  function shiftMonth(diff: number) {
    setCalendarCursor(
      (current) => new Date(current.getFullYear(), current.getMonth() + diff, 1)
    );
  }

  function isSelectableDate(date: Date) {
    const isoDate = toIsoDate(date);
    const slots = scheduleByDate[isoDate] ?? [];
    return isoDate >= todayIso && slots.length > 0;
  }

  function toggleDate(date: Date) {
    const isoDate = toIsoDate(date);
    if (!isSelectableDate(date)) {
      return;
    }

    if (selectedDateSet.has(isoDate)) {
      setSelectedDateKeys((current) => current.filter((item) => item !== isoDate));
      setSelectedSlotsByDate((current) => {
        const next = { ...current };
        delete next[isoDate];
        return next;
      });
      return;
    }

    const slots = scheduleByDate[isoDate] ?? [];
    setSelectedDateKeys((current) => [...current, isoDate].sort((a, b) => a.localeCompare(b)));
    if (slots.length === 1) {
      setSelectedSlotsByDate((current) => ({ ...current, [isoDate]: slots[0] ?? "" }));
    }
  }

  function selectSlotForDate(dateKey: string, slot: string) {
    setSelectedSlotsByDate((current) => ({ ...current, [dateKey]: slot }));
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

  async function handleContinue() {
    if (!anamnesisCompleted) {
      showToast("Preencha sua ficha de saúde antes de agendar.", "error");
      return;
    }
    if (!selectedCategoryId) {
      showToast("Selecione uma categoria.", "error");
      return;
    }
    if (selectedDateKeys.length === 0) {
      showToast("Selecione pelo menos um dia no calendário.", "error");
      return;
    }
    const missingSlots = selectedDateKeys.filter((dateKey) => !selectedSlotsByDate[dateKey]);
    if (missingSlots.length > 0) {
      showToast("Defina o horário para todos os dias selecionados.", "error");
      return;
    }
    const needsLocation =
      provider?.serviceMode === "PRESENTIAL_ONLY" || provider?.serviceMode === "BOTH";
    if (needsLocation && !sessionLocation) {
      showToast("Selecione o local onde a aula será realizada.", "error");
      return;
    }
    if (sessionLocation === "A domicílio" && !homeAddressCoords) {
      showToast("Busque e confirme o endereço do atendimento a domicílio.", "error");
      return;
    }
    if (selectedPaymentMethod === "CARD" && !paymentReady) {
      showToast("Configure um método de pagamento antes de agendar.", "error");
      return;
    }

    try {
      setCreating(true);
      const createdBookingIds: string[] = [];
      const failedDateKeys: string[] = [];

      let firstErrorMessage: string | null = null;

      for (const dateKey of selectedDateKeys) {
        const selectedSlot = selectedSlotsByDate[dateKey] ?? "";
        const scheduledAt = mergeDateAndSlot(dateKey, selectedSlot);
        try {
          const booking = await runWithAuth((token) =>
            bookingsApi.create(token, {
              providerId,
              categoryId: selectedCategoryId,
              scheduledAt: scheduledAt.toISOString(),
              offerId: offerIdFromRoute || undefined,
              paymentMethod: selectedPaymentMethod,
              notes: notes.trim() || undefined,
              sessionLocation: sessionLocation ?? undefined,
              clientLatitude: sessionLocation === "A domicílio" ? homeAddressCoords?.lat : undefined,
              clientLongitude: sessionLocation === "A domicílio" ? homeAddressCoords?.lng : undefined,
            })
          );
          createdBookingIds.push(booking.id);
        } catch (err) {
          failedDateKeys.push(dateKey);
          if (!firstErrorMessage) {
            firstErrorMessage =
              err instanceof ApiError
                ? err.message
                : err instanceof Error
                ? err.message
                : null;
          }
        }
      }

      if (createdBookingIds.length === 0) {
        showToast(
          firstErrorMessage ?? "Não foi possível criar agendamento para as datas escolhidas.",
          "error"
        );
        setSelectedDateKeys([]);
        setSelectedSlotsByDate({});
        return;
      }

      if (failedDateKeys.length === 0 && createdBookingIds.length === 1) {
        showToast("Agendamento criado com sucesso.", "success");
      } else if (failedDateKeys.length === 0) {
        showToast(`${createdBookingIds.length} agendamentos criados com sucesso.`, "success");
      } else {
        showToast(
          `Criados ${createdBookingIds.length} agendamentos. ${failedDateKeys.length} data(s) ficaram indisponíveis.`,
          "info"
        );
      }

      navigation.navigate("BookingConfirmation", {
        bookingId: createdBookingIds[0] ?? "",
        bookingCount: createdBookingIds.length,
        failedCount: failedDateKeys.length,
      });
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Não foi possível criar agendamento.",
        navigation,
      });
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.text2 }}>
          Preparando agendamento...
        </Text>
      </View>
    );
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
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>
            Criar agendamento
          </Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>
            local, data e horário
          </Text>
        </View>
      </View>

      <ScreenEntrance>
      <ScrollView automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 40, gap: 14, paddingTop: 16 }}
        showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
      >
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>
          Escolha categoria, datas e horários livres do personal para reservar seu atendimento.
        </Text>

        {/* Card: Profissional */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, marginBottom: 10 }}>Profissional</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <MvAvatar initials={getInitials(provider?.displayName ?? "Personal")} tone="green" size="md" photoUri={provider?.photoUrl ?? null} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>{provider?.displayName ?? "Profissional"}</Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 2 }}>
                {formatCurrencyBRL(formatPriceFromCents(provider?.priceCents))} por sessão
              </Text>
            </View>
          </View>
        </View>

        {/* Card: Local */}
        {(provider?.serviceMode === "PRESENTIAL_ONLY" || provider?.serviceMode === "BOTH") && (provider?.fixedLocations ?? []).length === 0 ? (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad }}>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>
              Nenhum local de atendimento cadastrado. Entre em contato com o profissional pelo chat para combinar o local.
            </Text>
          </View>
        ) : (provider?.serviceMode === "PRESENTIAL_ONLY" || provider?.serviceMode === "BOTH") && (provider?.fixedLocations ?? []).length > 0 ? (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>
              Local do atendimento <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>(obrigatório)</Text>
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {provider?.serviceMode === "BOTH" ? (
                <Chip label="A domicílio" selected={sessionLocation === "A domicílio"} onPress={() => setSessionLocation("A domicílio")} />
              ) : null}
              {(provider?.fixedLocations ?? []).map((loc) => (
                <Chip key={loc.id} label={loc.name} selected={sessionLocation === loc.name} onPress={() => setSessionLocation(loc.name)} />
              ))}
            </View>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: sessionLocation ? theme.primary : theme.text3 }}>
              {sessionLocation ? `Local selecionado: ${sessionLocation}` : "Selecione onde a aula será realizada."}
            </Text>
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
          </View>
        ) : null}

        {/* Card: Oferta selecionada */}
        {offerTitleFromRoute ? (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: "rgba(36,230,109,0.09)", padding: S.cardPad, gap: 6 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Oferta selecionada</Text>
              <View style={{ backgroundColor: isPromotionalOffer ? theme.primarySubtle : C.skyDim, borderWidth: 1, borderColor: isPromotionalOffer ? theme.primarySubtleBorder : C.skyBorder, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: isPromotionalOffer ? theme.primary : C.sky }}>{isPromotionalOffer ? "Promoção" : offerKindLabel(offerKindFromRoute)}</Text>
              </View>
            </View>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>{offerTitleFromRoute}</Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>Valor por aula: {formatCurrencyBRL(unitPriceCents / 100)}</Text>
          </View>
        ) : null}

        {/* Card: Especialidade */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Especialidade</Text>
          {categories.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {categories.map((item) => (
                <Chip key={item.id} label={item.name} selected={selectedCategoryId === item.id} onPress={() => setSelectedCategoryId(item.id)} />
              ))}
            </View>
          ) : (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>Este personal ainda não configurou especialidades para agendamento.</Text>
          )}
        </View>

        {/* Card: Calendário */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <TouchableOpacity onPress={() => shiftMonth(-1)} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Mês anterior">
              <Ionicons name="chevron-back" size={18} color={theme.text1} />
            </TouchableOpacity>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, textTransform: "capitalize" }}>
              {`${MONTHS_PT[calendarCursor.getMonth()]} ${calendarCursor.getFullYear()}`}
            </Text>
            <TouchableOpacity onPress={() => shiftMonth(1)} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Próximo mês">
              <Ionicons name="chevron-forward" size={18} color={theme.text1} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row" }}>
            {WEEKDAY_SHORT_PT.map((dayLabel) => (
              <View key={`weekday-${dayLabel}`} style={{ width: "14.285%", alignItems: "center", paddingVertical: 4 }}>
                <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3 }}>{dayLabel}</Text>
              </View>
            ))}
          </View>

          {/* Grade do calendário — células com mínimo 44px (touch target V2) */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4, gap: 4 }}>
            {monthCells.map((cell, index) => {
              if (!cell) return <View key={`calendar-blank-${index}`} style={{ width: "13.5%", minHeight: S.touchMin }} />;
              const isoDate = toIsoDate(cell);
              const selected = selectedDateSet.has(isoDate);
              const selectable = isSelectableDate(cell);
              const isPast = isoDate < todayIso;
              return (
                <TouchableOpacity
                  key={`calendar-day-${isoDate}`}
                  disabled={!selectable}
                  onPress={() => toggleDate(cell)}
                  accessibilityRole="button"
                  accessibilityLabel={`Dia ${cell.getDate()}`}
                  style={{ width: "13.5%", minHeight: S.touchMin, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: selected ? theme.primary : selectable ? theme.border : "transparent", backgroundColor: selected ? theme.primary : selectable ? "rgba(255,255,255,0.03)" : "transparent", opacity: isPast || (!selectable && !isPast) ? 0.3 : 1 }}
                >
                  <Text style={{ fontFamily: selected ? "DMSans_700Bold" : "DMSans_400Regular", fontSize: 12, color: selected ? theme.textOnPrimary : selectable ? C.zinc300 : theme.labelColor, textDecorationLine: isPast && !selectable ? "line-through" : "none" }}>
                    {cell.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, marginTop: 4 }}>Dias sem horário livre ficam bloqueados.</Text>
          {loadingCalendarMonth ? (
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
              {[72, 56, 88, 64, 80, 56].map((w, i) => (
                <SkeletonShimmer key={i} width={w} height={26} borderRadius={12} />
              ))}
            </View>
          ) : calendarMonthError ? (
            <TouchableOpacity
              onPress={() => {
                setCalendarMonthError(false);
                loadedMonthKeysRef.current.delete(
                  `${calendarCursor.getFullYear()}-${String(calendarCursor.getMonth() + 1).padStart(2, "0")}`
                );
                void loadMonthSchedule(calendarCursor);
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg }}
            >
              <Ionicons name="refresh-outline" size={16} color={theme.primary} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>
                Falha ao carregar horários. Toque para tentar novamente.
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Card: Horários */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Horários por dia selecionado</Text>
          {selectedSchedules.length === 0 ? (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>Selecione um ou mais dias no calendário para escolher os horários.</Text>
          ) : (
            <View style={{ gap: 12 }}>
              {selectedSchedules.map((item) => (
                <View key={`selected-day-${item.dateKey}`} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 16, padding: 12, backgroundColor: theme.inputBg, gap: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>{formatSelectedDayLabel(item.dateKey)}</Text>
                    <View style={{ backgroundColor: item.selectedSlot ? theme.primarySubtle : C.amberDim, borderWidth: 1, borderColor: item.selectedSlot ? theme.primarySubtleBorder : C.amberBorder, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: item.selectedSlot ? theme.primary : C.amber }}>{item.selectedSlot ?? "Sem horário"}</Text>
                    </View>
                  </View>

                  {item.slots.length === 0 ? (
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>
                      Sem horários livres para este dia.
                    </Text>
                  ) : (
                    // Grid 2 colunas com botões de 52px — regra V2
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {item.slots.map((slot) => {
                        const active = item.selectedSlot === slot;
                        return (
                          <TouchableOpacity
                            key={`${item.dateKey}-${slot}`}
                            onPress={() => selectSlotForDate(item.dateKey, slot)}
                            style={{
                              width: "47%",
                              height: S.btnH,
                              borderRadius: 16,
                              alignItems: "center",
                              justifyContent: "center",
                              borderWidth: 1,
                              borderColor: active ? theme.primary : theme.border,
                              backgroundColor: active ? theme.primary : "rgba(255,255,255,0.04)",
                            }}
                          >
                            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 18, color: active ? theme.textOnPrimary : C.zinc300, letterSpacing: -0.013 * 18 }}>
                              {slot}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Card: Pagamento */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Pagamento</Text>
            {(() => {
              const isCard = selectedPaymentMethod === "CARD";
              const label = isCard ? (paymentReady ? "Cartão configurado" : "Cartão pendente") : "PIX habilitado";
              const col = isCard ? (paymentReady ? theme.primary : C.amber) : C.sky;
              const bg = isCard ? (paymentReady ? theme.primarySubtle : C.amberDim) : C.skyDim;
              const border = isCard ? (paymentReady ? theme.primarySubtleBorder : C.amberBorder) : C.skyBorder;
              return (
                <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: col }}>{label}</Text>
                </View>
              );
            })()}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Chip label="Cartão" selected={selectedPaymentMethod === "CARD"} onPress={() => setSelectedPaymentMethod("CARD")} />
            <Chip label="PIX" selected={selectedPaymentMethod === "PIX"} onPress={() => setSelectedPaymentMethod("PIX")} />
          </View>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, lineHeight: 18 }}>
            {selectedPaymentMethod === "CARD"
              ? "No cartão, o valor fica pré-autorizado antes da sessão e capturado após a confirmação."
              : "No PIX, o pagamento é feito via QR Code/cópia e cola e registrado no agendamento."}
          </Text>
        </View>

        {/* Card: Observações */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 8 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Observações</Text>
          <TextInput
            multiline
            numberOfLines={4}
            maxLength={300}
            placeholder="Ex.: foco em alongamento, evitar joelho direito..."
            placeholderTextColor={theme.text3}
            value={notes}
            onChangeText={setNotes}
            selectionColor={theme.primary}
            style={{ borderWidth: 1, borderColor: theme.borderMid, borderRadius: 14, backgroundColor: theme.inputBg, padding: 12, color: theme.text1, fontFamily: "DMSans_400Regular", fontSize: 13, lineHeight: 20, minHeight: 90, textAlignVertical: "top" }}
          />
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: notes.length > 250 ? C.amber : theme.text3, textAlign: "right" }}>
            {notes.length}/300
          </Text>
        </View>

        {/* Card: Ficha de saúde */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: !anamnesisCompleted ? "rgba(239,68,68,0.35)" : anamnesisOutdated ? C.amberBorder : theme.primarySubtleBorder, backgroundColor: !anamnesisCompleted ? "rgba(239,68,68,0.08)" : anamnesisOutdated ? C.amberDim : "rgba(36,230,109,0.08)", padding: S.cardPad, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
              <Ionicons name={!anamnesisCompleted ? "alert-circle-outline" : anamnesisOutdated ? "warning-outline" : "checkmark-circle-outline"} size={18} color={!anamnesisCompleted ? theme.danger : anamnesisOutdated ? C.amber : theme.primary} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: !anamnesisCompleted ? theme.danger : anamnesisOutdated ? C.amber : theme.primary }}>
                {!anamnesisCompleted ? "Ficha de saúde pendente" : anamnesisOutdated ? "Ficha desatualizada" : "Ficha de saúde OK"}
              </Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate("ClientAnamnesis")} accessibilityRole="button" style={{ backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: theme.border }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text1 }}>{!anamnesisCompleted ? "Preencher" : "Editar"}</Text>
            </TouchableOpacity>
          </View>
          {!anamnesisCompleted ? (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.danger, lineHeight: 18 }}>
              Preencha sua ficha de saúde para liberar o agendamento. Ajuda o personal a preparar um atendimento seguro.
            </Text>
          ) : anamnesisOutdated ? (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: C.amber, lineHeight: 18 }}>
              Recomendamos atualizar sua ficha a cada 6 meses.
            </Text>
          ) : null}
        </View>

        {/* Card: Resumo financeiro */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 6 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, marginBottom: 4 }}>Resumo financeiro</Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>Valor por aula: {formatCurrencyBRL(unitPriceCents / 100)}</Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>Aulas selecionadas: {selectedLessonsCount}</Text>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.primary, marginTop: 4 }}>Total previsto: {formatCurrencyBRL(totalSelectedPriceCents / 100)}</Text>
        </View>

        {/* Botão CTA V2 com safe area */}
        <View style={{ paddingBottom: Math.max(16, insets.bottom) }}>
          <TouchableOpacity
            disabled={creating || !anamnesisCompleted || (selectedPaymentMethod === "CARD" && !paymentReady)}
            onPress={() => { hapticCta(); void handleContinue(); }}
            style={{
              height: S.btnH, borderRadius: S.btnR,
              backgroundColor: (!anamnesisCompleted || (selectedPaymentMethod === "CARD" && !paymentReady)) ? "rgba(36,230,109,0.4)" : theme.primary,
              alignItems: "center", justifyContent: "center",
              shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4,
              opacity: creating ? 0.7 : 1,
            }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary, letterSpacing: -0.02 * 14 }}>
              {creating ? "Criando..." : !anamnesisCompleted ? "Ficha de saúde pendente" : selectedDateKeys.length > 1 ? "Criar agendamentos" : "Ir para pagamento"}
            </Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
