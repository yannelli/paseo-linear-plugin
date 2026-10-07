import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { IssueDetail, IssueRef } from "../shared/linear";
import { crumbTrail } from "./issue-tree";
import type { Theme } from "./ui";

const ROW = { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 } as const;

// Team, then the parent chain, then the issue. Each parent opens that issue.
export function IssueBreadcrumbs(props: {
  theme: Theme;
  compact: boolean;
  issue: IssueDetail;
  onOpenIssue(issueId: string): void;
}) {
  const { theme, compact, issue, onOpenIssue } = props;
  const { colors } = theme;
  const [expanded, setExpanded] = useState(false);
  const styles = useMemo(
    () =>
      ({
        muted: { color: colors.foregroundMuted, fontSize: 13, flexShrink: 1 },
        link: { color: colors.foregroundMuted, fontSize: 13, textDecorationLine: "underline" },
        current: { color: colors.foreground, fontSize: 13, fontWeight: "500", flexShrink: 0 },
        separator: { color: colors.foregroundMuted, fontSize: 13 },
      }) as const,
    [colors],
  );
  const expand = useCallback(() => setExpanded(true), []);
  const trail = crumbTrail(issue.ancestors, expanded ? issue.ancestors.length : compact ? 2 : 4);
  const showTeam = !compact || issue.ancestors.length === 0;
  return (
    <View style={ROW} accessibilityRole="header">
      {showTeam ? (
        <>
          <Text style={styles.muted} numberOfLines={1}>
            {issue.team.name}
          </Text>
          <Text style={styles.separator}>›</Text>
        </>
      ) : null}
      {trail.map((crumb) =>
        crumb.kind === "more" ? (
          <CrumbLink
            key="more"
            label="…"
            accessibilityLabel={`Show ${crumb.hidden} more parent issues`}
            style={styles.link}
            separator={styles.separator}
            onPress={expand}
          />
        ) : (
          <ParentCrumb
            key={crumb.ref.id}
            parent={crumb.ref}
            style={styles.link}
            separator={styles.separator}
            onOpenIssue={onOpenIssue}
          />
        ),
      )}
      <Text style={styles.current} numberOfLines={1}>
        {issue.identifier}
      </Text>
    </View>
  );
}

function ParentCrumb(props: {
  parent: IssueRef;
  style: object;
  separator: object;
  onOpenIssue(issueId: string): void;
}) {
  const { parent, onOpenIssue } = props;
  const open = useCallback(() => onOpenIssue(parent.id), [onOpenIssue, parent.id]);
  return (
    <CrumbLink
      label={parent.identifier}
      accessibilityLabel={`Open parent issue ${parent.identifier}: ${parent.title}`}
      style={props.style}
      separator={props.separator}
      onPress={open}
    />
  );
}

function CrumbLink(props: {
  label: string;
  accessibilityLabel: string;
  style: object;
  separator: object;
  onPress(): void;
}) {
  return (
    <>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={props.accessibilityLabel}
        hitSlop={4}
        onPress={props.onPress}
      >
        <Text style={props.style} numberOfLines={1}>
          {props.label}
        </Text>
      </Pressable>
      <Text style={props.separator}>›</Text>
    </>
  );
}
