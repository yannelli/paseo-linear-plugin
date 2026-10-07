import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type NativeSyntheticEvent,
  Pressable,
  Text,
  type TextInputKeyPressEventData,
  View,
} from "react-native";
import type { IssueDetail } from "../shared/linear";
import { toggleTask } from "../shared/markdown";
import { createAutosave, type SaveStatus } from "./autosave";
import { Markdown } from "./markdown";
import { useDescriptionSaver } from "./queries";
import { Button, errorMessage, IconButton, SectionLabel, type Theme } from "./ui";

// Typing saves after a pause. Checkbox taps save sooner and coalesce rapid taps.
const EDIT_DELAY_MS = 1200;
const TOGGLE_DELAY_MS = 400;

const STATUS_COPY: Record<SaveStatus, string> = {
  idle: "Saves as you type",
  pending: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved to Linear",
  error: "Could not save",
};

const HEADER_STYLE = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
} as const;

const noop = () => undefined;

export function IssueDescription(props: { theme: Theme; compact: boolean; issue: IssueDetail }) {
  const { theme, compact, issue } = props;
  const { colors } = theme;
  const toast = useToast();
  const saver = useDescriptionSaver(issue.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [closing, setClosing] = useState(false);
  // Read by the autosave callbacks and the unmount flush, which outlive a render.
  const live = useRef({ editing, draft, toast });
  useEffect(() => {
    live.current = { editing, draft, toast };
  });

  const autosave = useMemo(() => {
    let lastSaved: string | null = null;
    const instance = createAutosave({
      delayMs: EDIT_DELAY_MS,
      save: async (value) => {
        await saver.save(value);
        lastSaved = value;
      },
      onStatus: (next, error) => {
        setStatus(next);
        // A refetch during the save may have brought back older text. Nothing is queued now.
        if (next === "saved" && lastSaved !== null) saver.show(lastSaved);
        if (next !== "error" || live.current.editing) return;
        // A checkbox save failed: drop it and show what Linear has.
        instance.cancel();
        live.current.toast.error(`Could not update the checklist: ${errorMessage(error)}`);
        saver.reload();
      },
    });
    return instance;
  }, [saver]);

  // Leaving the issue saves any pending text instead of losing it.
  useEffect(
    () => () => {
      if (!autosave.busy()) return;
      const { editing: wasEditing, draft: text, toast: notify } = live.current;
      if (wasEditing) saver.show(text);
      autosave.flush().catch((error: unknown) => {
        notify.error(`Description not saved: ${errorMessage(error)}`);
        saver.reload();
      });
    },
    [autosave, saver],
  );

  const description = issue.description ?? "";
  const startEditing = useCallback(() => {
    setDraft(description);
    setStatus("idle");
    setEditing(true);
  }, [description]);
  const change = useCallback(
    (text: string) => {
      setDraft(text);
      autosave.schedule(text);
    },
    [autosave],
  );
  const flushQuietly = useCallback(() => void autosave.flush().catch(noop), [autosave]);
  // Closes only after Linear confirms the text. A failure keeps the editor open.
  const finish = useCallback(() => {
    setClosing(true);
    autosave
      .flush()
      .then(() => {
        saver.show(live.current.draft);
        setEditing(false);
        setStatus("idle");
      }, noop)
      .finally(() => setClosing(false));
  }, [autosave, saver]);
  const keyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key === "Escape") finish();
    },
    [finish],
  );
  const toggle = useCallback(
    (ordinal: number) => {
      const next = toggleTask(description, ordinal);
      if (next === null) {
        live.current.toast.error("The checklist changed. Refresh the issue and try again.");
        return;
      }
      saver.show(next);
      autosave.schedule(next, TOGGLE_DELAY_MS);
    },
    [description, saver, autosave],
  );

  const styles = useMemo(
    () =>
      ({
        input: {
          minHeight: 200,
          padding: 10,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface1,
          color: colors.foreground,
          fontSize: 14,
          lineHeight: 21,
          textAlignVertical: "top",
        },
        footer: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
        status: {
          flex: 1,
          fontSize: 12,
          color: status === "error" ? colors.statusDanger : colors.foregroundMuted,
        },
        empty: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 21 },
      }) as const,
    [colors, status],
  );

  if (editing) {
    return (
      <View>
        <SectionLabel theme={theme}>Description</SectionLabel>
        <TextInput
          value={draft}
          onChangeText={change}
          onBlur={flushQuietly}
          onKeyPress={keyPress}
          multiline
          autoFocus
          placeholder="Add a description in Markdown…"
          placeholderTextColor={colors.foregroundMuted}
          accessibilityLabel="Issue description"
          style={styles.input}
        />
        <View style={styles.footer}>
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {STATUS_COPY[status]}
          </Text>
          {status === "error" ? (
            <Button theme={theme} icon="RefreshCw" label="Retry" onPress={flushQuietly} />
          ) : null}
          <Button theme={theme} icon="Check" label="Done" busy={closing} onPress={finish} />
        </View>
      </View>
    );
  }
  return (
    <View>
      <View style={HEADER_STYLE}>
        <SectionLabel theme={theme}>Description</SectionLabel>
        <IconButton theme={theme} icon="Pencil" label="Edit description" onPress={startEditing} />
      </View>
      {description.trim() ? (
        <Markdown theme={theme} compact={compact} source={description} onToggleTask={toggle} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a description"
          onPress={startEditing}
        >
          <Text style={styles.empty}>No description. Add one…</Text>
        </Pressable>
      )}
    </View>
  );
}
