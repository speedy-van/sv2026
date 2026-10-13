import { Text } from 'react-native';

function Icon(props: { color?: string }): React.ReactElement {
  return <Text style={{ color: props.color ?? '#000' }}>icon</Text>;
}

export const BriefcaseBusiness = Icon;
export const CircleUserRound = Icon;
export const Clock3 = Icon;
export const Coins = Icon;
export const Route = Icon;
