import { StyleSheet } from "react-native";

export const ResultStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5F7FF" },
  container: { padding: 16, gap: 16 },
  emojiWrap: { alignItems: "center", gap: 6, marginTop: 8 },
  emoji: { fontSize: 64 },
  statusText: { fontSize: 20, fontWeight: "800", color: "#1E293B" },
  cards: { gap: 12 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  label: { color: "#64748B", marginBottom: 4, fontWeight: "600" },
  value: { color: "#111827", fontSize: 22, fontWeight: "900" },
  block: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 8 },
  blockTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  blockText: { color: "#334155", lineHeight: 20 },
  meta: { marginTop: 8, color: "#94A3B8", fontSize: 12 },
});