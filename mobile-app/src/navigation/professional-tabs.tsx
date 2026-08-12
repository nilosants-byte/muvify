import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { ProfessionalTabParamList } from "./route-types";
import { NotificationsScreen } from "../screens/shared/NotificationsScreen";
import { PayoutStatusScreen } from "../screens/professional/PayoutStatusScreen";
import { ProfessionalAgendaScreen } from "../screens/professional/ProfessionalAgendaScreen";
import { ProfessionalConsultancyCenterScreen } from "../screens/professional/ProfessionalConsultancyCenterScreen";
import { ProfessionalHomeScreen } from "../screens/professional/ProfessionalHomeScreen";
import { ProfessionalProfileEditorScreen } from "../screens/professional/ProfessionalProfileEditorScreen";
import { withScreenErrorBoundary } from "../components/ErrorBoundary";

const Tab = createBottomTabNavigator<ProfessionalTabParamList>();

// Frente 11 (engenharia mobile), Lote 10: contenção local — upload de foto/
// vídeo de apresentação é uma das áreas de maior risco/custo se um erro de
// render derrubasse a navegação inteira. Definido uma única vez no escopo
// do módulo (não inline no JSX) pra manter a mesma identidade de componente
// entre renders do navigator.
const ProfessionalProfileEditorScreenSafe = withScreenErrorBoundary(ProfessionalProfileEditorScreen, {
  title: "Não foi possível abrir esta tela",
  description: "Algo deu errado ao carregar esta seção. Toque para tentar de novo.",
  retryLabel: "Tentar de novo",
});

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
        component={ProfessionalProfileEditorScreenSafe}
        name="ProfessionalProfileEditor"
        options={{ title: "Perfil" }}
      />
    </Tab.Navigator>
  );
}
