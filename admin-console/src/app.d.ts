declare global {
  namespace App {
    interface Locals {
      session: {
        userId: string;
        username: string;
        displayName: string;
        accessToken: string;
        createdAt: number;
      };
    }
  }
}

export {};
