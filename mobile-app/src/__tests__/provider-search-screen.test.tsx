import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ProviderSearchScreen } from "../screens/Screens";
import { providersApi } from "../services/api/client";

describe("ProviderSearchScreen", () => {
  it("busca profissionais com filtros de nome e nota", async () => {
    const listSpy = jest.spyOn(providersApi, "list").mockResolvedValue([
      {
        id: "p1",
        displayName: "Joao Trainer",
        bio: "Treino funcional",
        experienceYears: 4,
        priceCents: 15000,
        avgRating: 4.9,
        reviewCount: 22
      }
    ]);

    const navigation = { navigate: jest.fn() };
    const { getByPlaceholderText, findByRole, findByText } = render(
      <ProviderSearchScreen navigation={navigation} />
    );

    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    fireEvent.changeText(getByPlaceholderText("Ex: funcional, pilates, joao"), "joao");
    fireEvent.changeText(getByPlaceholderText("Ex: 4"), "4");
    fireEvent.press(await findByRole("button", { name: "Atualizar busca" }));

    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith({
        q: "joao",
        minRating: 4
      })
    );
    expect(await findByText("Joao Trainer")).toBeTruthy();
  }, 20000);
});
