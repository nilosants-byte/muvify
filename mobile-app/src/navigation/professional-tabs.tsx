import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { ProfessionalTabParamList } from "./route-types";
import { NotificationsScreen } from "../screens/shared/NotificationsScreen";
import { PayoutStatusScreen } from "../screens/professional/PayoutStatusScreen";
import { ProfessionalAgendaScreen } from "../screens/professional/ProfessionalAgendaScreen";
import { ProfessionalConsultancyCenterScreen } from "../screens/professional/ProfessionalConsultancyCenterScreen";
import { ProfessionalHomeScreen } from "../screens/professional/ProfessionalHomeScreen";
import { ProfessionalProfileEditorScreen } from "../screens/professional/ProfessionalProfileEditorScreen";

const Tab = createBottomTabNavigator<ProfessionalTabParamList>();

export function ProfessionalTabsNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: "none" }
      }}
    >
      <Tab.Screen
        component={ProfessionalHomeScreen}
        name="ProfessionalHome"
        options={{ title: "Início" }}
      />
      <Tab.Screen
        component={ProfessionalAgendaScreen}
        name="ProfessionalAgenda"
        options={{ title: "Agenda" }}
      />
      <Tab.Screen
        component={ProfessionalConsultancyCenterScreen}
        name="ProfessionalConsultancyCenter"
        options={{ title: "Consultoria" }}
      />
      <Tab.Screen
        component={PayoutStatusScreen}
        name="PayoutStatus"
        options={{ title: "Financeiro" }}
      />
      <Tab.Screen
        component={NotificationsScreen}
        name="Notifications"
        options={{ title: "Avisos" }}
      />
      <Tab.Screen
        component={ProfessionalProfileEditorScreen}
        name="ProfessionalProfileEditor"
        options={{ title: "Perfil" }}
      />
    </Tab.Navigator>
  );
}
