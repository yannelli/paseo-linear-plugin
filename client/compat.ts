import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import * as hostUi from "@getpaseo/plugin/client/ui";
import { type ComponentType, createContext, createElement, useContext } from "react";

// Paseo 0.11 replaced surfaces with screens and sidebar header items. 0.10 only has
// addSurface/addSidebarItem; later releases drop those aliases. Detect once, register once.
type Cleanup = () => void;

interface ScreenRef {
  screenId: string;
}

interface SidebarItemProps {
  currentScreen: ScreenRef | null;
  openScreen(input: ScreenRef): void;
  theme?: PluginSurfaceProps["theme"];
}

interface ScreenClient {
  addScreen(input: {
    id: string;
    title: string;
    Component: ComponentType<PluginSurfaceProps>;
  }): Cleanup;
  addSidebarHeaderItem(input: {
    id: string;
    title: string;
    Component: ComponentType<SidebarItemProps>;
  }): Cleanup;
}

interface SurfaceClient {
  addSurface(id: string, Component: ComponentType<PluginSurfaceProps>): Cleanup;
  addSidebarItem(input: { id: string; title: string; icon: string; surface: string }): Cleanup;
}

interface RowIconProps {
  size: number;
  color: string;
}

type SidebarRowComponent = ComponentType<{
  icon?: string | ComponentType<RowIconProps>;
  label?: string;
  active?: boolean;
  onPress(): void;
}>;

function hasScreens(client: object): client is ScreenClient {
  return "addScreen" in client && typeof client.addScreen === "function";
}

export interface ScreenRegistration {
  id: string;
  title: string;
  icon: string;
  /** Drawn in the sidebar row where the host accepts icon components; else `icon`. */
  RowIcon?: ComponentType<RowIconProps & { theme: PluginSurfaceProps["theme"] | null }>;
  Component: ComponentType<PluginSurfaceProps>;
}

// The row draws its icon with a size and a color only, so the item passes its theme down.
const RowTheme = createContext<PluginSurfaceProps["theme"] | null>(null);

export function registerScreen(client: PluginClientContext, screen: ScreenRegistration): Cleanup {
  const SidebarRow = (hostUi as Record<string, unknown>).SidebarRow as
    | SidebarRowComponent
    | undefined;
  if (hasScreens(client) && SidebarRow) {
    const removeScreen = client.addScreen({
      id: screen.id,
      title: screen.title,
      Component: screen.Component,
    });
    const { RowIcon } = screen;
    const ThemedIcon = RowIcon
      ? function ThemedIcon(props: RowIconProps) {
          return createElement(RowIcon, { ...props, theme: useContext(RowTheme) });
        }
      : null;
    function SidebarItem({ currentScreen, openScreen, theme }: SidebarItemProps) {
      const row = createElement(SidebarRow as SidebarRowComponent, {
        icon: ThemedIcon ?? screen.icon,
        active: currentScreen?.screenId === screen.id,
        onPress: () => openScreen({ screenId: screen.id }),
      });
      return createElement(RowTheme.Provider, { value: theme ?? null }, row);
    }
    const removeItem = client.addSidebarHeaderItem({
      id: screen.id,
      title: screen.title,
      Component: SidebarItem,
    });
    return () => {
      removeItem();
      removeScreen();
    };
  }
  const legacy = client as unknown as SurfaceClient;
  const removeSurface = legacy.addSurface(screen.id, screen.Component);
  const removeItem = legacy.addSidebarItem({
    id: screen.id,
    title: screen.title,
    icon: screen.icon,
    surface: screen.id,
  });
  return () => {
    removeItem();
    removeSurface();
  };
}

interface NavigationCapabilities {
  openScreen?: (input: ScreenRef) => void;
  openSurface?: (id: string) => void;
}

export function openPluginScreen(capabilities: object, screenId: string): void {
  const navigation = capabilities as NavigationCapabilities;
  if (typeof navigation.openScreen === "function") {
    navigation.openScreen({ screenId });
    return;
  }
  navigation.openSurface?.(screenId);
}
