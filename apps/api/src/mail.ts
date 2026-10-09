import nodemailer from 'nodemailer';
import type { RuntimeConfig } from './config.js';

export async function sendTaskCompletedEmail(
  config: RuntimeConfig['mail'],
  input: {
    to: string;
    taskTitle: string;
    boardName: string;
    completedBy: string;
  },
) {
  if (!config) return { delivered: false, reason: 'NOT_CONFIGURED' as const };
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await transport.sendMail({
    from: config.from,
    to: input.to,
    subject: `Задача выполнена: ${input.taskTitle}`,
    text: [
      `Задача «${input.taskTitle}» на доске «${input.boardName}» отмечена выполненной.`,
      `Исполнитель: ${input.completedBy}.`,
    ].join('\n'),
  });
  return { delivered: true as const };
}
