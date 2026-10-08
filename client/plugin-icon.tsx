import { useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Image, Platform } from "react-native";
import { type IconSettings, iconMarkup, paintColor } from "../shared/custom-icon";
import { linearSettings } from "../shared/settings";
import { svgDataUri } from "./provider-icon";
import type { Theme } from "./ui";

// The plugin's icon in pills, the sidebar, and plugin screens. Native apps cannot draw SVG
// images from plugins, so they show the built-in icon in the chosen color.

export const BUILT_IN_ICON = "SquareKanban";

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
  const svg = Platform.OS === "web" ? (icon?.svg ?? "") : "";
  const solid = icon?.solid === true;
  const source = useMemo(() => {
    const markup = svg ? iconMarkup(svg, { ink: color, paint, solid }) : null;
    return markup ? { uri: svgDataUri(markup, color) } : null;
  }, [svg, color, paint, solid]);
  const style = useMemo(() => ({ width: size, height: size }), [size]);
  if (!source) return <Icon name={BUILT_IN_ICON} size={size} color={paint ?? color} />;
  return <Image source={source} style={style} resizeMode="contain" accessibilityIgnoresInvertColors />;
}

/** The plugin icon from the saved settings. The built-in icon shows while they load. */
export function PluginIcon(props: PluginIconProps) {
  const settings = useSettings(linearSettings);
  const icon = settings.status === "ready" ? settings.values.icon : null;
  return <IconGlyph {...props} icon={icon} />;
}
