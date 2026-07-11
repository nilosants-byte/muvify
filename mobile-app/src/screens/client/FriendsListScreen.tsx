import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { communityApi, CommunityUser } from "../../services/api/client";
import { MvAvatar } from "../../components/mv";
import { useMvTheme } from "../../theme/MvThemeContext";
import { S, DISPLAY } from "../../theme/v2tokens";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

type Props = NativeStackScreenProps<ClientStackParamList, "FriendsList">;

export function FriendsListScreen({ navigation }: Props) {
  const { runWithAuth } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [friends, setFriends] = useState<CommunityUser[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  // Evita chamadas duplicadas de unfollow em andamento
  const unfollowInFlightRef = useRef<Set<string>>(new Set());
  const [unfollowingIds, setUnfollowingIds] = useState<Set<string>>(new Set());

  const friendsQuery = useAuthQuery(
    queryKeys.community.following(1, 20),
    (token) => communityApi.getFollowing(token, 1, 20)
  );

  const loading = friendsQuery.isLoading;

  useEffect(() => {
    const res = friendsQuery.data;
    if (!res) return;
    setFriends(res.items);
    setTotal(res.total);
    setPage(1);
    setHasMore(res.items.length === 20);
  }, [friendsQuery.data]);

  async function handleUnfollow(userId: string) {
    if (unfollowInFlightRef.current.has(userId)) return;
    unfollowInFlightRef.current.add(userId);
    setUnfollowingIds((prev) => new Set([...prev, userId]));
    try {
      await runWithAuth((token) => communityApi.unfollow(token, userId));
      setFriends((prev) => prev.filter((u) => u.id !== userId));
      setTotal((prev) => Math.max(0, prev - 1));
    } catch {
      // best effort — reverte o estado visual se falhar
      setUnfollowingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    } finally {
      unfollowInFlightRef.current.delete(userId);
      setUnfollowingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await runWithAuth((token) => communityApi.getFollowing(token, nextPage, 20));
      setFriends((prev) => [...prev, ...res.items]);
      setTotal(res.total);
      setPage(nextPage);
      setHasMore(res.items.length === 20);
    } catch {
      // best effort
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <View style={{
        paddingTop: insets.top + 14,
        paddingHorizontal: S.px,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: "rgba(255,255,255,0.07)",
            borderWidth: 1, borderColor: theme.border,
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Ionicons name="arrow-back" size={18} color={theme.text1} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.3 }}>
            Meus amigos
          </Text>
          {!loading && (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginTop: 1 }}>
              {total === 0 ? "Nenhum amigo ainda" : `${total} ${total === 1 ? "pessoa seguida" : "pessoas seguidas"}`}
            </Text>
          )}
        </View>
      </View>

      {/* Conteúdo */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>
            Carregando amigos...
          </Text>
        </View>
      ) : friends.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 }}>
          <View style={{
            width: 64, height: 64, borderRadius: 20,
            backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder,
            alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name="people-outline" size={30} color={theme.primary} />
          </View>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, textAlign: "center" }}>
            Você ainda não segue ninguém
          </Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center", lineHeight: 20 }}>
            Use o botão "Seguir" na tela de Comunidade para encontrar amigos.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: S.px, gap: 10, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          {friends.map((friend) => {
            const followsBack = friend.isFollowing === true;
            const isUnfollowing = unfollowingIds.has(friend.id);

            return (
              <View
                key={friend.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  backgroundColor: theme.cardBg,
                  borderRadius: S.cardR,
                  borderWidth: 1,
                  borderColor: followsBack ? theme.primarySubtleBorder : theme.border,
                  padding: 12,
                  minHeight: S.touchMin,
                }}
              >
                <MvAvatar
                  initials={(friend.name ?? "?").slice(0, 2).toUpperCase()}
                  photoUri={friend.photoUrl ?? null}
                  tone="green"
                  size="sm"
                />

                {/* Nome + apelido + tag */}
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text
                    style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}
                    numberOfLines={1}
                  >
                    {friend.name}
                  </Text>
                  {friend.apelido ? (
                    <Text
                      style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}
                      numberOfLines={1}
                    >
                      @{friend.apelido}
                    </Text>
                  ) : null}
                  {!followsBack && (
                    <View style={{
                      alignSelf: "flex-start",
                      marginTop: 2,
                      backgroundColor: "rgba(255,255,255,0.05)",
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: S.chipR,
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                    }}>
                      <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 10, color: theme.text3 }}>
                        Não segue de volta
                      </Text>
                    </View>
                  )}
                </View>

                {/* Botão deixar de seguir */}
                <TouchableOpacity
                  onPress={() => void handleUnfollow(friend.id)}
                  disabled={isUnfollowing}
                  style={{
                    height: 32,
                    paddingHorizontal: 12,
                    borderRadius: S.chipR,
                    backgroundColor: "rgba(255,255,255,0.05)",
                    borderWidth: 1,
                    borderColor: theme.border,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: isUnfollowing ? 0.5 : 1,
                    flexShrink: 0,
                  }}
                >
                  {isUnfollowing ? (
                    <ActivityIndicator size="small" color={theme.text3} />
                  ) : (
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text2 }}>
                      Deixar de seguir
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}

          {/* Carregar mais */}
          {hasMore && (
            <TouchableOpacity
              onPress={loadMore}
              disabled={loadingMore}
              style={{
                marginTop: 4,
                paddingVertical: 14,
                borderRadius: S.cardR,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.cardBg,
                alignItems: "center",
              }}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>
                  Carregar mais
                </Text>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </View>
  );
}
