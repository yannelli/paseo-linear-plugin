import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  ExternalLink,
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { authClearRpc } from "../shared/linear";
import { ApiKeyForm, LINEAR_KEY_SETTINGS_URL } from "./connect";
import { useAuthStatus, useCatalog } from "./queries";
import { ProjectKeysSection } from "./settings-keys";
import { errorMessage, type Theme } from "./ui";

type AuthQuery = ReturnType<typeof useAuthStatus>;
type CatalogQuery = ReturnType<typeof useCatalog>;

function statusText(auth: AuthQuery): string {
  const status = auth.data;
  if (!status) return auth.isError ? errorMessage(auth.error) : "Checking…";
  if (!status.configured) return "No default key";
  if (status.source === "environment") {
    return `Using the key from the daemon environment (${status.keyHint ?? ""})`;
  }
  return `Using the key saved on this host (${status.keyHint ?? ""})`;
}

function AccountLine({ theme, catalog }: { theme: Theme; catalog: CatalogQuery }) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      muted: { color: colors.foregroundMuted, fontSize: 13 },
      error: { color: colors.statusDanger, fontSize: 13 },
    }),
    [colors],
  );
  if (catalog.data) {
    return (
      <Text style={styles.muted}>
        {catalog.data.viewer.displayName} · {catalog.data.organization.name}
      </Text>
    );
  }
  if (catalog.isError) return <Text style={styles.error}>{errorMessage(catalog.error)}</Text>;
  return null;
}

const FORM_STYLE = { gap: 10, paddingTop: 8 } as const;

export function ConnectionSettings({ theme }: PluginSurfaceProps) {
  const toast = useToast();
  const queries = useQueryClient();
  const auth = useAuthStatus();
  const catalog = useCatalog(auth.data?.configured === true);
  const clear = useRpc(authClearRpc);
  const disconnect = useMutation({
    mutationFn: () => clear({}),
    onSuccess: ({ configured }) => {
      queries.removeQueries({ queryKey: ["linear"] });
      const message = configured
        ? "Saved key removed. The daemon environment still provides a key."
        : "Default key removed";
      toast.show(message, { variant: "success" });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const { mutate } = disconnect;
  const remove = useCallback(() => mutate(), [mutate]);
  const configured = auth.data?.configured === true;

  return (
    <View>
      <SettingsSection title="Linear account">
        <SettingsCard>
          <SettingsRow label="Status" hint={statusText(auth)}>
            <AccountLine theme={theme} catalog={catalog} />
          </SettingsRow>
          {auth.data?.source === "file" ? (
            <SettingsAction
              label="Remove the saved key"
              hint="Deletes the key file from this host."
              actionLabel="Disconnect"
              disabled={disconnect.isPending}
              onPress={remove}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={configured ? "Replace the default key" : "Default key"}>
        <SettingsCard>
          <SettingsRow
            label="Personal API key"
            hint="Saved on the daemon host with owner-only permissions. A saved key takes precedence over the daemon environment."
          >
            <View style={FORM_STYLE}>
              <ExternalLink href={LINEAR_KEY_SETTINGS_URL}>Create a key in Linear</ExternalLink>
              <ApiKeyForm theme={theme} />
            </View>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <ProjectKeysSection theme={theme} />
    </View>
  );
}
