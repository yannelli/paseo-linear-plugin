import { useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo } from "react";
import { Image, Platform } from "react-native";
import { BUILT_IN_ICON, type IconSettings, iconMarkup, markSvg, paintColor } from "../shared/custom-icon";
import { linearSettings } from "../shared/settings";
import { HostSvgIcon } from "./compat";
import { svgDataUri } from "./provider-icon";
import type { Theme } from "./ui";
import { readStored, writeStored } from "./web";

// The plugin's icon in pills, the sidebar, and plugin screens: the user's SVG, or the mark without
// one. Native apps cannot draw SVG images, so they draw the mark through Paseo 0.13 and later, and
// the chosen built-in icon in place of a user's SVG or on older releases.

// Panels and Command Center items take a Lucide name when they register, outside React.
// Components that read the settings share the chosen name here. Paseo keeps the icon an open
// tab got, so the web app remembers the name and registers with it on the next start.
const MENU_ICON_KEY = "paseo-linear-plugin:menu-icon";
let menuIcon = readStored(MENU_ICON_KEY) ?? BUILT_IN_ICON;

/** The menu icon to register with first: the last one chosen on this device. */
export function startMenuIcon(): string {
  return menuIcon;
}
const menuListeners = new Set<(name: string) => void>();

export function publishMenuIcon(name: string): void {
  if (name === menuIcon) return;
  menuIcon = name;
  writeStored(MENU_ICON_KEY, name);
  for (const listener of menuListeners) listener(name);
}

export function onMenuIconChange(listener: (name: string) => void): () => void {
  menuListeners.add(listener);
  return () => menuListeners.delete(listener);
}

/** The saved icon settings, or null while they load. Shares the menu icon on the way. */
export function useIconSettings(): IconSettings | null {
  const settings = useSettings(linearSettings);
  const icon = settings.status === "ready" ? settings.values.icon : null;
  const menu = icon?.menu;
  useEffect(() => {
    if (menu) publishMenuIcon(menu);
  }, [menu]);
  return icon;
}

export interface PluginIconProps {
  size: number;
  /** The color Paseo gives the icon in this place. */
  color: string;
  theme?: Theme | null;
}

/** Draws icon settings, saved or not yet saved. */
export function IconGlyph(props: PluginIconProps & { icon: IconSettings | null }) {
  const { icon, size, color } = props;
  const accent = props.theme?.colors.accent ?? color;
  const paint = icon ? paintColor(icon, { ink: color, accent }) : null;
  const svg = icon?.svg ?? "";
  const solid = icon?.solid === true;
  const web = Platform.OS === "web";
  const markup = useMemo(() => {
    if (!svg) return markSvg(paint);
    return web ? iconMarkup(svg, { ink: color, paint, solid }) : null;
  }, [svg, web, color, paint, solid]);
  const source = useMemo(() => (markup && web ? { uri: svgDataUri(markup, color) } : null), [markup, web, color]);
  const style = useMemo(() => ({ width: size, height: size }), [size]);
  if (source) return <Image source={source} style={style} resizeMode="contain" accessibilityIgnoresInvertColors />;
  if (markup && HostSvgIcon) return <HostSvgIcon icon={{ svg: markup }} size={size} color={color} />;
  return <Icon name={icon?.menu ?? BUILT_IN_ICON} size={size} color={paint ?? color} />;
}

/** The plugin icon from the saved settings. The built-in icon shows while they load. */
export function PluginIcon(props: PluginIconProps) {
  return <IconGlyph {...props} icon={useIconSettings()} />;
}
