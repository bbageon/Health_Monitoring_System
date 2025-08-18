import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: "#FFFFFF", fontSize: 22, fontWeight: "700" },
  controls: {
    paddingHorizontal: 20,
    paddingTop: 8,
    flexDirection: "row",
    gap: 12,
  },
  btn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  btnText: { color: "#fff", fontWeight: "600" },
  btnPrimary: { backgroundColor: "#5865F2" },
  btnSecondary: { backgroundColor: "#1F2A54" },
  btnDisabled: { backgroundColor: "#3A4066" },
  grid: {
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 12,
  },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
  meta: { color: "#A9B1D6" },
});

export const pill = StyleSheet.create({
  base: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  text: { color: "#fff", fontWeight: "700" },
  success: { backgroundColor: "#22C55E" },
  info: { backgroundColor: "#0EA5E9" },
  error: { backgroundColor: "#EF4444" },
  muted: { backgroundColor: "#4B5563" },
});

export const card = StyleSheet.create({
  base: {
    backgroundColor: "#121A36",
    borderRadius: 16,
    padding: 16,
  },
  label: { color: "#A9B1D6", marginBottom: 6 },
  value: { color: "#F4F6FF", fontSize: 24, fontWeight: "800" },
});