import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import * as hostUi from "@getpaseo/plugin/client/ui";
import { type ComponentType, createContext, createElement, useContext } from "react";

// The plugin builds against the Paseo 0.10 types and runs on 0.11 and later. These shapes cover
// the parts of the newer host it uses.
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

interface RowIconProps {
  size: number;
  color: string;
}

type SidebarRowComponent = ComponentType<{
  icon?: ComponentType<RowIconProps>;
  label?: string;
  active?: boolean;
  onPress(): void;
}>;

const host = hostUi as Record<string, unknown>;

/** Paseo 0.13 and later draw inline SVG icons, also in the iOS and Android apps. Older releases: undefined. */
export const HostSvgIcon = host.Icon as
  | ComponentType<{ icon: { svg: string }; size: number; color: string }>
  | undefined;

export interface ScreenRegistration {
  id: string;
  title: string;
  /** Drawn in the sidebar row. */
  RowIcon: ComponentType<RowIconProps & { theme: PluginSurfaceProps["theme"] | null }>;
  Component: ComponentType<PluginSurfaceProps>;
}

// The row draws its icon with a size and a color only, so the item passes its theme down.
const RowTheme = createContext<PluginSurfaceProps["theme"] | null>(null);

export function registerScreen(client: PluginClientContext, screen: ScreenRegistration): Cleanup {
  const screens = client as unknown as ScreenClient;
  const SidebarRow = host.SidebarRow as SidebarRowComponent;
  const removeScreen = screens.addScreen({
    id: screen.id,
    title: screen.title,
    Component: screen.Component,
  });
  const { RowIcon } = screen;
  function ThemedIcon(props: RowIconProps) {
    return createElement(RowIcon, { ...props, theme: useContext(RowTheme) });
  }
  function SidebarItem({ currentScreen, openScreen, theme }: SidebarItemProps) {
    const row = createElement(SidebarRow, {
      icon: ThemedIcon,
      active: currentScreen?.screenId === screen.id,
      onPress: () => openScreen({ screenId: screen.id }),
    });
    return createElement(RowTheme.Provider, { value: theme ?? null }, row);
  }
  const removeItem = screens.addSidebarHeaderItem({
    id: screen.id,
    title: screen.title,
    Component: SidebarItem,
  });
  return () => {
    removeItem();
    removeScreen();
  };
}

export function openPluginScreen(capabilities: object, screenId: string): void {
  (capabilities as { openScreen(input: ScreenRef): void }).openScreen({ screenId });
}
