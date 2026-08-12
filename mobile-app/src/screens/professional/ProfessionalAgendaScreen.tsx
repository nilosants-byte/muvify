import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { trackEvent } from "../../services/analytics";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { ProfessionalTabParamList } from "../../navigation/route-types";
import {
  ApiError,
  Availability,
  availabilityApi,
  Booking,
  bookingsApi,
  FinancialStudent,
  financialApi,
  manualBlocksApi,
  WeeklyScheduleSlot,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvRefreshControl, MvText, TimeWheelPicker } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { SkeletonAgendaList } from "../../components/polish/SkeletonCard";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { handleScreenError } from "../shared/api-helpers";
import { MetricPill } from "../../components/professional/UXReformComponents";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import {
  computeBlockedByManualBlocks,
  computeOccupiedByBookings,
  computeOffAppClassesForDay,
  computeOffAppOccupiedKeys,
  expandRangeToQuarterHours,
  formatMinutes,
  generateDaySlots,
  parseMinutes,
  toDateKey,
} from "../../utils/agendaFreeSlots";

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_FULL_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAY_SHORT_PT = ["D", "S", "T", "Q", "Q", "S", "S"];
const WEEKDAY_FULL_PT = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WEEKDAY_ABBR_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];


type Props = BottomTabScreenProps<ProfessionalTabParamList, "ProfessionalAgenda">;
type AgendaTab = "day" | "month";

type ManualBlock = {
  id: string;
  dateKey: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  label: string;
  location?: string; // local/endereço do compromisso (opcional)
};

const tabs: Array<{ key: AgendaTab; label: string }> = [
  { key: "month", label: "Mês" },
  { key: "day", label: "Dia" },
];

function bookingBadge(status: Booking["status"]): { label: string; variant: "green" | "orange" | "red" | "gray" } {
  if (status === "COMPLETED") return { label: "Concluído", variant: "green" };
  if (status === "CANCELLED") return { label: "Cancelado", variant: "red" };
  if (status === "CONFIRMED") return { label: "Confirmado", variant: "green" };
  return { label: "Pendente", variant: "orange" };
}

// Frente 6 (segunda camada), Lote 10: ClientBookingsScreen já sinaliza
// disputa (falta reportada, contestação em aberto) direto na lista — a
// agenda do profissional não tinha nada parecido, só descobria abrindo o
// agendamento. Mesma lógica, espelhada pro lado profissional (aqui é o
// profissional quem pode não ter confirmado ainda, não o cliente).
function disputeBadge(item: Booking): { label: string } | null {
  const report = item.noShowReport;
  if (report) {
    if (report.status === "CONTESTED") return { label: "Em disputa" };
    if (report.status === "PENDING" && new Date(report.contestDeadlineAt) > new Date()) {
      return { label: "Aguardando contestação" };
    }
  }
  const autoCaptureOpen =
    item.status === "COMPLETED" &&
    !!item.completedAt &&
    !item.providerConfirmedAt &&
    !!item.clientConfirmedAt &&
    Date.now() - new Date(item.completedAt).getTime() <= 24 * 60 * 60 * 1000;
  if (autoCaptureOpen) return { label: "Aguardando contestação" };
  return null;
}

function startOfDay(input: Date) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}


function buildMonthGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstDay.getDay();
  const cells: Array<Date | null> = [];
  for (let f = 0; f < leadingBlanks; f++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function validateTime(value: string) {
  if (!/^\d{1,2}:\d{2}$/.test(value.trim())) return false;
  const [h, m] = value.trim().split(":").map(Number);
  return (h ?? 0) <= 23 && (m ?? 0) <= 59;
}

function padTime(value: string): string {
  const parts = value.trim().split(":");
  if (parts.length !== 2) return value.trim();
  return `${parts[0].padStart(2, "0")}:${parts[1]}`;
}

export function ProfessionalAgendaScreen({ navigation }: Props) {
  const { runWithAuth, showToast, user } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<AgendaTab>("day");
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [blockModalVisible, setBlockModalVisible] = useState(false);
  const [blockStart, setBlockStart] = useState("08:00");
  const [blockEnd, setBlockEnd] = useState("09:00");
  const [blockLabel, setBlockLabel] = useState("");
  const [blockLocation, setBlockLocation] = useState("");
  const [savingBlock, setSavingBlock] = useState(false);
  const [availModalVisible, setAvailModalVisible] = useState(false);
  const [availStart, setAvailStart] = useState("08:00");
  const [availEnd, setAvailEnd] = useState("09:00");
  const [availExtraDays, setAvailExtraDays] = useState<Set<number>>(new Set());
  const [availAddSaving, setAvailAddSaving] = useState(false);
  const [deletingAvailId, setDeletingAvailId] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const agendaQuery = useAuthQuery(
    queryKeys.agenda.professional(),
    async (token) => {
      const [bookingsPayload, availabilitiesPayload, blocksPayload, studentsPayload] = await Promise.all([
        bookingsApi.me(token),
        availabilityApi.me(token),
        manualBlocksApi.list(token),
        financialApi.listStudents(token),
      ]);
      return {
        bookings: bookingsPayload
          .filter((item) => item.provider?.user?.id === user?.id)
          .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()),
        availabilities: availabilitiesPayload,
        manualBlocks: blocksPayload.map((b) => ({
          id: b.id, dateKey: b.date, startTime: b.startTime,
          endTime: b.endTime, label: b.label, location: b.location ?? undefined,
        })),
        offAppStudents: studentsPayload.filter(
          (s) => s.isActive && (s.type === "PRESENTIAL" || s.type === "BOTH") &&
          Array.isArray(s.weeklySchedule) && (s.weeklySchedule as WeeklyScheduleSlot[]).length > 0
        ),
      };
    },
  );

  const bookings = agendaQuery.data?.bookings ?? ([] as Booking[]);
  const availabilities = agendaQuery.data?.availabilities ?? ([] as Availability[]);
  const manualBlocks = agendaQuery.data?.manualBlocks ?? ([] as ManualBlock[]);
  const offAppStudents = agendaQuery.data?.offAppStudents ?? ([] as FinancialStudent[]);
  const loading = agendaQuery.isLoading;

  useEffect(() => {
    if (agendaQuery.error) {
      handleScreenError({ error: agendaQuery.error, showToast, fallbackMessage: "Falha ao carregar agenda.", navigation });
    }
  }, [agendaQuery.error, showToast, navigation]);

  useFocusEffectSkippingFirst(useCallback(() => { void agendaQuery.refetch(); }, [agendaQuery.refetch]));

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Bookings visíveis conforme a aba selecionada
  const visibleBookings = useMemo(() => {
    if (activeTab === "day") {
      return bookings.filter((item) => isSameDay(new Date(item.scheduledAt), selectedDate));
    }
    return bookings.filter((item) => {
      const d = new Date(item.scheduledAt);
      return d.getFullYear() === selectedDate.getFullYear() && d.getMonth() === selectedDate.getMonth();
    });
  }, [activeTab, bookings, selectedDate]);

  // Modo "Mês": agrupa os compromissos por data (em vez de uma lista corrida
  // só com horário) — sem isso, um mês cheio vira uma sequência de horários
  // sem nenhuma pista de qual dia é qual.
  const monthSections = useMemo(() => {
    if (activeTab !== "month") return [];
    const groups = new Map<string, Booking[]>();
    visibleBookings.forEach((item) => {
      const key = toDateKey(new Date(item.scheduledAt));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    });
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, items]) => {
        const [y, m, d] = dateKey.split("-").map(Number);
        const date = new Date(y, m - 1, d);
        return {
          title: `${WEEKDAY_FULL_PT[date.getDay()]}, ${d} de ${MONTHS_FULL_PT[date.getMonth()].toLowerCase()}`,
          dateKey,
          data: items,
        };
      });
  }, [activeTab, visibleBookings]);

  // Slots do dia selecionado
  const allDaySlots = useMemo(
    () => generateDaySlots(availabilities, selectedDate.getDay()),
    [availabilities, selectedDate]
  );

  const occupiedSlotKeys = useMemo(
    () => computeOccupiedByBookings(bookings, selectedDate),
    [bookings, selectedDate]
  );

  const selectedDateKey = useMemo(() => toDateKey(selectedDate), [selectedDate]);

  const todayBlockedKeys = useMemo(
    () => computeBlockedByManualBlocks(manualBlocks, selectedDateKey, allDaySlots),
    [manualBlocks, selectedDateKey, allDaySlots]
  );

  // Dias com agendamentos para o calendário
  const daysWithBookings = useMemo(() => {
    const keys = new Set<string>();
    bookings.forEach((item) => {
      if (item.status !== "CANCELLED") keys.add(toDateKey(new Date(item.scheduledAt)));
    });
    return keys;
  }, [bookings]);

  // Dias com bloqueios manuais (para mostrar indicador laranja no calendário)
  const daysWithBlocks = useMemo(() => {
    const keys = new Set<string>();
    manualBlocks.forEach((b) => keys.add(b.dateKey));
    return keys;
  }, [manualBlocks]);

  // Aulas de alunos fora do app no dia selecionado (por horário recorrente semanal)
  // — só conta se a data selecionada estiver dentro do período em que esse aluno
  // está de fato ativo (startDate/recurrenceEndDate cadastrados no Financeiro).
  const offAppClassesForDay = useMemo(
    () => computeOffAppClassesForDay(offAppStudents, selectedDate),
    [offAppStudents, selectedDate]
  );

  // Horarios ocupados por aluno fora do app — usados pra excluir de "livre" na
  // agenda, evitando o profissional ter que bloquear o mesmo horario duas vezes.
  const offAppOccupiedKeys = useMemo(
    () => computeOffAppOccupiedKeys(offAppClassesForDay, allDaySlots),
    [offAppClassesForDay, allDaySlots]
  );

  const freeSlots = useMemo(
    () => allDaySlots.filter((s) => !occupiedSlotKeys.has(s) && !todayBlockedKeys.has(s) && !offAppOccupiedKeys.has(s)),
    [allDaySlots, occupiedSlotKeys, todayBlockedKeys, offAppOccupiedKeys]
  );

  const calendarCells = useMemo(
    () => buildMonthGrid(calendarCursor.year, calendarCursor.month),
    [calendarCursor]
  );

  // ── Faixa de dias (semana do dia selecionado) — substitui o mês fixo por
  // padrão; o mês completo só aparece quando o usuário pede (calendarExpanded).
  const weekDays = useMemo(() => {
    const start = new Date(selectedDate);
    start.setDate(selectedDate.getDate() - selectedDate.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [selectedDate]);

  const isCurrentWeek = useMemo(() => {
    const today = startOfDay(new Date());
    return weekDays.some((d) => isSameDay(d, today));
  }, [weekDays]);

  function jumpToToday() {
    const today = startOfDay(new Date());
    setSelectedDate(today);
    setCalendarCursor({ year: today.getFullYear(), month: today.getMonth() });
    setActiveTab("day");
    setCalendarExpanded(false);
  }

  const goToStack = (screen: string, params?: object) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate(screen, params);
  };

  async function addManualBlock() {
    if (!validateTime(blockStart)) { showToast("Formato inválido. Use HH:MM.", "error"); return; }
    if (!validateTime(blockEnd)) { showToast("Formato inválido. Use HH:MM.", "error"); return; }
    const paddedStart = padTime(blockStart);
    const paddedEnd = padTime(blockEnd);
    if (paddedStart >= paddedEnd) { showToast("Início deve ser menor que o fim.", "error"); return; }

    try {
      setSavingBlock(true);
      const created = await runWithAuth((token) =>
        manualBlocksApi.create(token, {
          date: selectedDateKey,
          startTime: paddedStart,
          endTime: paddedEnd,
          label: blockLabel.trim() || "Bloqueado",
          location: blockLocation.trim() || undefined,
        })
      );
      queryClient.setQueryData<typeof agendaQuery.data>(queryKeys.agenda.professional(), (old) => ({
        ...old!,
        manualBlocks: [
          ...(old?.manualBlocks ?? []),
          { id: created.id, dateKey: created.date, startTime: created.startTime, endTime: created.endTime, label: created.label, location: created.location ?? undefined },
        ],
      }));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      trackEvent("time_block_added");
      showToast("Horário bloqueado.", "success");
      setBlockModalVisible(false);
      setBlockStart("08:00");
      setBlockEnd("09:00");
      setBlockLabel("");
      setBlockLocation("");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível criar bloqueio.", navigation });
    } finally {
      setSavingBlock(false);
    }
  }

  async function removeManualBlock(id: string) {
    Alert.alert("Remover bloqueio", "Deseja remover este bloqueio de horário?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover", style: "destructive",
        onPress: async () => {
          try {
            await runWithAuth((token) => manualBlocksApi.delete(token, id));
            queryClient.setQueryData<typeof agendaQuery.data>(queryKeys.agenda.professional(), (old) => ({
              ...old!,
              manualBlocks: (old?.manualBlocks ?? []).filter((b) => b.id !== id),
            }));
            showToast("Bloqueio removido.", "success");
          } catch (error) {
            handleScreenError({ error, showToast, fallbackMessage: "Não foi possível remover bloqueio.", navigation });
          }
        },
      },
    ]);
  }

  const todayManualBlocks = useMemo(
    () => manualBlocks.filter((b) => b.dateKey === selectedDateKey),
    [manualBlocks, selectedDateKey]
  );

  const selectedWeekday = useMemo(() => selectedDate.getDay(), [selectedDate]);

  // ── Timeline unificada do dia: bookings + slots livres + bloqueios em ordem cronológica ──
  type OffAppClass = { studentName: string; startTime: string; endTime: string; location?: string };

  type TimelineItem =
    | { kind: "booking"; time: string; booking: Booking }
    | { kind: "free"; time: string }
    | { kind: "blocked"; time: string; block: ManualBlock }
    | { kind: "external"; time: string; cls: OffAppClass };

  const dayTimeline = useMemo<TimelineItem[]>(() => {
    if (activeTab !== "day") return [];
    const items: TimelineItem[] = [];
    const matchedBookingIds = new Set<string>();
    // Frente 5 (Descoberta, agendamento e agenda), Lote 3: usar só a grade
    // de 30min (occupiedSlotKeys, que também só cobre PENDING/CONFIRMED)
    // pra decidir se um horário tem booking deixava de fora tanto sessões
    // fora da grade (horário não múltiplo de 30min) quanto sessões já
    // concluídas/canceladas — o mapa por horário exato, com todos os
    // status, cobre os dois casos de uma vez.
    const bookingByTime = new Map<string, Booking>();
    visibleBookings.forEach((booking) => {
      const d = new Date(booking.scheduledAt);
      const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      bookingByTime.set(time, booking);
    });

    allDaySlots.forEach((slot) => {
      const bookingHere = bookingByTime.get(slot);
      const isBlocked = todayBlockedKeys.has(slot);
      const isOffApp = offAppOccupiedKeys.has(slot);
      if (bookingHere) {
        items.push({ kind: "booking", time: slot, booking: bookingHere });
        matchedBookingIds.add(bookingHere.id);
      } else if (isBlocked) {
        const block = todayManualBlocks.find((b) => {
          const slotMin = parseMinutes(slot);
          return slotMin >= parseMinutes(b.startTime) && slotMin < parseMinutes(b.endTime);
        });
        if (block) items.push({ kind: "blocked", time: slot, block });
      } else if (!isOffApp) {
        // Slots ocupados por aluno fora do app nao viram "free" aqui — o item
        // "external" correspondente ja e adicionado abaixo, uma vez por aula.
        items.push({ kind: "free", time: slot });
      }
    });
    offAppClassesForDay.forEach((cls) => {
      items.push({ kind: "external", time: cls.startTime, cls });
    });
    // Booking cujo horário não caiu em nenhum slot de 30min gerado pela
    // disponibilidade recorrente — sem isso, ficava completamente
    // invisível na timeline do dia (nem "livre", nem "booking").
    visibleBookings.forEach((booking) => {
      if (matchedBookingIds.has(booking.id)) return;
      const d = new Date(booking.scheduledAt);
      const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      items.push({ kind: "booking", time, booking });
    });
    return items.sort((a, b) => a.time.localeCompare(b.time));
  }, [activeTab, allDaySlots, todayBlockedKeys, offAppOccupiedKeys, visibleBookings, todayManualBlocks, offAppClassesForDay]);

  const dayAvailabilities = useMemo(
    () => availabilities
      .filter((a) => a.weekday === selectedWeekday && a.isActive)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [availabilities, selectedWeekday]
  );

  function toggleAvailExtraDay(dayId: number) {
    setAvailExtraDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayId)) next.delete(dayId); else next.add(dayId);
      return next;
    });
  }

  async function addAvailSlot() {
    if (!validateTime(availStart)) { showToast("Formato inválido. Use HH:MM.", "error"); return; }
    if (!validateTime(availEnd)) { showToast("Formato inválido. Use HH:MM.", "error"); return; }
    const ps = padTime(availStart);
    const pe = padTime(availEnd);
    if (ps >= pe) { showToast("Início deve ser menor que o fim.", "error"); return; }
    const allDays = [selectedWeekday, ...Array.from(availExtraDays)];
    try {
      setAvailAddSaving(true);
      // Frente 5 (Descoberta, agendamento e agenda), Lote 6: Promise.all
      // falhava tudo-ou-nada se um único dia conflitasse — os dias já
      // criados com sucesso ficavam fora do cache local até a próxima
      // carga da tela, e a mensagem sugeria falha total.
      const settled = await Promise.allSettled(
        allDays.map((day) =>
          runWithAuth((token) =>
            availabilityApi.create(token, { weekday: day, startTime: ps, endTime: pe, isActive: true })
          )
        )
      );
      const succeeded = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const failedDays = allDays.filter((_, index) => settled[index]?.status === "rejected");

      queryClient.setQueryData<typeof agendaQuery.data>(queryKeys.agenda.professional(), (old) => ({
        ...old!,
        availabilities: [...(old?.availabilities ?? []), ...succeeded],
      }));
      trackEvent("availability_slot_added", { days_count: succeeded.length });

      if (failedDays.length === 0) {
        setAvailModalVisible(false);
        setAvailStart("08:00");
        setAvailEnd("09:00");
        setAvailExtraDays(new Set());
        showToast(succeeded.length > 1 ? `Horário adicionado em ${succeeded.length} dias.` : "Horário adicionado.", "success");
      } else if (succeeded.length > 0) {
        const failedLabels = failedDays.map((day) => WEEKDAY_FULL_PT[day]).join(", ");
        showToast(`Adicionado em ${succeeded.length} dia(s). Falhou em: ${failedLabels}.`, "error");
      } else {
        showToast("Falha ao adicionar horário em todos os dias selecionados.", "error");
      }
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao adicionar horário.", navigation });
    } finally {
      setAvailAddSaving(false);
    }
  }

  async function doRemoveAvailSlot(id: string, force = false) {
    try {
      setDeletingAvailId(id);
      await runWithAuth((token) => availabilityApi.delete(token, id, force));
      queryClient.setQueryData<typeof agendaQuery.data>(queryKeys.agenda.professional(), (old) => ({
        ...old!,
        availabilities: (old?.availabilities ?? []).filter((a) => a.id !== id),
      }));
      showToast("Horário removido.", "success");
    } catch (error) {
      // Frente 5 (Descoberta, agendamento e agenda), Lote 6: 409 aqui
      // significa que há agendamento futuro marcado dentro desse horário —
      // pede confirmação extra em vez de bloquear de vez.
      if (error instanceof ApiError && error.status === 409 && !force) {
        setDeletingAvailId(null);
        Alert.alert("Existem agendamentos marcados", error.message, [
          { text: "Cancelar", style: "cancel" },
          { text: "Remover mesmo assim", style: "destructive", onPress: () => void doRemoveAvailSlot(id, true) },
        ]);
        return;
      }
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao remover horário.", navigation });
    } finally {
      setDeletingAvailId(null);
    }
  }

  // Remove uma faixa de disponibilidade recorrente. Como a faixa se repete
  // toda semana (não é só "esse horário hoje"), o aviso deixa isso explícito
  // pra não surpreender quem tocar num horário livre específico na timeline.
  function removeAvailSlot(range: Availability) {
    Alert.alert(
      "Remover disponibilidade",
      `Isso remove o horário ${range.startTime}–${range.endTime} de todas as ${WEEKDAY_FULL_PT[range.weekday]}s — não só hoje.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Remover", style: "destructive", onPress: () => void doRemoveAvailSlot(range.id) },
      ]
    );
  }

  const selectedDayLabel = useMemo(() => {
    const weekday = WEEKDAY_FULL_PT[selectedDate.getDay()];
    const day = selectedDate.getDate();
    const month = MONTHS_FULL_PT[selectedDate.getMonth()].toLowerCase();
    return `${weekday}, ${day} de ${month}`;
  }, [selectedDate]);

  return (
    <>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 10 : 0}
      >
        <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.agenda">
          <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

        {/* Header */}
        <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TouchableOpacity
            onPress={() => navigation.navigate("ProfessionalHome")}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="chevron-back" size={20} color={theme.text2} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Minha Agenda</MvText>
          </View>
          {loading ? (
            <MvText variant="body4" color="secondary">Atualizando...</MvText>
          ) : (
            <TouchableOpacity
              onPress={() => setCalendarExpanded((v) => !v)}
              style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: calendarExpanded ? theme.primarySubtle : theme.backBtn,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Ionicons name="calendar-outline" size={20} color={calendarExpanded ? theme.textGreen : theme.text2} />
            </TouchableOpacity>
          )}
        </View>

        {/* Lista de agendamentos */}
        <ScreenEntrance>
        <SectionList
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 90,
            gap: 8,
          }}
          sections={activeTab === "day" ? [] : monthSections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled
          renderSectionHeader={({ section }) => (
            <View style={{ paddingTop: 14, paddingBottom: 6, backgroundColor: theme.bg }}>
              <MvText variant="semi2" style={{ fontSize: 14 }}>{section.title}</MvText>
              <MvText variant="body4" color="secondary" style={{ fontSize: 11, marginTop: 1 }}>
                {section.data.length} sessão{section.data.length > 1 ? "ões" : ""}
              </MvText>
            </View>
          )}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          refreshControl={
            <MvRefreshControl refreshing={loading} onRefresh={() => void agendaQuery.refetch()} />
          }
          ListHeaderComponent={
            <View>
              {/* Faixa de dias — leve, sempre visível; o mês completo só aparece sob demanda (ícone de calendário no cabeçalho) */}
              <View style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {weekDays.map((dateCell) => {
                    const isSelected = isSameDay(dateCell, selectedDate);
                    const isToday = isSameDay(dateCell, new Date());
                    const cellKey = toDateKey(dateCell);
                    const hasBooking = daysWithBookings.has(cellKey);
                    const hasBlock = daysWithBlocks.has(cellKey);
                    return (
                      <TouchableOpacity
                        key={cellKey}
                        onPress={() => setSelectedDate(startOfDay(dateCell))}
                        style={{
                          flex: 1,
                          paddingVertical: 8,
                          borderRadius: 12,
                          alignItems: "center",
                          borderWidth: 1,
                          borderColor: isSelected ? "rgba(34,197,94,0.30)" : theme.border,
                          backgroundColor: isSelected ? theme.primarySubtle : theme.cardBg,
                        }}
                      >
                        <MvText variant="body4" color="secondary" style={{ fontSize: 9, textTransform: "uppercase" }}>
                          {WEEKDAY_SHORT_PT[dateCell.getDay()]}
                        </MvText>
                        <MvText
                          variant="semi2"
                          style={{
                            fontSize: 14, marginTop: 2,
                            color: isSelected ? theme.textGreen : isToday ? theme.textGreen : theme.text1,
                          }}
                        >
                          {dateCell.getDate()}
                        </MvText>
                        {(hasBooking || hasBlock) ? (
                          <View style={{ flexDirection: "row", gap: 2, marginTop: 3 }}>
                            {hasBooking ? <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.textGreen }} /> : null}
                            {hasBlock ? <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: "#FF9800" }} /> : null}
                          </View>
                        ) : <View style={{ height: 7 }} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {!isCurrentWeek ? (
                  <TouchableOpacity onPress={jumpToToday} style={{ alignSelf: "flex-end", marginTop: 8 }}>
                    <MvText variant="semi3" style={{ color: theme.textGreen, fontSize: 12 }}>Voltar para hoje</MvText>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Mês completo — só aparece quando o ícone de calendário no cabeçalho é tocado */}
              {calendarExpanded ? (
                <View style={{ marginBottom: 10 }}>
                  <MvCard style={{ padding: 12 }}>
                    {/* Navegação de mês */}
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <TouchableOpacity
                        onPress={() => setCalendarCursor((c) => {
                          const prev = new Date(c.year, c.month - 1, 1);
                          return { year: prev.getFullYear(), month: prev.getMonth() };
                        })}
                        hitSlop={8}
                        style={{ padding: 4 }}
                      >
                        <MvText variant="semi2">‹</MvText>
                      </TouchableOpacity>
                      <MvText variant="semi2">
                        {`${MONTHS_FULL_PT[calendarCursor.month]} ${calendarCursor.year}`}
                      </MvText>
                      <TouchableOpacity
                        onPress={() => setCalendarCursor((c) => {
                          const next = new Date(c.year, c.month + 1, 1);
                          return { year: next.getFullYear(), month: next.getMonth() };
                        })}
                        hitSlop={8}
                        style={{ padding: 4 }}
                      >
                        <MvText variant="semi2">›</MvText>
                      </TouchableOpacity>
                    </View>

                    {/* Cabeçalho dos dias da semana */}
                    <View style={{ flexDirection: "row", marginBottom: 2 }}>
                      {WEEKDAY_SHORT_PT.map((label, index) => (
                        <View key={`wh-${index}`} style={{ width: "14.285%", alignItems: "center", paddingVertical: 2 }}>
                          <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>{label}</MvText>
                        </View>
                      ))}
                    </View>

                    {/* Grid de dias */}
                    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                      {calendarCells.map((dateCell, index) => {
                        if (!dateCell) {
                          return <View key={`blank-${index}`} style={{ width: "14.285%", paddingVertical: 2 }} />;
                        }
                        const isSelected = isSameDay(dateCell, selectedDate);
                        const isToday = isSameDay(dateCell, new Date());
                        const cellKey = toDateKey(dateCell);
                        const hasBooking = daysWithBookings.has(cellKey);
                        const hasBlock = daysWithBlocks.has(cellKey);
                        const isCurrentMonth = dateCell.getMonth() === calendarCursor.month;
                        return (
                          <TouchableOpacity
                            key={`${toDateKey(dateCell)}-${index}`}
                            onPress={() => {
                              setSelectedDate(startOfDay(dateCell));
                              setActiveTab("day");
                              setCalendarExpanded(false);
                            }}
                            style={{ width: "14.285%", alignItems: "center", paddingVertical: 2 }}
                          >
                            <View style={{
                              width: 24,
                              height: 24,
                              borderRadius: 12,
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: isSelected ? theme.primary : "transparent",
                              borderWidth: isToday && !isSelected ? 1.5 : 0,
                              borderColor: theme.primary,
                            }}>
                              <MvText
                                variant="body4"
                                style={{
                                  fontSize: 11,
                                  fontWeight: isSelected ? "700" : "400",
                                  color: !isCurrentMonth
                                    ? theme.text3
                                    : isSelected
                                    ? theme.textOnPrimary
                                    : isToday
                                    ? theme.textGreen
                                    : theme.text1,
                                }}
                              >
                                {dateCell.getDate()}
                              </MvText>
                            </View>
                            {/* Indicadores: verde=agendamento, laranja=bloqueio manual */}
                            {(hasBooking || hasBlock) ? (
                              <View style={{ flexDirection: "row", gap: 2, marginTop: 1 }}>
                                {hasBooking ? (
                                  <View style={{
                                    width: 4, height: 4, borderRadius: 2,
                                    backgroundColor: isSelected ? theme.primary : "rgba(34,197,94,0.50)",
                                  }} />
                                ) : null}
                                {hasBlock ? (
                                  <View style={{
                                    width: 4, height: 4, borderRadius: 2,
                                    backgroundColor: "#FF9800",
                                  }} />
                                ) : null}
                              </View>
                            ) : <View style={{ height: 5 }} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* Botão Hoje */}
                    <TouchableOpacity
                      onPress={jumpToToday}
                      style={{
                        alignSelf: "flex-end",
                        marginTop: 8,
                        paddingHorizontal: 14,
                        paddingVertical: 6,
                        borderRadius: 20,
                        borderWidth: 1,
                        borderColor: "rgba(34,197,94,0.30)",
                        backgroundColor: theme.primarySubtle,
                      }}
                    >
                      <MvText variant="semi3" style={{ color: theme.textGreen, fontSize: 12 }}>Hoje</MvText>
                    </TouchableOpacity>
                  </MvCard>
                </View>
              ) : null}

              <View style={{ flexDirection: "row", marginBottom: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, overflow: "hidden" }}>
                {tabs.map((tab, i) => (
                  <TouchableOpacity
                    key={tab.key}
                    onPress={() => setActiveTab(tab.key)}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      alignItems: "center",
                      backgroundColor: activeTab === tab.key ? theme.primarySubtle : "transparent",
                      borderRightWidth: i < tabs.length - 1 ? 1 : 0,
                      borderRightColor: theme.border,
                    }}
                  >
                    <MvText variant="semi3" style={{ color: activeTab === tab.key ? theme.textGreen : theme.text2 }}>
                      {tab.label}
                    </MvText>
                  </TouchableOpacity>
                ))}
              </View>

              {activeTab === "day" ? (
                <View style={{ gap: 10, marginBottom: 4 }}>
                {/* ── Resumo do dia: header + métricas ── */}
                <View>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <MvText variant="semi1">{selectedDayLabel}</MvText>
                    <TouchableOpacity
                      onPress={() => setBlockModalVisible(true)}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: 5,
                        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99,
                        borderWidth: 1, borderColor: "rgba(245,158,11,0.28)",
                        backgroundColor: "rgba(245,158,11,0.10)",
                      }}
                    >
                      <Ionicons name="lock-closed-outline" size={12} color="#F59E0B" />
                      <MvText variant="badge" style={{ color: "#F59E0B", fontSize: 11 }}>Bloquear</MvText>
                    </TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 2 }}>
                    <MetricPill label="Compromissos" value={visibleBookings.length} tone={visibleBookings.length > 0 ? "green" : "sky"} />
                    <MetricPill label="Horários livres" value={freeSlots.length} tone="sky" />
                    <MetricPill label="Bloqueios" value={todayManualBlocks.length} tone={todayManualBlocks.length > 0 ? "amber" : "green"} />
                  </View>
                </View>

                {/* ── TIMELINE UNIFICADA DO DIA ── */}
                {dayTimeline.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    {dayTimeline.map((item, idx) => {
                      if (item.kind === "booking") {
                        const badge = bookingBadge(item.booking.status);
                        const dispute = disputeBadge(item.booking);
                        const isCompleted = item.booking.status === "COMPLETED" || item.booking.status === "CANCELLED";
                        const isPastConfirmed =
                          item.booking.status === "CONFIRMED" &&
                          new Date(item.booking.scheduledAt).getTime() < Date.now();
                        return (
                          <View key={`bk-${item.booking.id}`} style={{ gap: 6 }}>
                            <PressableScale
                              scale={0.97}
                              onPress={() => goToStack("BookingDetailProfessional", { bookingId: item.booking.id })}
                            >
                              <View style={{
                                flexDirection: "row", alignItems: "center", gap: 12,
                                borderRadius: 16, borderWidth: 1,
                                borderColor: isPastConfirmed ? "rgba(36,230,109,0.30)" : theme.border,
                                backgroundColor: isPastConfirmed ? "rgba(36,230,109,0.06)" : theme.cardBg,
                                paddingRight: 14, paddingVertical: 13,
                                opacity: isCompleted ? 0.60 : 1,
                                overflow: "hidden",
                              }}>
                                <View style={{
                                  width: 4, alignSelf: "stretch", flexShrink: 0,
                                  backgroundColor: item.booking.status === "CONFIRMED" ? theme.textGreen
                                    : item.booking.status === "PENDING" ? "#F5A623"
                                    : theme.border,
                                }} />
                                <MvText variant="semi2" style={{ color: theme.textGreen, minWidth: 44, fontSize: 16 }}>{item.time}</MvText>
                                <View style={{ flex: 1, gap: 2 }}>
                                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                                    <MvText variant="semi2" numberOfLines={1}>{item.booking.client?.name ?? "Cliente"}</MvText>
                                    {item.booking.packageId ? (
                                      <Ionicons name="albums-outline" size={13} color={theme.text3} accessibilityLabel="Sessão de pacote" />
                                    ) : null}
                                  </View>
                                  {item.booking.sessionLocation ? (
                                    <MvText variant="body4" color="secondary" numberOfLines={1}>{item.booking.sessionLocation}</MvText>
                                  ) : null}
                                </View>
                                <View style={{ gap: 4, alignItems: "flex-end" }}>
                                  <MvBadge label={badge.label} variant={badge.variant} />
                                  {dispute ? <MvBadge label={dispute.label} variant="orange" /> : null}
                                </View>
                                <Ionicons name="chevron-forward" size={14} color={theme.text3} />
                              </View>
                            </PressableScale>
                            {isPastConfirmed ? (
                              <TouchableOpacity
                                onPress={() => goToStack("ProfessionalConfirmCompletion", { bookingId: item.booking.id })}
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 6,
                                  paddingVertical: 10,
                                  borderRadius: 12,
                                  backgroundColor: theme.textGreen,
                                }}
                              >
                                <Ionicons name="checkmark-circle-outline" size={16} color={theme.textOnPrimary} />
                                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>
                                  {/* Frente 6 (segunda camada), Lote 11: o texto ficava fixo em
                                    "Validar presença" mesmo depois de já validada — o que falta
                                    nesse ponto é confirmar a conclusão com a selfie, não validar
                                    de novo (BookingDetailProfessionalScreen já trata esse estado
                                    corretamente). */}
                                  {item.booking.attendanceCodeValidatedAt ? "Confirmar conclusão" : "Validar presença"}
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        );
                      }
                      if (item.kind === "blocked") {
                        return (
                          <View key={`bl-${idx}`} style={{
                            flexDirection: "row", alignItems: "center", gap: 12,
                            borderRadius: 16, borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
                            backgroundColor: "rgba(245,158,11,0.05)",
                            paddingHorizontal: 14, paddingVertical: 13,
                          }}>
                            <MvText variant="semi2" style={{ color: "#F59E0B", minWidth: 44, fontSize: 16 }}>{item.time}</MvText>
                            <View style={{ flex: 1, gap: 2 }}>
                              <MvText variant="semi3" style={{ color: "#F59E0B" }}>{item.block.label}</MvText>
                              {item.block.location ? (
                                <MvText variant="body4" color="secondary">{item.block.location}</MvText>
                              ) : null}
                            </View>
                            <MvBadge label="Bloqueado" variant="orange" />
                            <TouchableOpacity onPress={() => void removeManualBlock(item.block.id)} hitSlop={8}>
                              <Ionicons name="trash-outline" size={16} color="#f44336" />
                            </TouchableOpacity>
                          </View>
                        );
                      }
                      if (item.kind === "external") {
                        return (
                          <View key={`ext-${item.cls.studentName}-${item.time}`} style={{
                            flexDirection: "row", alignItems: "center", gap: 12,
                            borderRadius: 16, borderWidth: 1, borderColor: "rgba(59,130,246,0.25)",
                            backgroundColor: "rgba(59,130,246,0.05)",
                            paddingHorizontal: 14, paddingVertical: 13,
                          }}>
                            <MvText variant="semi2" style={{ color: "#3B82F6", minWidth: 44, fontSize: 16 }}>{item.time}</MvText>
                            <View style={{ flex: 1, gap: 2 }}>
                              <MvText variant="semi3">{item.cls.studentName}</MvText>
                              {item.cls.location ? (
                                <MvText variant="body4" color="secondary" numberOfLines={1}>{item.cls.location}</MvText>
                              ) : null}
                            </View>
                            <MvBadge label="Externa" variant="blue" />
                          </View>
                        );
                      }
                      // free slot
                      const containingRange = dayAvailabilities.find((a) => {
                        const slotMin = parseMinutes(item.time);
                        return slotMin >= parseMinutes(a.startTime) && slotMin < parseMinutes(a.endTime);
                      });
                      return (
                        <View key={`fr-${item.time}`} style={{
                          flexDirection: "row", alignItems: "center", gap: 12,
                          borderRadius: 16, borderWidth: 1, borderColor: "rgba(34,197,94,0.28)",
                          backgroundColor: theme.primarySubtle,
                          paddingHorizontal: 14, paddingVertical: 13,
                        }}>
                          <MvText variant="semi2" style={{ color: theme.textGreen, minWidth: 44, fontSize: 16 }}>{item.time}</MvText>
                          <View style={{ flex: 1, gap: 2 }}>
                            <View style={{
                              flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
                              backgroundColor: theme.primarySubtle,
                              borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3,
                            }}>
                              <MvText variant="body4" style={{ color: theme.textGreen, fontSize: 11 }}>Horário livre</MvText>
                            </View>
                            {/* Frente 5 (Descoberta, agendamento e agenda), Lote 6: a lixeira
                                remove a janela de disponibilidade inteira, não só este slot de
                                30min — deixa o range real explícito antes do usuário tocar. */}
                            {containingRange ? (
                              <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>
                                Faixa completa: {containingRange.startTime}–{containingRange.endTime}
                              </MvText>
                            ) : null}
                          </View>
                          {containingRange ? (
                            <TouchableOpacity
                              onPress={() => removeAvailSlot(containingRange)}
                              disabled={deletingAvailId === containingRange.id}
                              hitSlop={8}
                            >
                              <Ionicons name="trash-outline" size={16} color={deletingAvailId === containingRange.id ? theme.text3 : "#f44336"} />
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                ) : allDaySlots.length === 0 ? (
                  <View style={{
                    alignItems: "center", padding: 24, gap: 12,
                    backgroundColor: "rgba(36,230,109,0.04)",
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: "rgba(36,230,109,0.12)",
                    borderStyle: "dashed",
                  }}>
                    <Ionicons name="calendar-outline" size={36} color={theme.textGreen} />
                    <MvText variant="h3">Dia livre</MvText>
                    <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
                      Nenhum compromisso para este dia. Adicione horários disponíveis para receber agendamentos.
                    </MvText>
                    <TouchableOpacity
                      onPress={() => { setAvailModalVisible(true); setAvailStart("08:00"); setAvailEnd("09:00"); setAvailExtraDays(new Set()); }}
                      style={{ backgroundColor: theme.primary, borderRadius: 99, paddingHorizontal: 20, paddingVertical: 10 }}
                    >
                      <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>
                        + Adicionar horário
                      </MvText>
                    </TouchableOpacity>
                  </View>
                ) : null}

              </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const badge = bookingBadge(item.status);
            const d = new Date(item.scheduledAt);
            const isCompleted = item.status === "COMPLETED" || item.status === "CANCELLED";
            return (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => goToStack("BookingDetailProfessional", { bookingId: item.id })}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  backgroundColor: theme.cardBg,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 16,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  opacity: isCompleted ? 0.60 : 1,
                }}
              >
                {/* Horário no lado esquerdo — destaque visual */}
                <View style={{
                  minWidth: 44,
                  alignItems: "center",
                  flexShrink: 0,
                }}>
                  <MvText variant="semi2" style={{ color: theme.textGreen, fontSize: 16 }}>
                    {d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
                  </MvText>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <MvText variant="semi2" numberOfLines={1}>{item.client?.name ?? "Cliente"}</MvText>
                  {item.sessionLocation ? (
                    <MvText variant="body4" color="secondary" numberOfLines={1}>{item.sessionLocation}</MvText>
                  ) : item.notes ? (
                    <MvText variant="body4" color="secondary" numberOfLines={1}>{item.notes}</MvText>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <MvBadge label={badge.label} variant={badge.variant} />
                  <Ionicons name="chevron-forward" size={14} color={theme.text3} />
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            // No modo "Dia", o cabeçalho da lista já cobre sozinho todo estado
            // vazio/cheio do dia (card "Dia livre" etc.) — mostrar isso de novo
            // aqui embaixo duplicava o mesmo aviso duas vezes na tela.
            activeTab === "day" ? null : loading ? (
              <SkeletonAgendaList />
            ) : (
              <View style={{ paddingVertical: 32, alignItems: "center", gap: 10 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.chipBg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="calendar-outline" size={26} color={theme.textGreen} />
                </View>
                <MvText variant="semi3" color="secondary">Nenhum compromisso neste mês</MvText>
                <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
                  Adicione horários disponíveis para receber agendamentos.
                </MvText>
                <TouchableOpacity
                  onPress={() => setAvailModalVisible(true)}
                  style={{ marginTop: 4, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: theme.textGreen }}
                >
                  <MvText variant="semi3" style={{ color: theme.textOnPrimary }}>+ Adicionar horário</MvText>
                </TouchableOpacity>
              </View>
            )
          }
          showsVerticalScrollIndicator={false}
          
          
        />
        </ScreenEntrance>
          {!keyboardVisible ? (
            <ProfessionalBottomNav
              activeKey="agenda"
              onPress={(key) => {
                if (key === "home") {
                  navigation.navigate("ProfessionalHome");
                  return;
                }
                if (key === "agenda") return;
                if (key === "alunos") {
                  goToStack("ProfessionalStudents");
                  return;
                }
                if (key === "consultoria") {
                  navigation.navigate("ProfessionalConsultancyCenter");
                  return;
                }
                if (key === "financeiro") {
                  goToStack("PayoutStatus");
                  return;
                }
              }}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>

      {/* Modal de bloqueio manual */}
      <Modal
        animationType="slide"
        transparent
        visible={blockModalVisible}
        onRequestClose={() => setBlockModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior="padding"
          keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 12 : 16}
          style={{ flex: 1 }}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
            <Pressable
              style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
              onPress={() => setBlockModalVisible(false)}
            />
            <View style={{
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              backgroundColor: theme.cardBg,
              borderWidth: 1,
              borderColor: theme.border,
              paddingBottom: insets.bottom + 16,
            }}>
              <ScrollView
                automaticallyAdjustKeyboardInsets={true}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: insets.bottom + 24 }}
              >
                <MvText variant="semi1">Bloquear horário</MvText>
                <MvText variant="body4" color="secondary">{selectedDayLabel}</MvText>

                <MvInput
                  placeholder="Compromisso (ex: Reunião com cliente, Médico…)"
                  value={blockLabel}
                  onChangeText={setBlockLabel}
                  returnKeyType="next"
                />
                <MvInput
                  placeholder="Local (ex: Academia Bifit, Rua X, 123 — opcional)"
                  value={blockLocation}
                  onChangeText={setBlockLocation}
                  returnKeyType="next"
                />

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <MvText variant="body4" color="secondary" style={{ marginBottom: 8 }}>Início</MvText>
                    <TimeWheelPicker
                      value={blockStart}
                      onChange={setBlockStart}
                      unavailableTimes={todayManualBlocks.flatMap((b) => expandRangeToQuarterHours(b.startTime, b.endTime))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="body4" color="secondary" style={{ marginBottom: 8 }}>Fim</MvText>
                    <TimeWheelPicker
                      value={blockEnd}
                      onChange={setBlockEnd}
                      unavailableTimes={todayManualBlocks.flatMap((b) => expandRangeToQuarterHours(b.startTime, b.endTime))}
                    />
                  </View>
                </View>

                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <MvButton variant="outline" label="Cancelar" onPress={() => { setBlockModalVisible(false); setBlockLocation(""); }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvButton label="Bloquear" loading={savingBlock} onPress={() => void addManualBlock()} />
                  </View>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal de adicionar horário disponível */}
      <Modal
        animationType="slide"
        transparent
        visible={availModalVisible}
        onRequestClose={() => setAvailModalVisible(false)}
      >
        {/* Toque fora da folha fecha o modal — sem sobreposição visual */}
        <Pressable
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          onPress={() => { setAvailModalVisible(false); setAvailExtraDays(new Set()); }}
        />

        {/* KAV envolve APENAS a folha */}
        <View style={{ flex: 1, justifyContent: "flex-end" }} pointerEvents="box-none">
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={{
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              backgroundColor: theme.cardBg,
              borderTopWidth: 1,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderColor: theme.border,
              overflow: "hidden",
            }}>
              {/* Handle */}
              <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 2 }}>
                <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: theme.border }} />
              </View>

              <ScrollView
                automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 22,
                  paddingTop: 14,
                  paddingBottom: insets.bottom + 28,
                  gap: 18,
                }}
              >
                {/* Título */}
                <View>
                  <MvText variant="semi1" style={{ fontSize: 17 }}>Novo horário disponível</MvText>
                  <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
                    {WEEKDAY_FULL_PT[selectedWeekday]}
                  </MvText>
                </View>

                {/* Campos de hora */}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <MvText variant="body4" color="secondary" style={{ marginBottom: 8, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Início
                    </MvText>
                    <TimeWheelPicker
                      value={availStart}
                      onChange={setAvailStart}
                      unavailableTimes={dayAvailabilities.flatMap((a) => expandRangeToQuarterHours(a.startTime, a.endTime))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="body4" color="secondary" style={{ marginBottom: 8, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Fim
                    </MvText>
                    <TimeWheelPicker
                      value={availEnd}
                      onChange={setAvailEnd}
                      unavailableTimes={dayAvailabilities.flatMap((a) => expandRangeToQuarterHours(a.startTime, a.endTime))}
                    />
                  </View>
                </View>

                {/* Dias adicionais */}
                <View>
                  <MvText variant="body4" color="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
                    Replicar também em:
                  </MvText>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {WEEKDAY_ABBR_PT.map((label, dayId) => {
                      if (dayId === selectedWeekday) return null;
                      const isSelected = availExtraDays.has(dayId);
                      return (
                        <TouchableOpacity
                          key={dayId}
                          onPress={() => toggleAvailExtraDay(dayId)}
                          activeOpacity={0.75}
                          style={{
                            paddingHorizontal: 14,
                            paddingVertical: 7,
                            borderRadius: 20,
                            borderWidth: 1,
                            borderColor: isSelected ? theme.textGreen : theme.border,
                            backgroundColor: isSelected ? theme.primarySubtle : theme.chipBg,
                          }}
                        >
                          <MvText variant="semi3" style={{
                            color: isSelected ? theme.textGreen : theme.text2,
                            fontSize: 13,
                          }}>
                            {label}
                          </MvText>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Botões */}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => { setAvailModalVisible(false); setAvailExtraDays(new Set()); }}
                    style={{
                      flex: 1,
                      paddingVertical: 13,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme.border,
                      alignItems: "center",
                    }}
                  >
                    <MvText variant="semi3" color="secondary">Cancelar</MvText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => void addAvailSlot()}
                    disabled={availAddSaving}
                    activeOpacity={0.85}
                    style={{
                      flex: 2,
                      paddingVertical: 13,
                      borderRadius: 12,
                      backgroundColor: availAddSaving ? "rgba(34,197,94,0.5)" : theme.primary,
                      alignItems: "center",
                      justifyContent: "center",
                      flexDirection: "row",
                      gap: 8,
                    }}
                  >
                    {availAddSaving ? (
                      <Ionicons name="sync-outline" size={15} color="#fff" />
                    ) : (
                      <Ionicons name="checkmark" size={15} color="#fff" />
                    )}
                    <MvText variant="semi3" style={{ color: "#fff" }}>
                      {availExtraDays.size > 0 ? `Salvar em ${availExtraDays.size + 1} dias` : "Salvar horário"}
                    </MvText>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}




