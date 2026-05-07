import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import {
  BookingConfirmationScreen,
  CustomerBookingDetailScreen,
  CustomerBookingsScreen,
  CustomerCompleteConfirmScreen,
  ReviewCreateScreen
} from "../screens/Screens";
import { bookingsApi, reviewsApi } from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

function bookingFixture(status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" = "PENDING") {
  return {
    id: "booking-1",
    status,
    scheduledAt: "2026-04-01T10:00:00.000Z",
    notes: "Treino funcional",
    providerId: "provider-1",
    clientId: "client-1",
    categoryId: "cat-1",
    category: { id: "cat-1", name: "Cat A" },
    provider: { id: "provider-1", displayName: "Pro A", user: { id: "provider-user-1", name: "Pro A" } }
  };
}

describe("Fluxos criticos de agendamento - cliente", () => {
  it("tela de confirmação navega para agendamentos e status de pagamento", () => {
    const navigation = { navigate: jest.fn() };
    const route = { params: { bookingId: "booking-1" } };
    const { getByRole } = render(<BookingConfirmationScreen navigation={navigation} route={route} />);

    fireEvent.press(getByRole("button", { name: "Ver meus agendamentos" }));
    fireEvent.press(getByRole("button", { name: "Ver status do pagamento" }));

    expect(navigation.navigate).toHaveBeenCalledWith("CustomerBookings");
    expect(navigation.navigate).toHaveBeenCalledWith("PaymentStatus", { bookingId: "booking-1" });
  });

  it("lista agendamentos do cliente, aplica filtro e abre detalhe", async () => {
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    const showToast = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast,
      user: { id: "client-1" }
    });

    const meSpy = jest.spyOn(bookingsApi, "me").mockResolvedValue([
      bookingFixture("PENDING"),
      { ...bookingFixture("CONFIRMED"), id: "booking-2", clientId: "other-client" }
    ] as any);

    const navigation = { navigate: jest.fn() };
    const { findByText, getByText, getByRole } = render(
      <CustomerBookingsScreen navigation={navigation} />
    );

    expect(await findByText("Meus agendamentos")).toBeTruthy();
    expect(await findByText(/Cat A/)).toBeTruthy();

    fireEvent.press(getByText("Confirmado"));
    expect(await findByText("Nenhum agendamento neste filtro.")).toBeTruthy();

    fireEvent.press(getByText("Todos"));
    fireEvent.press(getByText(/Cat A/));
    expect(navigation.navigate).toHaveBeenCalledWith("CustomerBookingDetail", {
      bookingId: "booking-1"
    });

    fireEvent.press(getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(meSpy).toHaveBeenCalledTimes(2));
  });

  it("atualiza status no detalhe e abre status de pagamento", async () => {
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    const showToast = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast
    });

    jest.spyOn(bookingsApi, "me").mockResolvedValue([bookingFixture("PENDING")] as any);
    const updateSpy = jest.spyOn(bookingsApi, "updateStatus").mockResolvedValue({
      ...bookingFixture("CONFIRMED")
    } as any);

    const navigation = { navigate: jest.fn() };
    const route = { params: { bookingId: "booking-1" } };
    const { findByText, getByRole } = render(
      <CustomerBookingDetailScreen navigation={navigation} route={route} />
    );

    expect(await findByText("Detalhe do agendamento")).toBeTruthy();

    fireEvent.press(getByRole("button", { name: "Confirmar agendamento" }));
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith("token-test", "booking-1", "CONFIRMED")
    );

    fireEvent.press(getByRole("button", { name: "Cancelar agendamento" }));
    fireEvent.press(await findByText("Sim, cancelar"));
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith("token-test", "booking-1", "CANCELLED")
    );

    fireEvent.press(getByRole("button", { name: "Status do pagamento" }));
    expect(navigation.navigate).toHaveBeenCalledWith("PaymentStatus", { bookingId: "booking-1" });
    expect(showToast).toHaveBeenCalledWith("Status atualizado.", "success");
  }, 20000);

  it("confirma conclusão e envia avaliação", async () => {
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    const showToast = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast
    });

    const updateSpy = jest.spyOn(bookingsApi, "updateStatus").mockResolvedValue({
      ...bookingFixture("COMPLETED")
    } as any);
    const reviewSpy = jest.spyOn(reviewsApi, "create").mockResolvedValue({} as any);

    const confirmNavigation = { replace: jest.fn(), navigate: jest.fn() };
    const confirmRoute = { params: { bookingId: "booking-1" } };

    const confirmUi = render(
      <CustomerCompleteConfirmScreen navigation={confirmNavigation} route={confirmRoute} />
    );

    fireEvent.press(confirmUi.getByRole("button", { name: "Confirmar conclusão" }));
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith("token-test", "booking-1", "COMPLETED")
    );
    expect(confirmNavigation.replace).toHaveBeenCalledWith("ReviewCreate", {
      bookingId: "booking-1"
    });

    const reviewNavigation = { navigate: jest.fn() };
    const reviewRoute = { params: { bookingId: "booking-1" } };
    const reviewUi = render(<ReviewCreateScreen navigation={reviewNavigation} route={reviewRoute} />);

    fireEvent.changeText(reviewUi.getByPlaceholderText("5"), "9");
    fireEvent.press(reviewUi.getByRole("button", { name: "Enviar avaliação" }));
    expect(showToast).toHaveBeenCalledWith("Nota deve ser inteiro entre 1 e 5.", "error");

    fireEvent.changeText(reviewUi.getByPlaceholderText("5"), "5");
    fireEvent.changeText(
      reviewUi.getByPlaceholderText("Como foi sua experiência?"),
      "Excelente atendimento"
    );
    fireEvent.press(reviewUi.getByRole("button", { name: "Enviar avaliação" }));

    await waitFor(() =>
      expect(reviewSpy).toHaveBeenCalledWith(
        "token-test",
        expect.objectContaining({
          bookingId: "booking-1",
          rating: 5,
          comment: "Excelente atendimento"
        })
      )
    );
    expect(reviewNavigation.navigate).toHaveBeenCalledWith("CustomerBookings");
  }, 20000);
});


