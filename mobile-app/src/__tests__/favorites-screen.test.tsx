import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { FavoritesScreen } from "../screens/Screens";
import { favoritesApi, providersApi } from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

describe("FavoritesScreen", () => {
  it("lista favoritos e remove profissional", async () => {
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    const showToast = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast
    });

    jest.spyOn(favoritesApi, "list").mockResolvedValue([
      { id: "fav-1", userId: "u1", providerId: "p1" }
    ]);
    jest.spyOn(providersApi, "detail").mockResolvedValue({
      id: "p1",
      displayName: "Joao Trainer",
      bio: "Treino funcional",
      experienceYears: 4,
      priceCents: 15000,
      avgRating: 4.9,
      reviewCount: 22
    });
    const removeSpy = jest.spyOn(favoritesApi, "remove").mockResolvedValue();

    const navigation = { navigate: jest.fn() };
    const { findByText, findByRole } = render(<FavoritesScreen navigation={navigation} />);

    expect(await findByText("Joao Trainer")).toBeTruthy();
    fireEvent.press(await findByRole("button", { name: "Remover" }));

    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith("token-test", "p1"));
    expect(showToast).toHaveBeenCalledWith("Favorito removido.", "info");
  });
});

