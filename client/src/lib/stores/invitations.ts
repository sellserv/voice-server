import { writable } from 'svelte/store';
import { api } from '$lib/api';
import type { ServerInvitation, Server } from '@voip-server/shared';

export const pendingInvitations = writable<ServerInvitation[]>([]);

export async function loadInvitations() {
  try {
    const invites = await api.get<ServerInvitation[]>('/api/invitations');
    pendingInvitations.set(invites);
  } catch {
    // silently fail
  }
}

export async function acceptInvitation(id: string): Promise<Server | null> {
  try {
    const server = await api.post<Server>(`/api/invitations/${id}/accept`);
    pendingInvitations.update((list) => list.filter((i) => i.id !== id));
    return server;
  } catch {
    return null;
  }
}

export async function declineInvitation(id: string) {
  try {
    await api.post(`/api/invitations/${id}/decline`);
    pendingInvitations.update((list) => list.filter((i) => i.id !== id));
  } catch {
    // silently fail
  }
}

export function addInvitation(invitation: ServerInvitation) {
  pendingInvitations.update((list) => [invitation, ...list]);
}
