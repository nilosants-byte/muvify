import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { CreateBookingScreen } from "../screens/Screens";
import { bookingsApi, categoriesApi, paymentsApi } from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

describe("CreateBookingScreen", () => {
  it("cria agendamento e navega para confirmação", async () => {
    jest.spyOn(categoriesApi, "list").mockResolvedValue([
      { id: "c1", name: "Personal", description: "Treino" }
    ]);
    const customerStatusSpy = jest.spyOn(paymentsApi, "customerStatus").mockResolvedValue({
      configured: true,
      hasCustomer: true,
      hasDefaultPaymentMethod: true
    });

    const createSpy = jest.spyOn(bookingsApi, "create").mockResolvedValue({
      id: "b1",
      status: "PENDING",
      scheduledAt: "2026-03-30T10:30:00.000Z",
      providerId: "provider-1",
      clientId: "client-1",
      categoryId: "c1",
      notes: "Foco em mobilidade"
    });

    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    const showToast = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast
    });

    const navigation = { replace: jest.fn(), navigate: jest.fn() };
    const route = { params: { providerId: "provider-1", categoryId: "c1" } };
    const { getByPlaceholderText, getByRole } = render(
      <CreateBookingScreen navigation={navigation} route={route} />
    );

    fireEvent.changeText(
      getByPlaceholderText("Detalhes para o profissional"),
      "Foco em mobilidade"
    );
    await waitFor(() => expect(customerStatusSpy).toHaveBeenCalledWith("token-test"));
    fireEvent.press(getByRole("button", { name: "Confirmar agendamento" }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        "token-test",
        expect.objectContaining({
          providerId: "provider-1",
          categoryId: "c1",
          notes: "Foco em mobilidade"
        })
      )
    );
    expect(navigation.replace).toHaveBeenCalledWith("BookingConfirmation", {
      bookingId: "b1"
    });
    expect(showToast).toHaveBeenCalledWith("Agendamento criado com sucesso.", "success");
  }, 15000);
});

