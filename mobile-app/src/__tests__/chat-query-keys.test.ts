import { queryKeys } from "../lib/queryKeys";

// Teste manual C9.1 (21/10/2026): Home travada (lista crua da API) e tela
// de conversas (lista transformada, com id) dividiam a mesma chave de cache
// — a tela lia itens sem id e o React reclamava de key ausente.
describe("chaves de cache das conversas", () => {
  it("tela de conversas não divide a chave com a lista crua", () => {
    expect(queryKeys.chat.myChatsView("client")).not.toEqual(queryKeys.chat.myChats());
    expect(queryKeys.consultancyChat.myChatsView("client")).not.toEqual(queryKeys.consultancyChat.myChats());
    expect(queryKeys.chat.myChatsView("client")).not.toEqual(queryKeys.chat.myChatsView("provider"));
  });

  it("invalidar myChats() continua alcançando a lista da tela (prefixo)", () => {
    const prefix = queryKeys.chat.myChats();
    expect(queryKeys.chat.myChatsView("client").slice(0, prefix.length)).toEqual([...prefix]);
    const cprefix = queryKeys.consultancyChat.myChats();
    expect(queryKeys.consultancyChat.myChatsView("provider").slice(0, cprefix.length)).toEqual([...cprefix]);
  });

  // Teste manual C13.1 (22/10/2026): mesmo problema na central de
  // notificações (tocar antes de carregar quebrava o app) e na tela Treinos
  // x Home travada.
  it("central de notificações e tela Treinos têm chave própria, debaixo da compartilhada", () => {
    const inbox = queryKeys.notifications.inbox(120);
    const screen = queryKeys.notifications.inboxScreen(120);
    expect(screen).not.toEqual(inbox);
    expect(screen.slice(0, inbox.length)).toEqual([...inbox]);
    const mt = queryKeys.consultancy.myTraining();
    const mts = queryKeys.consultancy.myTrainingScreen();
    expect(mts).not.toEqual(mt);
    expect(mts.slice(0, mt.length)).toEqual([...mt]);
  });
});
