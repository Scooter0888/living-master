const TOKEN_KEY = "lm_access_token";

export function getStoredToken(): string {
  if (typeof window === "undefined") return process.env.NEXT_PUBLIC_ACCESS_TOKEN || "";
  return localStorage.getItem(TOKEN_KEY) || process.env.NEXT_PUBLIC_ACCESS_TOKEN || "";
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getStoredToken();
}
