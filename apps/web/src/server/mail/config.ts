import 'server-only';
import { serverEnv } from '../env';
import { MailPermanentError } from './errors';

export function mailConfig(): { enabled: boolean; mailbox: string; password: string; sentFolder?: string } {
  const env = serverEnv();
  if (env.LARK_MAIL_ENABLED !== 'true' || !env.LARK_MAIL_ADDRESS || !env.LARK_MAIL_APP_PASSWORD) {
    throw new MailPermanentError('MAIL_CONFIGURATION_REQUIRED');
  }
  return {
    enabled: true, mailbox: env.LARK_MAIL_ADDRESS.toLowerCase(), password: env.LARK_MAIL_APP_PASSWORD,
    ...(env.LARK_MAIL_SENT_FOLDER ? { sentFolder: env.LARK_MAIL_SENT_FOLDER } : {}),
  };
}

export function mailConfigured(): boolean {
  const env = serverEnv();
  return env.LARK_MAIL_ENABLED === 'true' && Boolean(env.LARK_MAIL_ADDRESS && env.LARK_MAIL_APP_PASSWORD);
}
