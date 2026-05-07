import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { ClientTabParamList } from "./route-types";
import { CategoriesScreen } from "../screens/client/CategoriesScreen";
import { ClientBookingsScreen } from "../screens/client/ClientBookingsScreen";
import { ClientHomeScreen } from "../screens/client/ClientHomeScreen";
import { ClientProfileScreen } from "../screens/client/ClientProfileScreen";
import { FavoritesScreen } from "../screens/client/FavoritesScreen";
import { MyTrainingScreen } from "../screens/client/MyTrainingScreen";
import { PromotionsScreen } from "../screens/client/PromotionsScreen";

const Tab = createBottomTabNavigator<ClientTabParamList>();

export function ClientTabsNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: "none" },
      }}
    >
      <Tab.Screen component={ClientHomeScreen} name="ClientHome" options={{ title: "Início" }} />
      <Tab.Screen component={CategoriesScreen} name="Categories" options={{ title: "Categorias" }} />
      <Tab.Screen component={PromotionsScreen} name="Promotions" options={{ title: "Promoções" }} />
      <Tab.Screen component={MyTrainingScreen} name="MyTraining" options={{ title: "Seu Treino" }} />
      <Tab.Screen component={ClientBookingsScreen} name="ClientBookings" options={{ title: "Agenda" }} />
      <Tab.Screen component={FavoritesScreen} name="Favorites" options={{ title: "Favoritos" }} />
      <Tab.Screen component={ClientProfileScreen} name="ClientProfile" options={{ title: "Perfil" }} />
    </Tab.Navigator>
  );
}
