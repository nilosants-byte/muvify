import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FriendsListScreen } from "../screens/client/FriendsListScreen";
import { communityApi, CommunityUser } from "../services/api/client";
import { useAppState } from "../state/AppState";

// Frente 11 (engenharia mobile), Lote 12: lista de amigos virou FlatList
// (virtualização real — antes era ScrollView + friends.map() sem limite).

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function buildFriend(overrides: Partial<CommunityUser>): CommunityUser {
  return {
    id: "friend-1",
    name: "Ana Silva",
    apelido: null,
    photoUrl: null,
    isFollowing: true,
    ...overrides
  } as CommunityUser;
}

describe("Frente 11, Lote 12 — FriendsListScreen", () => {
  beforeEach(() => {
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth: jest.fn(async (operation: (token: string) => Promise<unknown>) => operation("token-test"))
    });
  });

  it("carrega e lista amigos", async () => {
    const ana = buildFriend({ id: "friend-ana", name: "Ana Silva" });
    const bruno = buildFriend({ id: "friend-bruno", name: "Bruno Costa" });
    jest.spyOn(communityApi, "getFollowing").mockResolvedValue({ items: [ana, bruno], total: 2, page: 1, totalPages: 1 });

    const ui = renderWithQueryClient(
      <FriendsListScreen navigation={{ goBack: jest.fn() } as any} route={{} as any} />
    );

    await waitFor(() => expect(ui.getByText("Ana Silva")).toBeTruthy());
    expect(ui.getByText("Bruno Costa")).toBeTruthy();
    expect(ui.getByText("2 pessoas seguidas")).toBeTruthy();
  });

  it("deixar de seguir remove o amigo da lista", async () => {
    const ana = buildFriend({ id: "friend-ana", name: "Ana Silva" });
    jest.spyOn(communityApi, "getFollowing").mockResolvedValue({ items: [ana], total: 1, page: 1, totalPages: 1 });
    const unfollowSpy = jest.spyOn(communityApi, "unfollow").mockResolvedValue(undefined);

    const ui = renderWithQueryClient(
      <FriendsListScreen navigation={{ goBack: jest.fn() } as any} route={{} as any} />
    );

    await waitFor(() => expect(ui.getByText("Ana Silva")).toBeTruthy());
    fireEvent.press(ui.getByText("Deixar de seguir"));

    await waitFor(() => expect(unfollowSpy).toHaveBeenCalledWith("token-test", "friend-ana"));
    await waitFor(() => expect(ui.queryByText("Ana Silva")).toBeNull());
  });

  it("sem amigos: mostra estado vazio", async () => {
    jest.spyOn(communityApi, "getFollowing").mockResolvedValue({ items: [], total: 0, page: 1, totalPages: 0 });

    const ui = renderWithQueryClient(
      <FriendsListScreen navigation={{ goBack: jest.fn() } as any} route={{} as any} />
    );

    await waitFor(() => expect(ui.getByText("Você ainda não segue ninguém")).toBeTruthy());
  });
});
