import { useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { authSaveRpc } from "../shared/linear";
import { Button, errorMessage, type Theme } from "./ui";

export const LINEAR_KEY_SETTINGS_URL = "https://linear.app/settings/account/security";

export function useSaveApiKey() {
  const save = useRpc(authSaveRpc);
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) => save({ apiKey }),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ["linear"] });
    },
  });
}

export function ApiKeyForm({ theme }: { theme: Theme }) {
  const [apiKey, setApiKey] = useState("");
  const saveKey = useSaveApiKey();
  const toast = useToast();
  const { colors } = theme;
  const { mutate } = saveKey;
  const submit = useCallback(() => {
    if (!apiKey.trim()) return;
    mutate(apiKey, {
      onSuccess: ({ viewerName, organizationName }) => {
        setApiKey("");
        toast.show(`Connected to ${organizationName} as ${viewerName}`, { variant: "success" });
      },
    });
  }, [apiKey, mutate, toast]);
  const styles = useMemo(
    () => ({
      root: { gap: 10, alignSelf: "stretch" as const },
      input: {
        height: 40,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        color: colors.foreground,
        fontSize: 14,
      },
      error: { color: colors.statusDanger, fontSize: 13 },
    }),
    [colors],
  );
  return (
    <View style={styles.root}>
      <TextInput
        value={apiKey}
        onChangeText={setApiKey}
        onSubmitEditing={submit}
        placeholder="lin_api_..."
        placeholderTextColor={colors.foregroundMuted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Linear API key"
        style={styles.input}
      />
      {saveKey.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {errorMessage(saveKey.error)}
        </Text>
      ) : null}
      <Button
        theme={theme}
        variant="primary"
        size="md"
        label="Connect Linear"
        icon="KeyRound"
        busy={saveKey.isPending}
        disabled={!apiKey.trim()}
        onPress={submit}
      />
    </View>
  );
}

export function ConnectCard({ theme, compact }: { theme: Theme; compact: boolean }) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      root: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        padding: compact ? 20 : 32,
      },
      card: {
        width: "100%" as const,
        maxWidth: 440,
        gap: 16,
        padding: compact ? 20 : 28,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
      title: { color: colors.foreground, fontSize: 17, fontWeight: "500" as const },
      body: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 20 },
    }),
    [colors, compact],
  );
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Icon name="SquareKanban" size={22} color={colors.foreground} />
          <Text style={styles.title}>Connect Linear</Text>
        </View>
        <Text style={styles.body}>
          Create a personal API key in Linear under Settings, Security & access. Paseo stores it on
          this host only, readable by the daemon user, and never sends it back to the app.
        </Text>
        <ExternalLink href={LINEAR_KEY_SETTINGS_URL}>Open Linear API key settings</ExternalLink>
        <ApiKeyForm theme={theme} />
      </View>
    </View>
  );
}
