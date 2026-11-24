# Plugin icon

The plugin draws its own mark: an issue lifted off a stack, with the issue in Linear indigo and the stack in Paseo's icon color. Replace it with your own SVG, paint it one color, or pick the built-in icon that panel tabs and menus use.

## Where the icon shows

- **The plugin mark or your SVG**
  - The Linear sidebar row, composer pills, the issue card in the timeline, and the Linear screens
  - The iOS and Android apps draw the mark on Paseo 0.13 and newer. They cannot draw your SVG, so they show the built-in icon in its place, and on older Paseo releases.
- **The built-in icon**
  - Panel tabs, the new tab menu, and Command Center take built-in Lucide icons only
  - The default is **Layers**, which matches the mark

## Choose an icon

In **Settings → Plugins → Linear → Icon**, choose an SVG file or paste SVG markup.

- The plugin accepts SVG only
- It refuses scripts, event handlers, HTML content, entities, and links to other files or bitmap images
- The SVG needs a viewBox, or a width and height in pixels
- **Remove SVG** goes back to the plugin mark

## Options

- **Color**
  - **Original colors** keeps the SVG as drawn, and the mark in Linear indigo and Paseo's icon color
  - `currentColor` takes the color Paseo gives the icon
  - **Theme color**, **Theme accent**, **Linear indigo**, and **Custom color** paint the whole icon one color and keep its transparency
  - These choices also apply to the mark and the built-in icon
- **Solid**
  - Fills shapes that only have an outline, with their stroke color, so a line icon shows as a solid shape
  - Works on your SVG only
- **Built-in icon**
  - Pick the Lucide icon for panel tabs, the new tab menu, and Command Center, such as Rocket or Target
  - Tabs that are open change when you reload Paseo or open them again
  - The web app keeps the choice on the device, so the tabs get it as Paseo starts

## Preview

The preview shows each change before you save.
