import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StatusBar, TextInput, TouchableOpacity, View } from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ClientTabParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { bookingsApi, consultancyApi, userApi } from "../../services/api/client";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvBadge, MvBottomNav, MvButton, MvCard, MvText } from "../../components/mv";

type Props = BottomTabScreenProps<ClientTabParamList, "ClientProfile">;

type ProfileStats = {
  totalBookings: number;
  upcomingBookings: number;
  activeContracts: number;
  deliveredContracts: number;
};

const initialStats: ProfileStats = {
  totalBookings: 0,
  upcomingBookings: 0,
  activeContracts: 0,
  deliveredContracts: 0,
};

export function ClientProfileScreen({ navigation }: Props) {
  const { runWithAuth, setCurrentUser, user, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const iconColor = theme.mode === "dark" ? "#D8E0D8" : "#394239";

  const [photoUri, setPhotoUri] = useState<string | null>(user?.photoUrl ?? null);
  const [displayName, setDisplayName] = useState(user?.name ?? "Aluno");
  const [editingName, setEditingName] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [stats, setStats] = useState<ProfileStats>(initialStats);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    setPhotoUri(user?.photoUrl ?? null);
  }, [user?.photoUrl]);

  useEffect(() => {
    if (!editingName) {
      setDisplayName(user?.name ?? "Aluno");
    }
  }, [editingName, user?.name]);

  const initials = useMemo(() => {
    const parts = (user?.name ?? "A").trim().split(/\s+/);
    return parts.length === 1
      ? (parts[0]?.slice(0, 2) ?? "AL").toUpperCase()
      : `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }, [user?.name]);

  const hasPhoto = Boolean(photoUri);
  const hasName = Boolean((user?.name ?? "").trim());
  const profileScore = Number(hasPhoto) + Number(hasName);

  const goToStack = (screen: string) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate(screen);
  };

  const loadStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const [bookingData, trainingData] = await Promise.all([
        runWithAuth((token) => bookingsApi.me(token)).catch(() => []),
        runWithAuth((token) => consultancyApi.myTraining(token)).catch(() => null),
      ]);

      const upcomingBookings = (bookingData ?? []).filter(
        (item: any) => item.status === "PENDING" || item.status === "CONFIRMED"
      ).length;

      const contracts = trainingData?.contracts ?? [];
      const activeContracts = contracts.filter(
        (item: any) => item.status === "ACTIVE" || item.status === "PENDING_PAYMENT"
      ).length;
      const deliveredContracts = contracts.filter((item: any) => item.status === "DELIVERED").length;

      setStats({
        totalBookings: (bookingData ?? []).length,
        upcomingBookings,
        activeContracts,
        deliveredContracts,
      });
    } finally {
      setStatsLoading(false);
    }
  }, [runWithAuth]);

  useFocusEffect(
    useCallback(() => {
      void loadStats();
      return undefined;
    }, [loadStats])
  );

  const beginNameEdit = useCallback(() => {
    if (nameSaving) return;
    setEditingName(true);
  }, [nameSaving]);

  const saveNameIfNeeded = useCallback(async () => {
    const trimmed = displayName.trim();
    const current = (user?.name ?? "Aluno").trim();

    if (!trimmed) {
      showToast("O nome não pode ficar vazio.", "error");
      setDisplayName(current);
      setEditingName(false);
      return;
    }
    if (trimmed === current) {
      setEditingName(false);
      return;
    }

    try {
      setNameSaving(true);
      const updated = await runWithAuth((token) => userApi.updateMe(token, { name: trimmed }));
      setCurrentUser(updated);
      setDisplayName(updated.name?.trim() || trimmed);
      showToast("Nome atualizado com sucesso.", "success");
    } catch {
      showToast("Falha ao atualizar nome.", "error");
      setDisplayName(current);
    } finally {
      setNameSaving(false);
      setEditingName(false);
    }
  }, [displayName, runWithAuth, setCurrentUser, showToast, user?.name]);

  const pickPhoto = useCallback(
    async (fromCamera: boolean) => {
      try {
        let result: ImagePicker.ImagePickerResult;
        if (fromCamera) {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") {
            showToast("Permissão para câmera não concedida.", "error");
            return;
          }
          result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.6, base64: true });
        } else {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            showToast("Permissão para galeria não concedida.", "error");
            return;
          }
          result = await ImagePicker.launchImageLibraryAsync({
            allowsEditing: true,
            quality: 0.6,
            base64: true,
          });
        }
        if (result.canceled) return;
        const asset = result.assets?.[0];
        if (!asset?.uri) return;

        let dataUri: string;
        if (asset.base64) {
          const mimeType = asset.mimeType ?? "image/jpeg";
          dataUri = `data:${mimeType};base64,${asset.base64}`;
        } else {
          const response = await fetch(asset.uri);
          const blob = await response.blob();
          dataUri = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }

        setPhotoUri(asset.uri);
        const updated = await runWithAuth((token) => userApi.updateMe(token, { photoUrl: dataUri }));
        setCurrentUser(updated);
        showToast("Foto atualizada.", "success");
      } catch {
        showToast("Falha ao selecionar foto.", "error");
      }
    },
    [runWithAuth, setCurrentUser, showToast]
  );

  const openPhotoSheet = useCallback(() => {
    Alert.alert("Foto de perfil", "Escolha uma opção", [
      { text: "Câmera", onPress: () => void pickPhoto(true) },
      { text: "Galeria", onPress: () => void pickPhoto(false) },
      ...(photoUri
        ? [
            {
              text: "Remover foto",
              style: "destructive" as const,
              onPress: async () => {
                try {
                  setPhotoUri(null);
                  const updated = await runWithAuth((token) => userApi.updateMe(token, { photoUrl: "" }));
                  setCurrentUser(updated);
                } catch {
                  showToast("Falha ao remover foto.", "error");
                }
              },
            },
          ]
        : []),
      { text: "Cancelar", style: "cancel" },
    ]);
  }, [photoUri, pickPhoto, runWithAuth, setCurrentUser, showToast]);

  const quickActions = [
    {
      key: "anamnesis",
      icon: "clipboard-outline" as const,
      title: "Anamnese",
      subtitle: "Saúde, rotina e objetivos",
      onPress: () => goToStack("ClientAnamnesis"),
    },
    {
      key: "payment",
      icon: "card-outline" as const,
      title: "Pagamento",
      subtitle: "Cartão, débito e PIX",
      onPress: () => goToStack("ClientPaymentMethod"),
    },
    {
      key: "favorites",
      icon: "heart-outline" as const,
      title: "Favoritos",
      subtitle: "Profissionais salvos",
      onPress: () => navigation.navigate("Favorites"),
    },
    {
      key: "settings",
      icon: "settings-outline" as const,
      title: "Configurações",
      subtitle: "Conta, privacidade e acesso",
      onPress: () => goToStack("ClientSettings"),
    },
  ];

  const navItems = [
    { key: "home", icon: "compass-outline", label: "Início" },
    { key: "bookings", icon: "calendar-clear-outline", label: "Agenda" },
    { key: "promotions", icon: "flash-outline", label: "Promoções" },
    { key: "training", icon: "barbell-outline", label: "Treino" },
    { key: "profile", icon: "person-circle-outline", label: "Perfil" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.profile">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 14,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: theme.borderSub,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.navigate("ClientHome")}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <MvText variant="semi1">Perfil</MvText>
          <MvText variant="body4" color="secondary">
            Gerencie seus dados e acompanhe sua jornada no app.
          </MvText>
        </View>
        <MvBadge label="Aluno" variant="green" />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 90, paddingHorizontal: 16, gap: 10 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <MvCard style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <TouchableOpacity onPress={openPhotoSheet} activeOpacity={0.8}>
              <View>
                <View
                  style={{
                    width: 84,
                    height: 84,
                    borderRadius: 42,
                    overflow: "hidden",
                    borderWidth: 2.5,
                    borderColor: "rgba(76,175,80,0.40)",
                  }}
                >
                  <MvAvatar initials={initials} size={84} borderRadius={42} color="green" photoUri={photoUri} />
                </View>
                <View
                  style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: "#4CAF50",
                    borderWidth: 2,
                    borderColor: theme.bg,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="camera-outline" size={13} color="#fff" />
                </View>
              </View>
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <MvText variant="caption" color="secondary">
                Conta Muvify
              </MvText>
              {editingName ? (
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  onBlur={() => {
                    void saveNameIfNeeded();
                  }}
                  onSubmitEditing={() => {
                    void saveNameIfNeeded();
                  }}
                  autoFocus
                  returnKeyType="done"
                  editable={!nameSaving}
                  style={{
                    color: theme.inputText,
                    fontSize: 22,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.border,
                    paddingVertical: 4,
                    marginTop: 2,
                  }}
                />
              ) : (
                <TouchableOpacity onPress={beginNameEdit} disabled={nameSaving} activeOpacity={0.8}>
                  <MvText variant="h3" style={{ marginTop: 2 }}>
                    {displayName}
                  </MvText>
                </TouchableOpacity>
              )}
              <MvText variant="body4" color="secondary" numberOfLines={1}>
                {user?.email}
              </MvText>
            </View>
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: profileScore === 2 ? "rgba(76,175,80,0.32)" : theme.border,
              borderRadius: 10,
              backgroundColor: theme.inputBg,
              padding: 10,
              gap: 3,
            }}
          >
            <MvText variant="caption" color="secondary">
              Status do perfil
            </MvText>
            <MvText variant="semi3">
              {profileScore === 2
                ? "Perfil completo. Sua conta esta pronta para aproveitar o melhor da Muvify."
                : "Adicione nome e foto para deixar seu perfil mais confiavel e completo."}
            </MvText>
          </View>

          <MvButton variant="outline" label="Atualizar foto" onPress={openPhotoSheet} />
        </MvCard>

        <MvCard style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <MvText variant="semi2">Panorama da conta</MvText>
            <MvText variant="caption" color="secondary">
              {statsLoading ? "Atualizando..." : "Atualizado"}
            </MvText>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[
              { label: "Agendamentos", value: stats.totalBookings },
              { label: "Próximos", value: stats.upcomingBookings },
              { label: "Treinos ativos", value: stats.activeContracts },
              { label: "Treinos entregues", value: stats.deliveredContracts },
            ].map((item) => (
              <View
                key={item.label}
                style={{
                  flexBasis: "48%",
                  flexGrow: 1,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 10,
                  padding: 9,
                  backgroundColor: theme.inputBg,
                }}
              >
                <MvText variant="h3" style={{ color: theme.textGreen }}>
                  {item.value}
                </MvText>
                <MvText variant="caption" color="secondary">
                  {item.label}
                </MvText>
              </View>
            ))}
          </View>
        </MvCard>

        <MvCard style={{ gap: 8 }}>
          <MvText variant="semi2">Acoes rapidas</MvText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {quickActions.map((item) => (
              <TouchableOpacity
                key={item.key}
                activeOpacity={0.85}
                onPress={item.onPress}
                style={{
                  flexBasis: "48%",
                  flexGrow: 1,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 10,
                  padding: 10,
                  backgroundColor: theme.inputBg,
                  gap: 4,
                }}
              >
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: theme.backBtn,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={item.icon} size={15} color={iconColor} />
                </View>
                <MvText variant="semi3">{item.title}</MvText>
                <MvText variant="caption" color="secondary">
                  {item.subtitle}
                </MvText>
              </TouchableOpacity>
            ))}
          </View>
        </MvCard>

        <MvCard>
          <MvText variant="semi3">Privacidade e seguranca</MvText>
          <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
            Seus dados de saúde, pagamento e treino são protegidos dentro da plataforma.
          </MvText>
        </MvCard>
      </ScrollView>

      <MvBottomNav
        items={navItems}
        activeKey="profile"
        onPress={(key) => {
          if (key === "home") navigation.navigate("ClientHome");
          if (key === "bookings") navigation.navigate("ClientBookings");
          if (key === "promotions") navigation.navigate("Promotions");
          if (key === "training") navigation.navigate("MyTraining");
        }}
      />
    </View>
  );
}
