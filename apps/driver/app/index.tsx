import { Redirect } from 'expo-router';

export default function Index(): React.ReactElement {
  return <Redirect href="/(app)/today" />;
}
