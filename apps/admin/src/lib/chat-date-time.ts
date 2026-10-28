const chatTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/London',
});

export function displayChatTime(timestamp: string): string {
  return chatTimeFormatter.format(new Date(timestamp));
}
