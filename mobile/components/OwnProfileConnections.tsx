import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "./Text";
import { colors, spacing, type } from "../theme";

/** Owner-only navigation. No relationship data is fetched or inferred here. */
export function OwnProfileConnections() {
  const router = useRouter();
  const relationships = [
    { key: "friends", title: "Friends", detail: "People you follow who follow you back." },
    { key: "following", title: "Following", detail: "People you have chosen to follow." },
    { key: "followers", title: "Followers", detail: "People who have chosen to follow you." },
  ] as const;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text accessibilityRole="header" style={styles.title}>Good taste. Shared.</Text>
      <Text style={styles.intro}>Find your people, keep up with your connections, and choose what you share.</Text>

      <Pressable
        onPress={() => router.push("/people" as never)}
        accessibilityRole="button"
        accessibilityLabel="Find people"
        accessibilityHint="Opens the people directory."
        style={({ pressed }) => [styles.discover, pressed && styles.pressed]}
      >
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>EXPLORE PALATE</Text>
          <Text style={styles.discoverTitle}>Find people</Text>
          <Text style={styles.discoverBody}>Look for someone you know or explore public profiles.</Text>
        </View>
        <Text accessible={false} style={styles.arrow}>↗</Text>
      </Pressable>

      <Text accessibilityRole="header" style={styles.sectionTitle}>Your connections</Text>
      <View style={styles.list}>
        {relationships.map((item, index) => (
          <Pressable
            key={item.key}
            onPress={() => router.push({ pathname: "/follows", params: { tab: item.key } } as never)}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.detail}`}
            style={({ pressed }) => [styles.row, index > 0 && styles.divider, pressed && styles.pressed]}
          >
            <View style={styles.copy}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.detail}>{item.detail}</Text>
            </View>
            <Text accessible={false} style={styles.chevron}>→</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.privacy}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Your profile, your choice</Text>
        <Text style={styles.detail}>Following someone does not unlock a private profile. Friends means you both follow each other.</Text>
        <Pressable
          onPress={() => router.push("/curate-profile" as never)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.privacyAction, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>Choose profile content</Text>
          <Text accessible={false} style={styles.chevron}>→</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push("/edit-profile" as never)}
          accessibilityRole="button"
          accessibilityHint="Opens Edit profile, where you can review who can see your profile."
          style={({ pressed }) => [styles.privacyAction, styles.divider, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>Review profile visibility</Text>
          <Text accessible={false} style={styles.chevron}>→</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: { ...type.display, color: colors.ink },
  intro: { ...type.body, color: colors.inkDim, marginTop: 8 },
  discover: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: colors.redTint, borderRadius: 22, padding: 22, marginTop: spacing.lg },
  copy: { flex: 1, minWidth: 0 },
  eyebrow: { ...type.badge, letterSpacing: 1.4, color: colors.redText },
  discoverTitle: { ...type.stat, color: colors.ink, letterSpacing: -0.5, marginTop: 8 },
  discoverBody: { ...type.small, color: colors.inkDim, marginTop: 6 },
  arrow: { ...type.stat, color: colors.redText },
  sectionTitle: { ...type.cardTitle, color: colors.ink, marginBottom: 12, marginTop: spacing.lg },
  list: { backgroundColor: colors.faint, borderRadius: 20, paddingHorizontal: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 18, minHeight: 64 },
  rowTitle: { ...type.subtitle, color: colors.ink },
  detail: { ...type.small, color: colors.inkDim, marginTop: 4 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  chevron: { ...type.title, color: colors.redText },
  privacy: { marginTop: 8 },
  privacyAction: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 48, paddingVertical: 14 },
  actionText: { flex: 1, ...type.small, color: colors.redText },
  pressed: { opacity: 0.65 },
});
