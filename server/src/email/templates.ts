import db from '../db/connection.js';

function getServerName(): string {
  const row = db.prepare('SELECT name FROM server_settings WHERE id = 1').get() as
    | { name: string }
    | undefined;
  return row?.name || 'SellServ Voice';
}

export function verificationEmail(code: string): { subject: string; html: string } {
  const name = getServerName();
  return {
    subject: `Verify your email — ${name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
        <h2>Verify your email</h2>
        <p>Enter this code to verify your email address:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 16px; background: #f4f4f4; border-radius: 8px; margin: 16px 0;">${code}</div>
        <p style="color: #888; font-size: 14px;">This code expires in 10 minutes.</p>
      </div>
    `,
  };
}

export function mfaEmail(code: string): { subject: string; html: string } {
  const name = getServerName();
  return {
    subject: `Your login code — ${name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
        <h2>Your login code</h2>
        <p>Enter this code to sign in:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 16px; background: #f4f4f4; border-radius: 8px; margin: 16px 0;">${code}</div>
        <p style="color: #888; font-size: 14px;">This code expires in 5 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  };
}

export function accountLockedEmail(code: string): { subject: string; html: string } {
  const name = getServerName();
  return {
    subject: `Your account has been locked — ${name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
        <h2>Account locked</h2>
        <p>Your account has been locked due to too many failed login attempts. Enter this code to unlock it:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 16px; background: #f4f4f4; border-radius: 8px; margin: 16px 0;">${code}</div>
        <p style="color: #888; font-size: 14px;">This code expires in 10 minutes. If you didn't attempt to log in, someone may be trying to access your account — consider changing your password.</p>
      </div>
    `,
  };
}

export function passwordResetEmail(code: string): { subject: string; html: string } {
  const name = getServerName();
  return {
    subject: `Password reset code — ${name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
        <h2>Password reset</h2>
        <p>Enter this code to reset your password:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 16px; background: #f4f4f4; border-radius: 8px; margin: 16px 0;">${code}</div>
        <p style="color: #888; font-size: 14px;">This code expires in 5 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  };
}
