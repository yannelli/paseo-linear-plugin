import { openExternalUrl } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useCallback, useMemo } from "react";
import { Platform, ScrollView, type StyleProp, Text, type TextStyle, View } from "react-native";
import { type MarkdownBlock, type MarkdownInline, parseMarkdown } from "../shared/markdown";
import type { Theme } from "./ui";

type ListBlock = Extract<MarkdownBlock, { type: "list" }>;
type TableBlock = Extract<MarkdownBlock, { type: "table" }>;

const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, monospace",
});
const LINE_HEIGHT = 21;
const HEADING_SIZES = [20, 18, 16, 15, 14, 14];
const COMPACT_HEADING_SIZES = [18, 16, 15, 14, 14, 14];

function createStyles(colors: Theme["colors"], compact: boolean, muted: boolean) {
  const ink = muted ? colors.foregroundMuted : colors.foreground;
  const text = { color: ink, fontSize: 14, lineHeight: LINE_HEIGHT } as const;
  const cell = {
    minHeight: LINE_HEIGHT + 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: "center",
  } as const;
  const column = { flexDirection: "column" } as const;
  return {
    ink,
    text,
    root: { gap: compact ? 8 : 10 },
    headings: (compact ? COMPACT_HEADING_SIZES : HEADING_SIZES).map((fontSize) => {
      const lineHeight = Math.round(fontSize * 1.4);
      return { color: ink, fontSize, lineHeight, fontWeight: "600" } as const;
    }),
    strong: { fontWeight: "600" },
    emphasis: { fontStyle: "italic" },
    strike: { textDecorationLine: "line-through" },
    link: { color: colors.foreground, textDecorationLine: "underline" },
    code: { fontFamily: MONO, backgroundColor: colors.surface2, borderRadius: 4 },
    codeBlock: {
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
    },
    codeContent: { padding: 10 },
    codeText: { fontFamily: MONO, fontSize: 13, lineHeight: 19, color: colors.foreground },
    quote: { borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: 10, gap: 8 },
    rule: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
    list: { gap: 4 },
    item: { flexDirection: "row", gap: 4 },
    marker: { minWidth: 12, height: LINE_HEIGHT, justifyContent: "center" },
    itemBody: { flex: 1, minWidth: 0, gap: 4 },
    table: {
      flexDirection: "row",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      overflow: "hidden",
    },
    column,
    columnDivided: { ...column, borderLeftWidth: 1, borderLeftColor: colors.border },
    headCell: { ...cell, backgroundColor: colors.surface1 },
    cell: { ...cell, borderTopWidth: 1, borderTopColor: colors.border },
    headText: { ...text, fontWeight: "600" },
  } as const;
}

type Styles = ReturnType<typeof createStyles>;

// `s` styles the current blocks. `quoted` is the muted context for blockquotes; inside a
// quote it is unset, so nested quotes reuse the current (already muted) context.
interface Context {
  s: Styles;
  quoted?: Context;
}

function Link(props: { url: string; style: StyleProp<TextStyle>; children: ReactNode }) {
  const { url } = props;
  const open = useCallback(() => void openExternalUrl(url), [url]);
  return (
    <Text accessibilityRole="link" onPress={open} style={props.style}>
      {props.children}
    </Text>
  );
}

function renderInline(nodes: MarkdownInline[], s: Styles): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "break":
        return "\n";
      case "code":
        return (
          <Text key={index} style={s.code}>
            {node.text}
          </Text>
        );
      case "link":
        return (
          <Link key={index} url={node.url} style={s.link}>
            {renderInline(node.children, s)}
          </Link>
        );
      default:
        return (
          <Text key={index} style={s[node.type]}>
            {renderInline(node.children, s)}
          </Text>
        );
    }
  });
}

function renderBlocks(blocks: MarkdownBlock[], ctx: Context): ReactNode[] {
  return blocks.map((block, index) => <Block key={index} block={block} ctx={ctx} />);
}

function ListMarker(props: { list: ListBlock; index: number; checked: boolean | null; s: Styles }) {
  const { list, index, checked, s } = props;
  if (checked !== null) {
    return <Icon name={checked ? "SquareCheck" : "Square"} size={14} color={s.ink} />;
  }
  return (
    <Text selectable style={s.text}>
      {list.ordered ? `${list.start + index}.` : "•"}
    </Text>
  );
}

function List({ list, ctx }: { list: ListBlock; ctx: Context }) {
  const { s } = ctx;
  return (
    <View style={s.list}>
      {list.items.map((item, index) => (
        <View key={index} style={s.item}>
          <View style={s.marker}>
            <ListMarker list={list} index={index} checked={item.checked} s={s} />
          </View>
          <View style={s.itemBody}>{renderBlocks(item.children, ctx)}</View>
        </View>
      ))}
    </View>
  );
}

// Lays the table out column by column so every column sizes to its widest cell.
// Cells never wrap inside the horizontal ScrollView, so rows stay aligned.
function Table({ table, s }: { table: TableBlock; s: Styles }) {
  const columns = useMemo(
    () =>
      table.header.map((head, c) => {
        const textAlign = table.align[c] ?? "left";
        return {
          cells: [head, ...table.rows.map((row) => row[c] ?? [])],
          head: { ...s.headText, textAlign },
          body: { ...s.text, textAlign },
        };
      }),
    [table, s],
  );
  return (
    <ScrollView horizontal>
      <View style={s.table}>
        {columns.map((column, c) => (
          <View key={c} style={c === 0 ? s.column : s.columnDivided}>
            {column.cells.map((cell, r) => (
              <View key={r} style={r === 0 ? s.headCell : s.cell}>
                <Text selectable style={r === 0 ? column.head : column.body}>
                  {renderInline(cell, s)}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Block({ block, ctx }: { block: MarkdownBlock; ctx: Context }) {
  const { s } = ctx;
  switch (block.type) {
    case "heading":
      return (
        <Text selectable accessibilityRole="header" style={s.headings[block.level - 1]}>
          {renderInline(block.children, s)}
        </Text>
      );
    case "paragraph":
      return (
        <Text selectable style={s.text}>
          {renderInline(block.children, s)}
        </Text>
      );
    case "code":
      return (
        <View style={s.codeBlock}>
          <ScrollView horizontal contentContainerStyle={s.codeContent}>
            <Text selectable style={s.codeText}>
              {block.text}
            </Text>
          </ScrollView>
        </View>
      );
    case "blockquote":
      return <View style={s.quote}>{renderBlocks(block.children, ctx.quoted ?? ctx)}</View>;
    case "list":
      return <List list={block} ctx={ctx} />;
    case "table":
      return <Table table={block} s={s} />;
    case "rule":
      return <View style={s.rule} />;
  }
}

export interface MarkdownProps {
  theme: Theme;
  source: string;
  compact?: boolean;
  muted?: boolean;
}

export function Markdown(props: MarkdownProps) {
  const { colors } = props.theme;
  const compact = props.compact === true;
  const muted = props.muted === true;
  const blocks = useMemo(() => parseMarkdown(props.source), [props.source]);
  const ctx = useMemo<Context>(() => {
    const quoted: Context = { s: createStyles(colors, compact, true) };
    return { s: muted ? quoted.s : createStyles(colors, compact, false), quoted };
  }, [colors, compact, muted]);
  if (blocks.length === 0) return null;
  return <View style={ctx.s.root}>{renderBlocks(blocks, ctx)}</View>;
}
