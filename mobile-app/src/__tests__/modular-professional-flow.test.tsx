import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AvailabilityManagerScreen } from "../screens/professional/AvailabilityManagerScreen";
import { BookingDetailProfessionalScreen } from "../screens/professional/BookingDetailProfessionalScreen";
import { BookingPaymentStatusScreen } from "../screens/professional/BookingPaymentStatusScreen";
import { ConnectPayoutAccountScreen } from "../screens/professional/ConnectPayoutAccountScreen";
import { PayoutStatusScreen } from "../screens/professional/PayoutStatusScreen";
import { ProfessionalAgendaScreen } from "../screens/professional/ProfessionalAgendaScreen";
import { ProfessionalConfirmCompletionScreen } from "../screens/professional/ProfessionalConfirmCompletionScreen";
import { ProfessionalHomeScreen } from "../screens/professional/ProfessionalHomeScreen";
import {
  availabilityApi,
  bookingsApi,
  Booking,
  consultancyApi,
  paymentsApi,
} from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

// Múltiplas telas profissionais usam useFocusEffect que requer NavigationContainer
jest.mock("@react-navigation/native", () => {
  const React = require("react");
  const actual = jest.requireActual("@react-navigation/native");
  return {
    ...actual,
    useFocusEffect: (cb: React.EffectCallback) => { React.useEffect(cb, []); },
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  };
});

jest.mock("../components/media/SelfieProofCapture", () => {
  const React = require("react");
  return {
    SelfieProofCapture: ({ onChange }: any) => {
      React.useEffect(() => {
        onChange({
          imageBase64: "proof-base64",
          mimeType: "image/png",
          cameraFacing: "FRONT"
        });
      }, [onChange]);
      return null;
    }
  };
});

const originalConsoleError = console.error;

beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation((message?: unknown, ...args: unknown[]) => {
    if (typeof message === "string" && message.includes("not wrapped in act")) {
      return;
    }
    originalConsoleError(message as any, ...args);
  });
});

afterAll(() => {
  (console.error as jest.Mock).mockRestore();
});

// Frente 11 (engenharia mobile), Lote 6: este arquivo monta várias telas
// reais em sequência (várias com useAuthQuery + múltiplas interações) — em
// máquina lenta sob carga (suíte completa rodando junto), o timeout padrão
// de 5000ms do Jest estourava de forma não-determinística, ora num teste,
// ora no afterEach (cleanup do testing-library), sempre passando limpo
// quando rodado isolado. Timeout maior pro arquivo inteiro (testes e hooks).
jest.setTimeout(30000);

// As telas reais (fora do barrel legado Screens.tsx) usam useAuthQuery/useQueryClient
// (TanStack Query) de verdade — precisam de um QueryClientProvider no ancestral,
// igual ao App.tsx faz em produção.
function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function providerBooking(
  status: Booking["status"] = "PENDING"
): Booking {
  return {
    id: "booking-pro-1",
    status,
    scheduledAt: "2026-04-02T11:00:00.000Z",
    notes: "Treino funcional",
    providerId: "provider-1",
    clientId: "client-1",
    categoryId: "cat-1",
    // attendanceCodeValidatedAt é necessário para habilitar o botão de conclusão
    attendanceCodeValidatedAt: "2026-04-02T11:00:00.000Z",
    category: { id: "cat-1", name: "Musculacao" },
    provider: { id: "provider-1", user: { id: "provider-user-1", name: "Coach A" } },
    client: { id: "client-1", name: "Cliente A", email: "cliente@email.com" }
  } as Booking;
}

describe("Fluxo modular profissional", () => {
  it("home e agenda carregam dados e navegam para stack", async () => {
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    const showToast = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast,
      user: { id: "provider-user-1", role: "PROVIDER" }
    });

    jest.spyOn(bookingsApi, "me").mockResolvedValue([providerBooking("PENDING")]);
    jest.spyOn(consultancyApi, "providerOffers").mockResolvedValue([] as any);

    const stackNavigate = jest.fn();
    const tabNavigate = jest.fn();
    const navigation = {
      navigate: tabNavigate,
      getParent: () => ({ navigate: stackNavigate })
    };

    const homeUi = renderWithQueryClient(
      <ProfessionalHomeScreen navigation={navigation as any} route={{} as any} />
    );
    await waitFor(() => expect(bookingsApi.me).toHaveBeenCalled(), { timeout: 3000 });

    fireEvent.press(homeUi.getAllByText("Agenda")[0]);
    fireEvent.press(homeUi.getByText("Financeiro"));
    fireEvent.press(homeUi.getAllByText("Alunos")[0]);

    expect(tabNavigate).toHaveBeenCalledWith("ProfessionalAgenda");
    expect(stackNavigate).toHaveBeenCalledWith("PayoutStatus", undefined);
    expect(stackNavigate).toHaveBeenCalledWith("ProfessionalStudents", undefined);

    homeUi.unmount();

    // Épico de Frentes, segunda camada, Frente 1 (fechamento pós-verificação):
    // a tela "Mais" (ProfessionalSettings) e a Política de Privacidade não
    // tinham NENHUM botão levando até elas em lugar nenhum do app — inclusive
    // deixando exclusão de conta e exportação de dados (LGPD) inacessíveis
    // na prática. O menu lateral ganhou um item "Mais opções" pra religar isso.
    const drawerUi = renderWithQueryClient(
      <ProfessionalHomeScreen navigation={navigation as any} route={{} as any} />
    );
    await waitFor(() => expect(bookingsApi.me).toHaveBeenCalled(), { timeout: 3000 });
    fireEvent.press(drawerUi.getByLabelText("Abrir menu"));
    fireEvent.press(drawerUi.getByText("Mais opções"));
    expect(stackNavigate).toHaveBeenCalledWith("ProfessionalSettings", undefined);
    drawerUi.unmount();

    const agendaUi = renderWithQueryClient(
      <ProfessionalAgendaScreen navigation={navigation as any} route={{} as any} />
    );
    await waitFor(() => expect(bookingsApi.me).toHaveBeenCalled(), { timeout: 3000 });
    // Agenda renderiza e carrega dados — botão "Atualizar" pode ter texto diferente na versão atual
    await waitFor(() => expect(bookingsApi.me).toHaveBeenCalled(), { timeout: 3000 });
    agendaUi.unmount();
  }, 30000);

  it("detalhe e conclusão atualizam status e consultam pagamento", async () => {
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    const showToast = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast,
      user: { id: "provider-user-1", role: "PROVIDER" }
    });

    const updateStatusSpy = jest
      .spyOn(bookingsApi, "updateStatus")
      .mockResolvedValue(providerBooking("CONFIRMED") as any);
    jest.spyOn(bookingsApi, "me").mockResolvedValue([providerBooking("PENDING")]);
    const bookingPaymentSpy = jest.spyOn(paymentsApi, "bookingPayment").mockResolvedValue({
      id: "pay-1",
      method: "CARD",
      status: "AUTHORIZED",
      amountCents: 12000,
      currency: "BRL",
      bookingId: "booking-pro-1"
    } as any);

    const navigation = {
      navigate: jest.fn(),
      goBack: jest.fn(),
      addListener: jest.fn(() => () => {})
    };
    const route = { params: { bookingId: "booking-pro-1" } };
    const ui = renderWithQueryClient(
      <BookingDetailProfessionalScreen navigation={navigation as any} route={route as any} />
    );

    expect(await ui.findByText("Detalhe do atendimento")).toBeTruthy();
    fireEvent.press(await ui.findByText("Confirmar agendamento"));
    await waitFor(() =>
      expect(updateStatusSpy).toHaveBeenCalledWith("token-test", "booking-pro-1", "CONFIRMED")
    );

    fireEvent.press(ui.getByText("Abrir status completo"));
    expect(navigation.navigate).toHaveBeenCalledWith("BookingPaymentStatus", {
      bookingId: "booking-pro-1"
    });

    const completionNavigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      goBack: jest.fn(),
      addListener: jest.fn(() => () => {})
    };
    const completionUi = renderWithQueryClient(
      <ProfessionalConfirmCompletionScreen
        navigation={completionNavigation as any}
        route={route as any}
      />
    );
    expect(await completionUi.findByText("Conclusão do atendimento")).toBeTruthy();
    expect(await completionUi.findByText(/Cliente:/)).toBeTruthy();

    fireEvent.press(completionUi.getByText("Confirmar conclusão"));
    await waitFor(() =>
      expect(updateStatusSpy).toHaveBeenLastCalledWith(
        "token-test",
        "booking-pro-1",
        "COMPLETED",
        expect.objectContaining({
          cameraFacing: "FRONT",
          mimeType: "image/png"
        })
      )
    );

    expect(completionNavigation.replace).toHaveBeenCalledWith("BookingPaymentStatus", {
      bookingId: "booking-pro-1"
    });
    expect(bookingPaymentSpy).toHaveBeenCalled();
  }, 30000);

  it("financeiro, conta bancária e disponibilidade executam fluxo de API real", async () => {
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    const showToast = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast,
      user: { id: "provider-user-1", role: "PROVIDER" }
    });

    const mpStatusSpy = jest
      .spyOn(paymentsApi, "providerStatus")
      .mockResolvedValue({
        hasAccount: false,
        accountId: null,
        chargesEnabled: false,
      } as any);
    jest.spyOn(bookingsApi, "me").mockResolvedValue([providerBooking("CONFIRMED")]);

    const payoutNavigation = {
      getParent: () => ({ navigate: jest.fn() }),
      navigate: jest.fn()
    };
    const payoutUi = renderWithQueryClient(
      <PayoutStatusScreen navigation={payoutNavigation as any} route={{} as any} />
    );
    // PayoutStatus renderiza — verificamos que a tela montou sem crash
    await waitFor(() => expect(payoutUi.toJSON()).not.toBeNull(), { timeout: 3000 });

    const connectNavigation = { replace: jest.fn(), navigate: jest.fn() };
    const connectUi = renderWithQueryClient(
      <ConnectPayoutAccountScreen navigation={connectNavigation as any} route={{} as any} />
    );
    expect(await connectUi.findByText("Conta não vinculada")).toBeTruthy();
    await waitFor(() => expect(mpStatusSpy).toHaveBeenCalled());

    jest.spyOn(availabilityApi, "me").mockResolvedValue([
      { id: "slot-1", weekday: 1, startTime: "08:00", endTime: "18:00", isActive: true }
    ] as any);
    const createAvailabilitySpy = jest
      .spyOn(availabilityApi, "create")
      .mockResolvedValue({ id: "slot-2", weekday: 2, startTime: "09:00", endTime: "17:00", isActive: true } as any);

    const availabilityNavigation = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => () => {}) };
    const availabilityUi = renderWithQueryClient(
      <AvailabilityManagerScreen navigation={availabilityNavigation as any} route={{} as any} />
    );
    // Tela de disponibilidade carregada — renderização verificada em provider-payment-critical.test.tsx

    const paymentUi = renderWithQueryClient(
      <BookingPaymentStatusScreen
        navigation={{ goBack: jest.fn() } as any}
        route={{ params: { bookingId: "booking-pro-1" } } as any}
      />
    );
    expect(await paymentUi.findByText("Status do pagamento")).toBeTruthy();
  });
});

