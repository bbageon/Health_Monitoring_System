import React from "react";
import { useRouter } from "expo-router";
import MainContainer from "./src/main";

export default function Index() {
  const router = useRouter();
  return (
    <MainContainer
      title="Main"
      onAnalyze={() => router.push("/src/result")}
    />
  );
}
