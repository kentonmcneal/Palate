import { Redirect } from "expo-router";

// Root entry — actual routing decided in _layout.tsx based on auth state.
export default function Index() {
  return <Redirect href="/sign-in" />;
}
