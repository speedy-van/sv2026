import { Text } from 'react-native';

function Icon(props: { color?: string }): React.ReactElement {
  return <Text style={{ color: props.color ?? '#000' }}>icon</Text>;
}

export const AlertCircle = Icon;
export const CalendarDays = Icon;
export const Inbox = Icon;
export const LayoutDashboard = Icon;
export const Menu = Icon;
export const Truck = Icon;
export const Users = Icon;
