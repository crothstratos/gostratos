import { auth } from '../firebase';

/**
 * Calls one of our own /api/* endpoints with the signed-in user's Firebase
 * ID token attached. The server verifies that token and rejects anyone who
 * isn't a current @gostratos.vc user, so these endpoints can't be called by
 * strangers who find the URL.
 *
 * getIdToken() refreshes automatically when the cached token has expired,
 * so long-lived tabs keep working without the user re-authenticating.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You are not signed in. Please sign in and try again.');
  }

  const token = await user.getIdToken();
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...init, headers });

  if (response.status === 401) {
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (response.status === 403) {
    throw new Error('This account is not authorized to use this feature.');
  }

  return response;
}
