import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import {
  CategoriesListScreen,
  CustomerHomeScreen,
  ProviderDetailScreen,
  ProviderListScreen
} from "../screens/Screens";
import {
  categoriesApi,
  favoritesApi,
  providersApi
} from "../services/api/client";
import { useAppState } from "../state/AppState";
import { useConnectivity } from "../state/useConnectivity";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

jest.mock("../state/useConnectivity", () => ({
  useConnectivity: jest.fn()
}));

describe("Fluxos de descoberta - cliente", () => {
  it("carrega home/categorias/lista e navega entre telas", async () => {
    (useConnectivity as jest.Mock).mockReturnValue({ online: true, checking: false, recheckNow: jest.fn() });
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth: jest.fn(async (operation: (token: string) => Promise<unknown>) => operation("token-test")),
      showToast: jest.fn()
    });

    jest.spyOn(categoriesApi, "list").mockResolvedValue([
      { id: "cat-1", name: "Musculacao", description: "Treino de forca" },
      { id: "cat-2", name: "Pilates", description: "Postura" }
    ]);
    jest.spyOn(providersApi, "list").mockResolvedValue([
      {
        id: "provider-1",
        displayName: "Pro A",
        bio: "Especialista",
        experienceYears: 4,
        priceCents: 12000
      }
    ] as any);

    const homeNavigation = { navigate: jest.fn() };
    const home = render(<CustomerHomeScreen navigation={homeNavigation} />);
    expect(await home.findByText("Home Cliente")).toBeTruthy();
    fireEvent.press(home.getByRole("button", { name: "Ver categorias" }));
    fireEvent.press(home.getByRole("button", { name: "Buscar profissionais" }));
    fireEvent.press(home.getByRole("button", { name: "Configurar pagamento" }));
    fireEvent.press(home.getByText("Musculacao"));
    expect(homeNavigation.navigate).toHaveBeenCalledWith("CategoriesList");

    const categoriesNavigation = { navigate: jest.fn() };
    const categories = render(<CategoriesListScreen navigation={categoriesNavigation} />);
    expect(await categories.findByText("Categorias")).toBeTruthy();
    fireEvent.press(categories.getByText("Pilates"));
    expect(categoriesNavigation.navigate).toHaveBeenCalledWith("ProviderList", {
      categoryId: "cat-2",
      categoryName: "Pilates"
    });

    const providerListNavigation = { navigate: jest.fn() };
    const providerListRoute = { params: { categoryId: "cat-1", categoryName: "Musculacao" } };
    const providerList = render(
      <ProviderListScreen navigation={providerListNavigation} route={providerListRoute} />
    );
    expect(await providerList.findByText("Profissionais")).toBeTruthy();
    fireEvent.press(providerList.getByText("Pro A"));
    expect(providerListNavigation.navigate).toHaveBeenCalledWith("ProviderDetail", {
      providerId: "provider-1"
    });
  }, 20000);

  it("carrega detalhe do profissional e permite favoritar/agendar", async () => {
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    const showToast = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast
    });

    jest.spyOn(favoritesApi, "list").mockResolvedValue([] as any);
    const addFavoriteSpy = jest.spyOn(favoritesApi, "add").mockResolvedValue({} as any);
    const removeFavoriteSpy = jest.spyOn(favoritesApi, "remove").mockResolvedValue();
    jest.spyOn(providersApi, "detail").mockResolvedValue({
      id: "provider-1",
      displayName: "Coach Premium",
      bio: "Atendimento personalizado",
      experienceYears: 6,
      priceCents: 18000,
      avgRating: 4.8,
      reviewCount: 40,
      categoryLinks: [{ categoryId: "cat-1", category: { id: "cat-1", name: "Musculacao" } }],
      availabilities: [{ id: "a1", weekday: 2, startTime: "09:00", endTime: "17:00", isActive: true }],
      reviews: [{ id: "r1", rating: 5, comment: "Otimo", createdAt: "2026-03-01T00:00:00.000Z", user: { id: "u1", name: "Ana" } }]
    } as any);

    const navigation = { navigate: jest.fn() };
    const route = { params: { providerId: "provider-1" } };
    const ui = render(<ProviderDetailScreen navigation={navigation} route={route} />);

    expect(await ui.findByText("Coach Premium")).toBeTruthy();
    fireEvent.press(ui.getByRole("button", { name: "Favoritar" }));
    await waitFor(() => expect(addFavoriteSpy).toHaveBeenCalledWith("token-test", "provider-1"));
    expect(showToast).toHaveBeenCalledWith("Adicionado aos favoritos.", "success");

    // Com lista recarregada, o botao pode virar "Remover favorito"
    if (ui.queryByRole("button", { name: "Remover favorito" })) {
      fireEvent.press(ui.getByRole("button", { name: "Remover favorito" }));
      await waitFor(() =>
        expect(removeFavoriteSpy).toHaveBeenCalledWith("token-test", "provider-1")
      );
    }

    fireEvent.press(ui.getByRole("button", { name: "Criar agendamento" }));
    expect(navigation.navigate).toHaveBeenCalledWith("CreateBooking", {
      providerId: "provider-1",
      categoryId: "cat-1"
    });
  }, 25000);
});


