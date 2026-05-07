import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
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
import { MvAvatar, MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { formatCurrencyBRL, getInitials } from "../../utils/formatters";
import { formatPriceFromCents, handleScreenError } from "../shared/api-helpers";

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

function mergeDateAndSlot(isoDate: string, slot: string) {
  const baseDate = fromIsoDate(isoDate);
  const [hours, minutes] = slot.split(":").map((value) => Number(value));
  baseDate.setHours(hours || 0, minutes || 0, 0, 0);
  return baseDate;
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
  theme,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  theme: any;
}) {
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        backgroundColor: disabled
          ? theme.chipBg
          : selected
          ? "rgba(76,175,80,0.12)"
          : theme.chipBg,
        borderWidth: 1,
        borderColor: disabled
          ? theme.border
          : selected
          ? "rgba(76,175,80,0.35)"
          : theme.border,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.chipText }}>
        {label}
      </MvText>
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

  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  const [calendarCursor, setCalendarCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [scheduleByDate, setScheduleByDate] = useState<Record<string, string[]>>({});
  const [loadingCalendarMonth, setLoadingCalendarMonth] = useState(false);
  const loadedMonthKeysRef = useRef<Set<string>>(new Set());

  const [selectedDateKeys, setSelectedDateKeys] = useState<string[]>([]);
  const [selectedSlotsByDate, setSelectedSlotsByDate] = useState<Record<string, string>>({});

  const [sessionLocation, setSessionLocation] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [paymentReady, setPaymentReady] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>("CARD");
  const [anamnesis, setAnamnesis] = useState<ClientAnamnesisProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

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
      } catch (error) {
        handleScreenError({
          error,
          showToast,
          fallbackMessage: "Não foi possível carregar a disponibilidade deste mês.",
          navigation,
        });
      } finally {
        setLoadingCalendarMonth(false);
      }
    },
    [navigation, providerId, showToast]
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      loadedMonthKeysRef.current.clear();
      setScheduleByDate({});
      setSelectedDateKeys([]);
      setSelectedSlotsByDate({});
      setCalendarCursor(startOfMonth(new Date()));

      const [providerDetail, customerStatus, anamnesisProfile] = await Promise.all([
        providersApi.detail(providerId),
        runWithAuth((token) => paymentsApi.customerStatus(token)),
        runWithAuth((token) => userApi.myAnamnesis(token)).catch(() => null),
      ]);
      setAnamnesis(anamnesisProfile);

      setProvider(providerDetail);

      if (providerDetail.serviceMode === "HOME_VISIT_ONLY") {
        setSessionLocation("A domicílio");
      }

      // As especialidades visíveis para o cliente são exatamente as categorias vinculadas
      // ao personal (categoryLinks). Elas já têm id e nome prontos para uso no agendamento.
      const resolvedCategories = (providerDetail.categoryLinks ?? [])
        .map((link) => link.category)
        .filter((category): category is Category => Boolean(category));

      setCategories(resolvedCategories);
      setSelectedCategoryId((current) =>
        current && resolvedCategories.some((category) => category.id === current)
          ? current
          : (resolvedCategories[0]?.id ?? "")
      );
      setPaymentReady(customerStatus.hasDefaultPaymentMethod);

      await loadMonthSchedule(startOfMonth(new Date()), true);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao preparar criacao de agendamento.",
        navigation,
      });
    } finally {
      setLoading(false);
    }
  }, [loadMonthSchedule, navigation, providerId, runWithAuth, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
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
      <View
        style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}
      >
        <StatusBar
          barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}
          backgroundColor={theme.bg}
        />
        <MvText variant="body3" color="secondary">
          Preparando agendamento...
        </MvText>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar
        barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={theme.bg}
      />
      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 14,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: theme.borderSub,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="h4">Agendar</MvText>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }}
        showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
      >
        <MvText variant="body4" color="secondary">
          Escolha categoria, datas e horários livres do personal para reservar seu atendimento.
        </MvText>

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 4 }}>
            Profissional
          </MvText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <MvAvatar
              initials={getInitials(provider?.displayName ?? "Personal")}
              size={44}
              borderRadius={22}
              color="green"
              photoUri={provider?.photoUrl ?? null}
            />
            <View style={{ flex: 1 }}>
              <MvText variant="semi3">{provider?.displayName ?? "Profissional"}</MvText>
              <MvText variant="body4" color="secondary">
                {formatCurrencyBRL(formatPriceFromCents(provider?.priceCents))} por sessão
              </MvText>
            </View>
          </View>
        </MvCard>

        {(provider?.serviceMode === "PRESENTIAL_ONLY" || provider?.serviceMode === "BOTH") &&
          (provider?.fixedLocations ?? []).length > 0 ? (
          <MvCard>
            <MvText variant="semi2" style={{ marginBottom: 10 }}>
              Local do atendimento{" "}
              <MvText variant="body4" color="secondary">(obrigatório)</MvText>
            </MvText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {provider?.serviceMode === "BOTH" ? (
                <Chip
                  label="A domicílio"
                  selected={sessionLocation === "A domicílio"}
                  onPress={() => setSessionLocation("A domicílio")}
                  theme={theme}
                />
              ) : null}
              {(provider?.fixedLocations ?? []).map((loc) => (
                <Chip
                  key={loc.id}
                  label={loc.name}
                  selected={sessionLocation === loc.name}
                  onPress={() => setSessionLocation(loc.name)}
                  theme={theme}
                />
              ))}
            </View>
            {sessionLocation ? (
              <MvText variant="body4" color="secondary" style={{ marginTop: 8 }}>
                Local selecionado: {sessionLocation}
              </MvText>
            ) : (
              <MvText variant="body4" color="secondary" style={{ marginTop: 8 }}>
                Selecione onde a aula será realizada.
              </MvText>
            )}
          </MvCard>
        ) : null}

        {offerTitleFromRoute ? (
          <MvCard>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <MvText variant="semi2">Oferta selecionada</MvText>
              <MvBadge label={isPromotionalOffer ? "Promocao" : offerKindLabel(offerKindFromRoute)} variant={isPromotionalOffer ? "green" : "blue"} />
            </View>
            <MvText variant="semi3" style={{ marginBottom: 4 }}>
              {offerTitleFromRoute}
            </MvText>
            <MvText variant="body4" color="secondary">
              Valor por aula desta oferta: {formatCurrencyBRL(unitPriceCents / 100)}
            </MvText>
          </MvCard>
        ) : null}

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>
            Especialidade
          </MvText>
          {categories.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {categories.map((item) => (
                <Chip
                  key={item.id}
                  label={item.name}
                  selected={selectedCategoryId === item.id}
                  onPress={() => setSelectedCategoryId(item.id)}
                  theme={theme}
                />
              ))}
            </View>
          ) : (
            <MvText variant="body4" color="secondary">
              Este personal ainda não configurou especialidades para agendamento.
            </MvText>
          )}
        </MvCard>

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>
            Calendario
          </MvText>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <TouchableOpacity
              onPress={() => shiftMonth(-1)}
              style={{ paddingHorizontal: 10, paddingVertical: 6 }}
            >
              <MvText variant="semi2">{"<"}</MvText>
            </TouchableOpacity>
            <MvText variant="semi2" style={{ textTransform: "capitalize" }}>
              {`${MONTHS_PT[calendarCursor.getMonth()]} ${calendarCursor.getFullYear()}`}
            </MvText>
            <TouchableOpacity
              onPress={() => shiftMonth(1)}
              style={{ paddingHorizontal: 10, paddingVertical: 6 }}
            >
              <MvText variant="semi2">{">"}</MvText>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row" }}>
            {WEEKDAY_SHORT_PT.map((dayLabel) => (
              <View
                key={`weekday-${dayLabel}`}
                style={{ width: "14.285%", alignItems: "center", paddingVertical: 4 }}
              >
                <MvText variant="body4" color="secondary">
                  {dayLabel}
                </MvText>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 2 }}>
            {monthCells.map((cell, index) => {
              if (!cell) {
                return (
                  <View
                    key={`calendar-blank-${index}`}
                    style={{ width: "14.285%", paddingVertical: 12 }}
                  />
                );
              }

              const isoDate = toIsoDate(cell);
              const selected = selectedDateSet.has(isoDate);
              const selectable = isSelectableDate(cell);

              return (
                <TouchableOpacity
                  key={`calendar-day-${isoDate}`}
                  disabled={!selectable}
                  onPress={() => toggleDate(cell)}
                  style={{
                    width: "14.285%",
                    alignItems: "center",
                    paddingVertical: 8,
                    opacity: selectable ? 1 : 0.35,
                  }}
                >
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: selected ? "rgba(76,175,80,0.14)" : "transparent",
                      borderWidth: selected ? 1 : 0,
                      borderColor: selected ? "rgba(76,175,80,0.35)" : "transparent",
                    }}
                  >
                    <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.text1 }}>
                      {cell.getDate()}
                    </MvText>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <MvText variant="body4" color="secondary" style={{ marginTop: 8 }}>
            Dias sem horário livre ficam bloqueados.
          </MvText>
          {loadingCalendarMonth ? (
            <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
              Atualizando disponibilidade do mes...
            </MvText>
          ) : null}
        </MvCard>

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>
            Horários por dia selecionado
          </MvText>

          {selectedSchedules.length === 0 ? (
            <MvText variant="body4" color="secondary">
              Selecione um ou mais dias no calendário para escolher os horários.
            </MvText>
          ) : (
            <View style={{ gap: 12 }}>
              {selectedSchedules.map((item) => (
                <View
                  key={`selected-day-${item.dateKey}`}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 12,
                    padding: 10,
                    backgroundColor: theme.inputBg,
                    gap: 8,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <MvText variant="semi3">{formatSelectedDayLabel(item.dateKey)}</MvText>
                    {item.selectedSlot ? (
                      <MvBadge label={item.selectedSlot} variant="green" />
                    ) : (
                      <MvBadge label="Sem horário" variant="orange" />
                    )}
                  </View>

                  {item.slots.length === 0 ? (
                    <MvText variant="body4" color="secondary">
                      Sem horários livres para este dia.
                    </MvText>
                  ) : (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {item.slots.map((slot) => (
                        <Chip
                          key={`${item.dateKey}-${slot}`}
                          label={slot}
                          selected={item.selectedSlot === slot}
                          onPress={() => selectSlotForDate(item.dateKey, slot)}
                          theme={theme}
                        />
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </MvCard>

        <MvCard>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <MvText variant="semi2">Pagamento</MvText>
            <MvBadge
              label={
                selectedPaymentMethod === "CARD"
                  ? paymentReady
                    ? "Cartão configurado"
                    : "Cartão pendente"
                  : "PIX habilitado"
              }
              variant={
                selectedPaymentMethod === "CARD"
                  ? paymentReady
                    ? "green"
                    : "orange"
                  : "blue"
              }
            />
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            <Chip
              label="Cartão (crédito/débito)"
              selected={selectedPaymentMethod === "CARD"}
              onPress={() => setSelectedPaymentMethod("CARD")}
              theme={theme}
            />
            <Chip
              label="PIX"
              selected={selectedPaymentMethod === "PIX"}
              onPress={() => setSelectedPaymentMethod("PIX")}
              theme={theme}
            />
          </View>

          <MvText variant="body4" color="secondary">
            {selectedPaymentMethod === "CARD"
              ? "No cartão, o valor fica pré-autorizado antes da sessão e capturado após a confirmação."
              : "No PIX, o pagamento eh feito via QR Code/copia e cola e registrado no agendamento."}
          </MvText>
        </MvCard>

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>
            Observações
          </MvText>
          <MvInput
            multiline
            numberOfLines={4}
            placeholder="Ex.: foco em alongamento, evitar joelho direito..."
            value={notes}
            onChangeText={setNotes}
          />
        </MvCard>

        {/* Card de anamnese — sempre visível */}
        <MvCard style={{
          borderColor: !anamnesisCompleted
            ? "rgba(244,67,54,0.35)"
            : anamnesisOutdated
            ? "rgba(255,152,0,0.35)"
            : "rgba(76,175,80,0.25)",
          borderWidth: 1,
        }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons
                name={!anamnesisCompleted ? "alert-circle-outline" : anamnesisOutdated ? "warning-outline" : "checkmark-circle-outline"}
                size={18}
                color={!anamnesisCompleted ? "#f44336" : anamnesisOutdated ? "#FF9800" : "#4CAF50"}
              />
              <MvText variant="semi3" style={{ color: !anamnesisCompleted ? "#f44336" : anamnesisOutdated ? "#FF9800" : theme.textGreen }}>
                {!anamnesisCompleted ? "Ficha de saúde pendente" : anamnesisOutdated ? "Ficha desatualizada" : "Ficha de saúde OK"}
              </MvText>
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate("ClientAnamnesis")}
              style={{
                paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
                borderWidth: 1, borderColor: theme.border, backgroundColor: theme.chipBg,
              }}
            >
              <MvText variant="body4" style={{ color: theme.textGreen, fontSize: 12 }}>
                {!anamnesisCompleted ? "Preencher ficha" : "Editar ficha"}
              </MvText>
            </TouchableOpacity>
          </View>
          {!anamnesisCompleted ? (
            <MvText variant="body4" style={{ color: "#f44336", lineHeight: 18 }}>
              Preencha sua ficha de saúde para liberar o agendamento. Isso ajuda o personal a preparar um atendimento seguro e personalizado.
            </MvText>
          ) : anamnesisOutdated ? (
            <MvText variant="body4" style={{ color: "#FF9800", lineHeight: 18 }}>
              Recomendamos atualizar sua ficha a cada 6 meses para que o personal tenha informações precisas sobre você.
            </MvText>
          ) : null}
        </MvCard>

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 8 }}>
            Resumo financeiro
          </MvText>
          <MvText variant="body4" color="secondary">
            Valor por aula: {formatCurrencyBRL(unitPriceCents / 100)}
          </MvText>
          <MvText variant="body4" color="secondary">
            Aulas selecionadas: {selectedLessonsCount}
          </MvText>
          <MvText variant="semi2" style={{ color: theme.textGreen, marginTop: 6 }}>
            Total previsto: {formatCurrencyBRL(totalSelectedPriceCents / 100)}
          </MvText>
        </MvCard>

        <MvButton
          label={!anamnesisCompleted ? "Ficha de saúde pendente" : selectedDateKeys.length > 1 ? "Criar agendamentos" : "Continuar"}
          loading={creating}
          disabled={creating || !anamnesisCompleted || (selectedPaymentMethod === "CARD" && !paymentReady)}
          onPress={() => void handleContinue()}
        />
      </ScrollView>
    </View>
  );
}
