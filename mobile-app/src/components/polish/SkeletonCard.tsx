import React, { useEffect } from "react";
import { View, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useMvTheme } from "../../theme/MvThemeContext";
import { S } from "../../theme/v2tokens";

function SkeletonLine({
  width,
  height = 12,
  style,
}: {
  width: number | `${number}%`;
  height?: number;
  style?: ViewStyle;
}) {
  const shimmerOpacity = useSharedValue(0.3);

  useEffect(() => {
    shimmerOpacity.value = withRepeat(
      withTiming(0.7, { duration: 800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
  }, []);

  const { isDark } = useMvTheme();
  const shimmerColor = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const animStyle = useAnimatedStyle(() => ({ opacity: shimmerOpacity.value }));

  return (
    <Animated.View
      style={[{ width, height, borderRadius: 6, backgroundColor: shimmerColor }, style, animStyle]}
    />
  );
}

// Cleanup pós-épico segunda camada (2026-08-14): SkeletonCard e
// SkeletonStudentCard compartilhavam o container (borda/fundo/padding) e o
// avatar 46px, divergindo só no conteúdo à direita (Frente 10, Lote 18,
// tinha achado isso e deixado como comentário sem ação por ser "baixa
// prioridade") — extraído pro wrapper comum abaixo. API pública das duas
// funções não muda, só o corpo interno.
function SkeletonCardShell({
  style,
  headerRight,
  footer,
}: {
  style?: ViewStyle;
  headerRight: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { theme } = useMvTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.cardBg,
          borderRadius: S.cardR,
          borderWidth: 1,
          borderColor: theme.border,
          padding: S.cardPad,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 23,
            backgroundColor: theme.inputBg,
            flexShrink: 0,
          }}
        />
        {headerRight}
      </View>
      {footer}
    </View>
  );
}

// Card de skeleton completo — mesmo tamanho e forma dos cards reais da CommunityScreen/OffersScreen
export function SkeletonCard({ style }: { style?: ViewStyle }) {
  return (
    <SkeletonCardShell
      style={style}
      headerRight={
        <View style={{ flex: 1, gap: 8 }}>
          <SkeletonLine width="60%" height={14} />
          <SkeletonLine width="40%" height={11} />
        </View>
      }
      footer={
        <View style={{ marginTop: 12, gap: 6 }}>
          <SkeletonLine width="100%" height={11} />
          <SkeletonLine width="75%" height={11} />
        </View>
      }
    />
  );
}

// Variante para cards de alunos (avatar 46px + nome + email + serviço + badge direita)
export function SkeletonStudentCard({ style }: { style?: ViewStyle }) {
  return (
    <SkeletonCardShell
      style={style}
      headerRight={
        <>
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonLine width="55%" height={14} />
            <SkeletonLine width="70%" height={11} />
            <SkeletonLine width="45%" height={11} />
          </View>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <SkeletonLine width={48} height={20} style={{ borderRadius: 10 }} />
            <SkeletonLine width={32} height={11} />
          </View>
        </>
      }
    />
  );
}

// Variante para itens de lista de chat (avatar 52px + nome + timestamp + prévia da mensagem)
export function SkeletonChatItem({ style }: { style?: ViewStyle }) {
  const { theme } = useMvTheme();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: theme.inputBg,
          flexShrink: 0,
        }}
      />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <SkeletonLine width="45%" height={14} />
          <SkeletonLine width={36} height={11} />
        </View>
        <SkeletonLine width="75%" height={11} />
      </View>
    </View>
  );
}

// Variante menor para itens de ranking
export function SkeletonRankingItem({ style }: { style?: ViewStyle }) {
  const { theme } = useMvTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.cardBg,
          borderRadius: S.cardR,
          borderWidth: 1,
          borderColor: theme.border,
          padding: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        },
        style,
      ]}
    >
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.inputBg }} />
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.inputBg }} />
      <View style={{ flex: 1, gap: 6 }}>
        <SkeletonLine width="55%" height={13} />
        <SkeletonLine width="35%" height={10} />
      </View>
    </View>
  );
}

// ─── Primitivo genérico ───────────────────────────────────────────────────────
export function SkeletonShimmer({
  width,
  height,
  borderRadius = 8,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}) {
  return <SkeletonLine width={width} height={height} style={{ borderRadius, ...style }} />;
}

// ─── Skeleton da HomeScreen ───────────────────────────────────────────────────
export function SkeletonHomeScreen() {
  const { theme } = useMvTheme();
  const cardStyle: ViewStyle = {
    backgroundColor: theme.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
  };
  return (
    <View style={{ gap: 14, paddingHorizontal: 16, paddingTop: 4 }}>
      {/* Próxima sessão */}
      <View style={[cardStyle, { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: theme.primarySubtle, borderColor: theme.primarySubtle }]}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.primarySubtleBorder }} />
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.inputBg }} />
        <View style={{ flex: 1, gap: 6 }}>
          <SkeletonLine width="50%" height={13} />
          <SkeletonLine width="35%" height={10} />
        </View>
        <SkeletonLine width={60} height={20} style={{ borderRadius: 10 }} />
      </View>

      {/* Agenda de hoje */}
      <View style={[cardStyle, { gap: 10 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: theme.primarySubtle }} />
          <View style={{ flex: 1, gap: 5 }}>
            <SkeletonLine width="40%" height={13} />
            <SkeletonLine width="28%" height={10} />
          </View>
        </View>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, backgroundColor: theme.inputBg, borderWidth: 1, borderColor: theme.border }}>
            <SkeletonLine width={44} height={13} style={{ borderRadius: 6 }} />
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.cardBg }} />
            <SkeletonLine width="45%" height={13} style={{ flex: 1 }} />
            <SkeletonLine width={52} height={20} style={{ borderRadius: 10 }} />
          </View>
        ))}
      </View>

      {/* Atalhos rápidos */}
      <View style={{ gap: 8 }}>
        <SkeletonLine width="30%" height={14} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ flex: 1, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, paddingVertical: 14, alignItems: "center", gap: 8 }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: theme.primarySubtle }} />
              <SkeletonLine width="70%" height={10} />
            </View>
          ))}
        </View>
      </View>

      {/* Receita semanal */}
      <View style={[cardStyle, { gap: 8 }]}>
        <SkeletonLine width="35%" height={10} />
        <SkeletonLine width="55%" height={28} style={{ marginTop: 2 }} />
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10, marginTop: 8 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <View key={i} style={{ alignItems: "center", gap: 4 }}>
              <SkeletonLine width={18} height={Math.max(12, [24, 36, 20, 44, 30, 16, 52][i] ?? 24)} style={{ borderRadius: 5 }} />
              <SkeletonLine width={12} height={10} />
            </View>
          ))}
        </View>
      </View>

      {/* Grid de métricas */}
      <View style={{ flexDirection: "row", gap: 12 }}>
        {[0, 1].map((i) => (
          <View key={i} style={[cardStyle, { flex: 1, gap: 6 }]}>
            <SkeletonLine width="55%" height={24} style={{ borderRadius: 6 }} />
            <SkeletonLine width="70%" height={11} />
          </View>
        ))}
      </View>
    </View>
  );
}

// Frente 10 (segunda camada), Lote 1: ClientHomeScreen não tinha nenhum
// estado de loading - a tela mostrava "Nenhum treino agendado" por um
// instante em todo cold start, mesmo quando o cliente tem sessão marcada
// (bookingsQuery.data começa undefined). Layout mais simples que
// SkeletonHomeScreen (que é do profissional - agenda/receita não fazem
// sentido pro lado cliente).
export function SkeletonClientHomeScreen() {
  const { theme } = useMvTheme();
  const cardStyle: ViewStyle = {
    backgroundColor: theme.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
  };
  return (
    <View style={{ gap: 14, paddingHorizontal: 16, paddingTop: 8 }}>
      {/* Próxima sessão / estado vazio */}
      <View style={[cardStyle, { gap: 8 }]}>
        <SkeletonLine width="60%" height={10} />
        <SkeletonLine width="70%" height={20} />
        <SkeletonLine width="45%" height={13} />
      </View>

      {/* Explorar por especialidade */}
      <View style={{ gap: 10 }}>
        <SkeletonLine width="45%" height={16} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ flex: 1, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, paddingVertical: 14, alignItems: "center", gap: 8 }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: theme.primarySubtle }} />
              <SkeletonLine width="70%" height={10} />
            </View>
          ))}
        </View>
      </View>

      {/* Card de promoção/destaque */}
      <View style={[cardStyle, { gap: 8 }]}>
        <SkeletonLine width="40%" height={10} />
        <SkeletonLine width="80%" height={18} />
        <SkeletonLine width="90%" height={12} />
      </View>
    </View>
  );
}

// ─── Skeleton do card de agendamento (ConfirmCompletion) ──────────────────────
export function SkeletonBookingCard() {
  const { theme } = useMvTheme();
  return (
    <View style={{ backgroundColor: theme.cardBg, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16, gap: 8 }}>
      <SkeletonLine width="60%" height={14} />
      <SkeletonLine width="40%" height={11} />
      <SkeletonLine width="52%" height={11} />
      <SkeletonLine width="36%" height={11} />
    </View>
  );
}

// ─── Skeleton de lista de agendamentos (AgendaScreen) ────────────────────────
export function SkeletonAgendaList() {
  const { theme } = useMvTheme();
  const row: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: theme.cardBg,
    borderWidth: 1,
    borderColor: theme.border,
  };
  return (
    <View style={{ gap: 10, paddingHorizontal: 16, paddingTop: 8 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={row}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.inputBg }} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonLine width="55%" height={13} />
            <SkeletonLine width="38%" height={10} />
          </View>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <SkeletonLine width={60} height={20} style={{ borderRadius: 10 }} />
            <SkeletonLine width={32} height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Skeleton do detalhe de agendamento (ClientBookingDetailScreen) ──────────
export function SkeletonBookingDetail() {
  const { theme } = useMvTheme();
  return (
    <View style={{ gap: 14, paddingHorizontal: 16, paddingTop: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.inputBg, flexShrink: 0 }} />
        <View style={{ flex: 1, gap: 8 }}>
          <SkeletonLine width="55%" height={16} />
          <SkeletonLine width="35%" height={12} />
        </View>
        <SkeletonLine width={72} height={24} style={{ borderRadius: 10 }} />
      </View>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ borderRadius: 14, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 8 }}>
          <SkeletonLine width="40%" height={11} />
          <SkeletonLine width="65%" height={14} />
        </View>
      ))}
    </View>
  );
}

// ─── Skeleton de aba financeira (FinanceScreen) ───────────────────────────────
export function SkeletonFinanceTab() {
  const { theme } = useMvTheme();
  const row: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  };
  return (
    <View>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={row}>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.inputBg }} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonLine width="50%" height={13} />
            <SkeletonLine width="35%" height={10} />
          </View>
          <SkeletonLine width={56} height={13} />
        </View>
      ))}
    </View>
  );
}

// Frente 10 (segunda camada), Lote 13: FinancialGoalsScreen mostra barras de
// progresso dentro de um card (GoalBar), não uma lista de linhas — usar
// SkeletonFinanceTab aqui ficaria com o formato errado pro conteúdo real.
export function SkeletonGoalsTab() {
  const { theme } = useMvTheme();
  return (
    <View style={{ padding: 16 }}>
      <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 16 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ marginBottom: i < 2 ? 20 : 0 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
              <SkeletonLine width="40%" height={14} />
              <SkeletonLine width={30} height={12} />
            </View>
            <SkeletonLine width="100%" height={10} style={{ borderRadius: 5 }} />
          </View>
        ))}
      </View>
    </View>
  );
}
