import { Stack } from 'expo-router';

export default function AuthLayout(): React.ReactElement {
  return <Stack initialRouteName="sign-in" screenOptions={{ headerShown: false }} />;
}
