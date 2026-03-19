const TOKEN_KEY = "lm_access_token";
const ROLE_KEY  = "lm_role";

export function getStoredToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
}

export function isAuthenticated(): boolean {
  return !!getStoredToken();
}

export function saveRole(role: "admin" | "viewer"): void {
  localStorage.setItem(ROLE_KEY, role);
}

export function getRole(): "admin" | "viewer" {
  if (typeof window === "undefined") return "viewer";
  return (localStorage.getItem(ROLE_KEY) as "admin" | "viewer") || "viewer";
}
