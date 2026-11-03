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
export const ChevronRight = Icon;
export const ChevronLeft = Icon;
export const RefreshCw = Icon;
export const LogOut = Icon;
export const Settings = Icon;
export const ListChecks = Icon;
export const MoreHorizontal = Icon;
export const UserRound = Icon;
export const Check = Icon;
export const MapPin = Icon;
export const CreditCard = Icon;
export const Trash2 = Icon;
export const RotateCcw = Icon;
export const MessageCircle = Icon;
export const Volume2 = Icon;
export const VolumeX = Icon;
