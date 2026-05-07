import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
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
  userApi
} from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

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

    const homeUi = render(
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

    const agendaUi = render(
      <ProfessionalAgendaScreen navigation={navigation as any} route={{} as any} />
    );
    await waitFor(() => expect(bookingsApi.me).toHaveBeenCalled(), { timeout: 3000 });
    fireEvent.press(agendaUi.getByText("Atualizar"));
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
      goBack: jest.fn()
    };
    const route = { params: { bookingId: "booking-pro-1" } };
    const ui = render(
      <BookingDetailProfessionalScreen navigation={navigation as any} route={route as any} />
    );

    expect(await ui.findByText("Detalhe do atendimento")).toBeTruthy();
    fireEvent.press(ui.getByText("Confirmar agendamento"));
    await waitFor(() =>
      expect(updateStatusSpy).toHaveBeenCalledWith("token-test", "booking-pro-1", "CONFIRMED")
    );

    fireEvent.press(ui.getByText("Abrir status completo"));
    expect(navigation.navigate).toHaveBeenCalledWith("BookingPaymentStatus", {
      bookingId: "booking-pro-1"
    });

    const completionNavigation = {
      navigate: jest.fn(),
      goBack: jest.fn()
    };
    const completionUi = render(
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

    expect(completionNavigation.navigate).toHaveBeenCalledWith("BookingPaymentStatus", {
      bookingId: "booking-pro-1"
    });
    expect(bookingPaymentSpy).toHaveBeenCalled();
  });

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

    const providerBankSpy = jest
      .spyOn(userApi, "providerBankAccount")
      .mockResolvedValue({
        id: "bank-1",
        providerId: "prov-1",
        bankName: "Banco Demo",
        accountType: "CHECKING",
        agency: "1234",
        accountNumber: "98765",
        accountDigit: "1",
        holderName: "Coach A",
        holderDocument: "12345678900",
        pixKey: "coach@email.com",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z"
      } as any);
    const upsertBankSpy = jest.spyOn(userApi, "upsertProviderBankAccount").mockResolvedValue({
      id: "bank-1"
    } as any);
    jest.spyOn(bookingsApi, "me").mockResolvedValue([providerBooking("CONFIRMED")]);

    const payoutNavigation = {
      getParent: () => ({ navigate: jest.fn() }),
      navigate: jest.fn()
    };
    const payoutUi = render(
      <PayoutStatusScreen navigation={payoutNavigation as any} route={{} as any} />
    );
    expect(await payoutUi.findByText("Financeiro")).toBeTruthy();
    fireEvent.press(payoutUi.getByText("Atualizar"));
    await waitFor(() => expect(providerBankSpy).toHaveBeenCalled());

    const connectNavigation = { replace: jest.fn(), navigate: jest.fn() };
    const connectUi = render(
      <ConnectPayoutAccountScreen navigation={connectNavigation as any} route={{} as any} />
    );
    expect(await connectUi.findByText("Conta bancária")).toBeTruthy();
    expect(await connectUi.findByDisplayValue("Banco Demo")).toBeTruthy();
    fireEvent.press(connectUi.getByText("Salvar conta"));
    await waitFor(() => expect(upsertBankSpy).toHaveBeenCalled());

    jest.spyOn(availabilityApi, "me").mockResolvedValue([
      { id: "slot-1", weekday: 1, startTime: "08:00", endTime: "18:00", isActive: true }
    ] as any);
    const createAvailabilitySpy = jest
      .spyOn(availabilityApi, "create")
      .mockResolvedValue({ id: "slot-2", weekday: 2, startTime: "09:00", endTime: "17:00", isActive: true } as any);

    const availabilityNavigation = { goBack: jest.fn(), navigate: jest.fn() };
    const availabilityUi = render(
      <AvailabilityManagerScreen navigation={availabilityNavigation as any} route={{} as any} />
    );
    expect(await availabilityUi.findByText("Meus Horários")).toBeTruthy();
    // Seleciona o dia Terça (weekday 2) e abre o formulário de adição
    fireEvent.press(availabilityUi.getByText("Ter"));
    fireEvent.press(availabilityUi.getByText("+ Adicionar horário para terça"));
    fireEvent.changeText(availabilityUi.getByDisplayValue("08:00"), "09:00");
    const updatedTimeInputs = availabilityUi.getAllByDisplayValue("09:00");
    fireEvent.changeText(updatedTimeInputs[updatedTimeInputs.length - 1], "17:00");
    fireEvent.press(availabilityUi.getByText("Confirmar"));
    await waitFor(() =>
      expect(createAvailabilitySpy).toHaveBeenCalledWith(
        "token-test",
        expect.objectContaining({
          weekday: 2,
          startTime: "09:00",
          endTime: "17:00"
        })
      )
    );

    const paymentUi = render(
      <BookingPaymentStatusScreen
        navigation={{ goBack: jest.fn() } as any}
        route={{ params: { bookingId: "booking-pro-1" } } as any}
      />
    );
    expect(await paymentUi.findByText("Status do pagamento")).toBeTruthy();
  });
});

